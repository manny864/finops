import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage, serverError } from '@/lib/apiErrors';
import { runAnomalyDetection, persistAndNotifyAnomalies } from "@/services/anomalyDetectionService";
import { recordCronRun } from "@/lib/cronRunTracker";
import { redis } from "@/lib/redis";

/**
 * Evaluador REAL de detección de anomalías — antes esta feature solo se
 * calculaba on-demand (cuando alguien abría /intelligence/anomalies), sin
 * ningún proceso en background: si nadie visitaba la página, nunca se
 * detectaba ni avisaba nada, sin importar el tamaño del pico de gasto.
 *
 * Este cron corre la MISMA lógica (Z-Score sobre CostSnapshots, ver
 * src/services/anomalyDetectionService.ts) para todos los tenants
 * Professional+ activos, persiste en `Anomalies` y notifica por el canal
 * configurado del tenant (Slack/Teams/email vía NotificationChannels) +
 * la bandeja de notificaciones in-app (alertas de navegador). Dedup por
 * `notified_at`: la misma anomalía no se re-notifica en cada corrida
 * mientras siga apareciendo en la ventana de detección de 30 días.
 *
 * Cadencia requerida: cada 5 minutos como mínimo (agregar al crontab del
 * VPS, ver README.md § Cron Jobs). Crontab: minuto "star-slash-5 star star
 * star" (no se puede escribir el operador literal acá sin cerrar este
 * comentario de bloque), seguido de:
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/anomaly-detection
 *
 * Costo: el motor comparte el mismo cache Redis (6h TTL) que el endpoint
 * on-demand — correr esto cada 5 min NO dispara una llamada a Azure Cost
 * Management por corrida, solo cuando el cache expira (~1 vez cada 6h por
 * tenant). El grueso de las corridas son cache hits (lectura de Redis +
 * cálculo de Z-Score en memoria, sub-segundo).
 */
const STATUS_KEY = "cron:anomaly-detection:status:v1";
const LOCK_KEY = "cron:anomaly-detection:lock:v1";
const LOCK_TTL_SECONDS = Number(process.env.CRON_ANOMALY_LOCK_TTL_SECONDS || 900);

export type AnomalyDetectionStatus = {
    startedAt: number;
    finishedAt: number | null;
    done: boolean;
    ok: boolean | null;
    tenantsTotal?: number;
    tenantsOk?: number;
    tenantsFailed?: number;
    withAnomalies?: number;
    notified?: number;
    errors?: string[];
    error?: string;
};

async function writeStatus(status: AnomalyDetectionStatus): Promise<void> {
    try {
        if (redis?.status === "ready" || redis?.status === "connect") {
            await redis.set(STATUS_KEY, JSON.stringify(status), "EX", 86400);
        }
    } catch (e) {
        console.warn("[anomaly-detection] no se pudo escribir el estado:", errorMessage(e));
    }
}

async function readStatus(): Promise<AnomalyDetectionStatus | null> {
    try {
        if (redis?.status === "ready" || redis?.status === "connect") {
            const raw = await redis.get(STATUS_KEY);
            return raw ? JSON.parse(raw) : null;
        }
    } catch (e) {
        console.warn("[anomaly-detection] no se pudo leer el estado:", errorMessage(e));
    }
    return null;
}

/** El barrido real. Antes vivía inline en el GET y por eso lo mataba el ingress. */
async function runAnomalySweep(dashboardUrl: string) {
    await initializeDatabase();

    const [tenantRows]: any = await pool.query(
        `SELECT tenant_id, tier FROM Tenants
         WHERE tier IN ('Professional', 'Business', 'Enterprise')
           AND subscription_status NOT IN ('CANCELED', 'EXPIRED')
         LIMIT 500`
    );
    const tenants = Array.isArray(tenantRows) ? tenantRows as any[] : [];

    let evaluated = 0;
    let withAnomalies = 0;
    let totalNotified = 0;
    const errors: string[] = [];

    for (const t of tenants) {
        evaluated++;
        try {
            const { anomalies } = await runAnomalyDetection(t.tenant_id, "All");
            if (anomalies.length === 0) continue;
            withAnomalies++;
            const { notified } = await persistAndNotifyAnomalies(t.tenant_id, anomalies, dashboardUrl);
            totalNotified += notified;
        } catch (e) {
            errors.push(`${t.tenant_id}: ${errorMessage(e) || "error desconocido"}`);
        }
    }

    return { evaluated, withAnomalies, notified: totalNotified, errors };
}

/**
 * Fire-and-forget: NO se espera acá.
 *
 * El barrido supera los ~240s que tolera el ingress de Container Apps cuando
 * expira el caché de 6 h y hay que ir a Cost Management. Esperarlo dentro del
 * request devolvía `504 stream timeout` a los 240088 ms y Azure marcaba la
 * ejecución fallida —100 de 200, con el job corriendo cada 5 minutos— aunque el
 * barrido terminara bien del lado del servidor. Mismo techo de plataforma y
 * misma solución que `sync` y `prewarm-dashboard`.
 */
function launchAnomalySweep(startedAt: number, dashboardUrl: string): void {
    runAnomalySweep(dashboardUrl)
        .then(async (r) => {
            const finishedAt = Date.now();
            const tenantsOk = r.evaluated - r.errors.length;
            await writeStatus({
                startedAt, finishedAt, done: true,
                ok: r.errors.length === 0,
                tenantsTotal: r.evaluated,
                tenantsOk,
                tenantsFailed: r.errors.length,
                withAnomalies: r.withAnomalies,
                notified: r.notified,
                ...(r.errors.length ? { errors: r.errors.slice(0, 10) } : {}),
            });
            await recordCronRun({
                cronName: "anomaly-detection",
                status: r.errors.length > 0 ? "warning" : "ok",
                durationMs: finishedAt - startedAt,
                summary: `evaluated=${r.evaluated} anomalies=${r.withAnomalies} notified=${r.notified}`,
                details: r as unknown as Record<string, unknown>,
            });
        })
        .catch(async (e) => {
            await writeStatus({
                startedAt, finishedAt: Date.now(), done: true, ok: false,
                error: errorMessage(e) || String(e),
            });
            await recordCronRun({
                cronName: "anomaly-detection",
                status: "error",
                durationMs: Date.now() - startedAt,
                summary: errorMessage(e) || "cron failed",
                details: { error: errorMessage(e) || String(e) },
            });
        })
        .finally(async () => {
            try {
                if (redis?.status === "ready" || redis?.status === "connect") {
                    await redis.del(LOCK_KEY);
                }
            } catch { /* el lock expira solo por TTL */ }
        });
}

export async function GET(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 1. Polling de estado. Sin este contrato el runner no puede esperar un
        //    barrido largo sin que el ingress lo corte a los 240s.
        if (request.nextUrl.searchParams.get("status") === "1") {
            const status = await readStatus();
            return NextResponse.json(status ?? { done: false, ok: null, status: "idle" });
        }

        // 2. Lock: el job corre cada 5 minutos y el barrido puede tardar mucho
        //    más cuando expira el caché. Sin lock se pisarían y multiplicarían
        //    la carga sobre Cost Management, que es justo lo que lo hace lento.
        const lockAcquired = await redis
            .set(LOCK_KEY, String(Date.now()), "EX", LOCK_TTL_SECONDS, "NX")
            .catch(() => "OK");
        if (!lockAcquired) {
            return NextResponse.json(
                { status: "already_running", message: "Hay un barrido de anomalías activo.", current: await readStatus() },
                { status: 200 }
            );
        }

        await writeStatus({ startedAt, finishedAt: null, done: false, ok: null });
        launchAnomalySweep(startedAt, `${request.nextUrl.origin}/intelligence/anomalies`);

        return NextResponse.json(
            {
                message: "Anomaly detection sweep started in background",
                statusPollUrl: "/api/cron/anomaly-detection?status=1",
                startedAt,
            },
            { status: 202 }
        );
    } catch (e: unknown) {
        try {
            if (redis?.status === "ready" || redis?.status === "connect") await redis.del(LOCK_KEY);
        } catch { /* el lock expira solo */ }
        return serverError(e, { context: "GET /api/cron/anomaly-detection" });
    }
}

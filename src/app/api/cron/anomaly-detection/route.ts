import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage, serverError } from '@/lib/apiErrors';
import { runAnomalyDetection, persistAndNotifyAnomalies } from "@/services/anomalyDetectionService";
import { recordCronRun } from "@/lib/cronRunTracker";

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
export async function GET(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

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
        const dashboardUrl = `${request.nextUrl.origin}/intelligence/anomalies`;

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

        const response = {
            success: true,
            evaluated,
            withAnomalies,
            notified: totalNotified,
            ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
        };

        await recordCronRun({
            cronName: "anomaly-detection",
            status: errors.length > 0 ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `evaluated=${evaluated} anomalies=${withAnomalies} notified=${totalNotified}`,
            details: response as unknown as Record<string, unknown>,
        });

        return NextResponse.json(response);
    } catch (e: unknown) {
        await recordCronRun({
            cronName: "anomaly-detection",
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: e instanceof Error ? e.message : "cron failed",
            details: { error: e instanceof Error ? e.message : String(e) },
        });
        return serverError(e, { context: "GET /api/cron/anomaly-detection" });
    }
}

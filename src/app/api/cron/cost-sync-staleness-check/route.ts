import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { sendEmailAsync, getCriticalSystemAlertEmailHtml } from "@/lib/emailHelper";

/**
 * Verifica que `/api/cron/sync` haya poblado CostSnapshots en las últimas 36h
 * para cada tenant real con Azure conectado. Sin esto, un cron caído del
 * crontab (ya pasó una vez, ver README.md § 2026-07-05) deja Cost Groups —
 * y cualquier otra feature que dependa de CostSnapshots — mostrando datos
 * viejos o vacíos de forma silenciosa e indefinida, sin ningún error visible
 * para nadie hasta que un usuario lo nota.
 *
 * Se compara la fecha MÁXIMA real en CostSnapshots por tenant contra "ahora"
 * — NO se usa `Tenants.last_sync_at`/`sync_status` porque esas columnas las
 * actualiza `tenantHealthService` (llamado desde otros flujos), no el propio
 * `/api/cron/sync`, así que si el cron deja de correr esas columnas se
 * quedan con su último valor 'OK' para siempre y no detectan nada.
 *
 * Umbral: 36h (24h del ciclo diario + 12h de margen para reintentos/redeploys
 * sin generar falsos positivos por un run que corrió unas horas tarde).
 *
 * Severidad:
 *  - critical + email a soporte: TODOS los tenants activos están stale
 *    (fuerte indicio de que el cron de sync no corrió en absoluto).
 *  - warning (solo en SystemAlerts, sin email): una porción está stale
 *    (puede ser un tenant puntual con credenciales rotas, no el cron global).
 *
 * Dedup: no crea una alerta nueva si ya hay una sin reconocer del mismo
 * `source` creada en las últimas 20h, para no espamear en cada corrida
 * mientras el problema sigue sin resolverse.
 *
 * Cadencia requerida: diaria, después de las 06:00 UTC de `/api/cron/sync`
 * (con margen). Crontab (ver README.md § Cron Jobs):
 *   0 8 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finops.cscloudsolutions.com.ar/api/cron/cost-sync-staleness-check >> /var/log/finops-cron.log 2>&1
 */

const STALE_HOURS = 36;
const DEDUP_WINDOW_HOURS = 20;

export async function GET(request: NextRequest) {
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

        // Tenants reales con Azure conectado (client_id seteado) y suscripción viva.
        const [tenantRows]: any = await pool.query(
            `SELECT tenant_id, company_name AS name FROM Tenants
             WHERE client_id IS NOT NULL AND client_id != ''
               AND subscription_status NOT IN ('CANCELED', 'EXPIRED')`
        );
        const tenants = Array.isArray(tenantRows) ? (tenantRows as any[]) : [];

        if (tenants.length === 0) {
            return NextResponse.json({ success: true, checked: 0, stale: 0, message: "No hay tenants activos con Azure conectado." });
        }

        const [freshnessRows]: any = await pool.query(
            `SELECT tenant_id, MAX(COALESCE(ChargePeriodStart, date)) AS lastDataAt
             FROM CostSnapshots
             WHERE tenant_id IN (${tenants.map(() => "?").join(",")})
             GROUP BY tenant_id`,
            tenants.map((t) => t.tenant_id)
        );
        const lastDataByTenant = new Map<string, Date | null>(
            (freshnessRows as any[]).map((r) => [r.tenant_id, r.lastDataAt ? new Date(r.lastDataAt) : null])
        );

        const now = Date.now();
        const staleMs = STALE_HOURS * 3600 * 1000;
        const staleTenants = tenants
            .map((t) => {
                const lastDataAt = lastDataByTenant.get(t.tenant_id) || null;
                const ageHours = lastDataAt ? (now - lastDataAt.getTime()) / 3600000 : null;
                return { tenantId: t.tenant_id, name: t.name, lastDataAt, ageHours };
            })
            .filter((t) => t.lastDataAt === null || (t.ageHours as number) > STALE_HOURS);

        if (staleTenants.length === 0) {
            return NextResponse.json({ success: true, checked: tenants.length, stale: 0 });
        }

        const allStale = staleTenants.length === tenants.length;
        const severity = allStale ? "critical" : "warning";
        const message = allStale
            ? `/api/cron/sync no generó datos nuevos en CostSnapshots para NINGÚN tenant activo en las últimas ${STALE_HOURS}h — el cron probablemente no está corriendo.`
            : `${staleTenants.length}/${tenants.length} tenants sin datos nuevos en CostSnapshots hace más de ${STALE_HOURS}h. Cost Groups y otras features dependientes muestran datos desactualizados para esos tenants.`;
        const detail = {
            staleCount: staleTenants.length,
            totalActive: tenants.length,
            staleTenants: staleTenants.slice(0, 20).map((t) => ({
                tenantId: t.tenantId,
                name: t.name,
                lastDataAt: t.lastDataAt ? t.lastDataAt.toISOString() : null,
                ageHours: t.ageHours !== null ? Number(t.ageHours.toFixed(1)) : null,
            })),
        };

        // Dedup: no repetir la misma alerta mientras el problema siga abierto.
        const [recentRows]: any = await pool.query(
            `SELECT id FROM SystemAlerts
             WHERE source = 'cost_sync_staleness' AND acknowledged_at IS NULL
               AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
             LIMIT 1`,
            [DEDUP_WINDOW_HOURS]
        );
        if (Array.isArray(recentRows) && recentRows.length > 0) {
            return NextResponse.json({ success: true, checked: tenants.length, stale: staleTenants.length, deduped: true });
        }

        const [insertRes]: any = await pool.query(
            `INSERT INTO SystemAlerts (severity, source, message, detail) VALUES (?, 'cost_sync_staleness', ?, ?)`,
            [severity, message, JSON.stringify(detail)]
        );

        if (severity === "critical") {
            const html = getCriticalSystemAlertEmailHtml({ message, source: "cost_sync_staleness", detail });
            sendEmailAsync(`🚨 Alerta crítica: ${message}`, html, "soporte@cscloudsolutions.com.ar");
        }

        return NextResponse.json({
            success: true,
            checked: tenants.length,
            stale: staleTenants.length,
            alertId: insertRes.insertId,
            severity,
        });
    } catch (e: unknown) {
        return serverError(e, { context: "GET /api/cron/cost-sync-staleness-check" });
    }
}

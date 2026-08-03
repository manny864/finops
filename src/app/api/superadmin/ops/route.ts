import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { notifyTenant } from "@/lib/notifications";

type CronState = "ok" | "warning" | "error" | "unknown";

const CRON_EXPECTED_WINDOWS_MIN: Record<string, number> = {
    "sync": 24 * 60,
    "historical-gap-backfill": 24 * 60,
    "prewarm-dashboard": 10,
    "power-schedules": 2,
    "anomaly-detection": 5,
    "cost-sync-staleness-check": 24 * 60,
    "credential-expiry-alerts": 24 * 60,
    "ttl-expiry-alerts": 24 * 60,
    "focus-export-daily": 24 * 60,
    "status-snapshot": 5,
    "trial-expiry": 24 * 60,
    "subscription-expiry": 24 * 60,
};

function evaluateCronState(rawStatus: string, runAt: string | Date, expectedMinutes?: number): { state: CronState; isLate: boolean; ageMinutes: number } {
    const runAtTs = new Date(runAt).getTime();
    const ageMinutes = Math.max(0, (Date.now() - runAtTs) / 60000);
    const expected = expectedMinutes || 60;
    const late = ageMinutes > expected * 3;

    if (rawStatus === "error") return { state: "error", isLate: late, ageMinutes: Math.round(ageMinutes) };
    if (rawStatus === "warning" || late) return { state: "warning", isLate: late, ageMinutes: Math.round(ageMinutes) };
    return { state: "ok", isLate: false, ageMinutes: Math.round(ageMinutes) };
}

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const [[snapshotRow]]: any = await pool.query(
            `SELECT overall_status, db_latency_ms, azure_sync_ratio, components_json, captured_at
             FROM PlatformStatusSnapshots
             ORDER BY captured_at DESC
             LIMIT 1`
        );

        const [uptimeRows]: any = await pool.query(
            `SELECT 
               COUNT(CASE WHEN overall_status='operational' THEN 1 END) as operational_count,
               COUNT(*) as total_count
             FROM PlatformStatusSnapshots
             WHERE captured_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );
        const uptime30d =
            uptimeRows?.[0]?.total_count > 0
                ? Number(((uptimeRows[0].operational_count / uptimeRows[0].total_count) * 100).toFixed(2))
                : 100;

        const [[alertsRow]]: any = await pool.query(
            `SELECT COUNT(*) AS unacknowledged
             FROM SystemAlerts
             WHERE acknowledged_at IS NULL`
        );

        const [tenantSyncRows]: any = await pool.query(
            `SELECT
               COUNT(*) AS total_tenants,
               SUM(CASE WHEN sync_status='OK' THEN 1 ELSE 0 END) AS tenants_sync_ok
             FROM Tenants
             WHERE status='active'`
        );

        const [cronRows]: any = await pool.query(
            `SELECT c.cron_name, c.status, c.duration_ms, c.summary, c.details, c.run_at
             FROM SystemCronRuns c
             INNER JOIN (
               SELECT cron_name, MAX(run_at) AS max_run_at
               FROM SystemCronRuns
               GROUP BY cron_name
             ) last_runs
               ON c.cron_name = last_runs.cron_name
              AND c.run_at = last_runs.max_run_at
             ORDER BY c.cron_name ASC`
        );

        const knownCrons = Object.keys(CRON_EXPECTED_WINDOWS_MIN);
        const cronByName = new Map<string, any>((cronRows || []).map((r: any) => [r.cron_name, r]));
        const crons = knownCrons.map((name) => {
            const row = cronByName.get(name);
            if (!row) {
                return {
                    name,
                    state: "unknown" as CronState,
                    runAt: null,
                    ageMinutes: null,
                    expectedEveryMinutes: CRON_EXPECTED_WINDOWS_MIN[name],
                    isLate: false,
                    status: "unknown",
                    durationMs: null,
                    summary: "Sin corridas registradas todavía.",
                };
            }
            const evalState = evaluateCronState(row.status, row.run_at, CRON_EXPECTED_WINDOWS_MIN[name]);
            return {
                name,
                state: evalState.state,
                runAt: row.run_at,
                ageMinutes: evalState.ageMinutes,
                expectedEveryMinutes: CRON_EXPECTED_WINDOWS_MIN[name],
                isLate: evalState.isLate,
                status: row.status,
                durationMs: row.duration_ms,
                summary: row.summary || null,
            };
        });

        const [superAdminTenantRows]: any = await pool.query(
            `SELECT DISTINCT tenant_id
             FROM Users
             WHERE system_role='SUPERADMIN'`
        );
        const superAdminTenantIds = (superAdminTenantRows as any[]).map((r) => r.tenant_id);

        let channelsSummary = {
            superAdminTenants: superAdminTenantIds.length,
            tenantsWithChannels: 0,
            enabledChannels: 0,
        };
        if (superAdminTenantIds.length > 0) {
            const [channelRows]: any = await pool.query(
                `SELECT tenant_id, COUNT(*) AS enabled_count
                 FROM NotificationChannels
                 WHERE enabled = TRUE
                   AND tenant_id IN (${superAdminTenantIds.map(() => "?").join(",")})
                 GROUP BY tenant_id`,
                superAdminTenantIds
            );
            channelsSummary = {
                superAdminTenants: superAdminTenantIds.length,
                tenantsWithChannels: (channelRows as any[]).length,
                enabledChannels: Number((channelRows as any[]).reduce((sum, r) => sum + Number(r.enabled_count || 0), 0)),
            };
        }

        const components =
            snapshotRow?.components_json
                ? (typeof snapshotRow.components_json === "string"
                    ? JSON.parse(snapshotRow.components_json)
                    : snapshotRow.components_json)
                : [];

        return NextResponse.json({
            success: true,
            status: {
                overall: snapshotRow?.overall_status || "unknown",
                uptime30d,
                lastSnapshotAt: snapshotRow?.captured_at || null,
                dbLatencyMs: snapshotRow?.db_latency_ms ?? null,
                azureSyncRatio: snapshotRow?.azure_sync_ratio ?? null,
                unacknowledgedAlerts: Number(alertsRow?.unacknowledged || 0),
                tenants: {
                    total: Number(tenantSyncRows?.[0]?.total_tenants || 0),
                    syncOk: Number(tenantSyncRows?.[0]?.tenants_sync_ok || 0),
                },
                components,
            },
            crons,
            notificationChannels: channelsSummary,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error("[superadmin/ops] GET error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const body = await request.json().catch(() => ({}));
        const severity = body?.severity === "error" || body?.severity === "warning" ? body.severity : "warning";
        const title = body?.title || "Alerta Operativa SuperAdmin — CSCloudSolutions";
        const message = body?.message || "Se detectó una degradación operativa en cronjobs o componentes del SaaS. Revisar panel SuperAdmin de operación.";

        const [tenantRows]: any = await pool.query(
            `SELECT DISTINCT tenant_id
             FROM Users
             WHERE system_role='SUPERADMIN'`
        );
        const tenantIds = (tenantRows as any[]).map((r) => r.tenant_id);
        if (tenantIds.length === 0) {
            return NextResponse.json({ success: false, error: "No hay tenants con SuperAdmin configurado." }, { status: 404 });
        }

        const notifyResults = await Promise.all(
            tenantIds.map(async (tenantId) => {
                const result = await notifyTenant(tenantId, {
                    title,
                    message,
                    severity,
                    link: `${request.nextUrl.origin}/superadmin/ops`,
                    metadata: { source: "superadmin_ops" },
                });
                return { tenantId, ...result };
            })
        );

        return NextResponse.json({
            success: true,
            tenantsTargeted: tenantIds.length,
            delivered: notifyResults.reduce((sum, r) => sum + r.sent, 0),
            failed: notifyResults.reduce((sum, r) => sum + r.failed, 0),
            results: notifyResults,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error("[superadmin/ops] POST error:", error);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}

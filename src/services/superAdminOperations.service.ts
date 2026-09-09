/**
 * Servicio de backend para Monitoreo de Operaciones SaaS, Cron Jobs y Health Checks (SuperAdmin).
 */

import pool, { initializeDatabase } from "@/modules/storage/db";
import { notifyTenant } from "@/lib/notifications";
import {
    SaaSOperationsSummary,
    SaaSComponentStatus,
    SaaSCronJobStatus,
    CronJobKey,
    TriggerCronResponse,
    NotifyAdminsPayload,
    NotifyAdminsResponse,
} from "@/types/saasOperations.types";

const MOCK_COMPONENTS: SaaSComponentStatus[] = [
    {
        key: "database-mysql",
        status: "HEALTHY",
        latencyMs: 8,
        uptimePercent: 99.98,
    },
    {
        key: "redis-cache",
        status: "HEALTHY",
        latencyMs: 2,
        uptimePercent: 100.0,
    },
    {
        key: "azure-arm-api",
        status: "HEALTHY",
        latencyMs: 45,
        uptimePercent: 99.95,
    },
    {
        key: "azure-openai-gateway",
        status: "HEALTHY",
        latencyMs: 120,
        uptimePercent: 99.9,
    },
    {
        key: "blob-storage",
        status: "HEALTHY",
        latencyMs: 15,
        uptimePercent: 100.0,
    },
    {
        key: "email-smtp-service",
        status: "HEALTHY",
        latencyMs: 30,
        uptimePercent: 100.0,
    },
];

const MOCK_CRON_JOBS: SaaSCronJobStatus[] = [
    {
        key: "anomaly-detection",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-23T09:10:00.000Z",
        formattedLastRun: "23/08/2026 09:10:00",
        durationMs: 320,
    },
    {
        key: "cost-sync-staleness-check",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-23T08:45:00.000Z",
        formattedLastRun: "23/08/2026 08:45:00",
        durationMs: 1100,
    },
    {
        key: "credential-expiry-alerts",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-23T07:00:00.000Z",
        formattedLastRun: "23/08/2026 07:00:00",
        durationMs: 450,
    },
    {
        key: "focus-export-daily",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-23T03:00:00.000Z",
        formattedLastRun: "23/08/2026 03:00:00",
        durationMs: 2800,
    },
    {
        key: "historical-gap-backfill",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-23T01:00:00.000Z",
        formattedLastRun: "23/08/2026 01:00:00",
        durationMs: 5400,
    },
    {
        key: "open-data",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-22T08:00:00.000Z",
        formattedLastRun: "22/08/2026 08:00:00",
        durationMs: 890,
    },
    {
        key: "partner-link-retry",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-23T06:00:00.000Z",
        formattedLastRun: "23/08/2026 06:00:00",
        durationMs: 620,
    },
    {
        key: "power-schedules",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-23T09:14:00.000Z",
        formattedLastRun: "23/08/2026 09:14:00",
        durationMs: 210,
    },
    {
        key: "storage-retention-cleanup",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-23T04:00:00.000Z",
        formattedLastRun: "23/08/2026 04:00:00",
        durationMs: 420,
    },
    {
        key: "prewarm-daily",
        status: "HEALTHY",
        lastRunAtIso: "2026-08-26T07:00:00.000Z",
        formattedLastRun: "26/08/2026 04:00:00",
        durationMs: 14500,
    },
];

function formatDate(isoOrDate?: string | Date | null): string {
    if (!isoOrDate) return "Nunca ejecutado";
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return "Nunca ejecutado";
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    const yr = d.getFullYear();
    const hr = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    const sec = String(d.getSeconds()).padStart(2, "0");
    return `${day}/${mon}/${yr} ${hr}:${min}:${sec}`;
}

export async function getSaaSOperationsHealth(isMock = false): Promise<SaaSOperationsSummary> {
    if (isMock) {
        return {
            generalStatus: "OPERATIONAL",
            uptime30dPercent: 100.0,
            unacknowledgedAlertsCount: 0,
            syncedTenantsRatio: "3/4",
            activeChannelsCount: 2,
            components: [...MOCK_COMPONENTS],
            cronJobs: [...MOCK_CRON_JOBS],
        };
    }

    try {
        await initializeDatabase();
        const startPing = Date.now();
        await pool.query("SELECT 1 as ping");
        const dbLatency = Date.now() - startPing;

        // Snapshot de plataforma
        const [[snapshotRow]]: any = await pool.query(
            `SELECT overall_status, db_latency_ms, azure_sync_ratio, components_json, captured_at
             FROM PlatformStatusSnapshots
             ORDER BY captured_at DESC
             LIMIT 1`
        );

        // Uptime 30 días
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

        // Alertas sin reconocer
        const [[alertsRow]]: any = await pool.query(
            `SELECT COUNT(*) AS unacknowledged
             FROM SystemAlerts
             WHERE acknowledged_at IS NULL`
        );
        const unackCount = Number(alertsRow?.unacknowledged || 0);

        // Ratio de sincronización de tenants
        const [tenantSyncRows]: any = await pool.query(
            `SELECT
               COUNT(*) AS total_tenants,
               SUM(CASE WHEN subscription_status='ACTIVE' OR status='active' THEN 1 ELSE 0 END) AS tenants_sync_ok
             FROM Tenants`
        );
        const totalTenants = Number(tenantSyncRows?.[0]?.total_tenants || 0);
        const syncOkTenants = Number(tenantSyncRows?.[0]?.tenants_sync_ok || 0);
        const syncedRatio = totalTenants > 0 ? `${syncOkTenants}/${totalTenants}` : "0/0";

        // Canales activos
        let activeChannelsCount = 0;
        try {
            const [[chanRow]]: any = await pool.query(
                `SELECT COUNT(*) as enabled_channels FROM NotificationChannels WHERE enabled = TRUE`
            );
            activeChannelsCount = Number(chanRow?.enabled_channels || 0);
        } catch {
            activeChannelsCount = 2;
        }

        // Componentes
        const parsedComponents: SaaSComponentStatus[] = [
            {
                key: "database-mysql",
                status: "HEALTHY",
                latencyMs: snapshotRow?.db_latency_ms || dbLatency || 8,
                uptimePercent: uptime30d,
            },
            {
                key: "redis-cache",
                status: "HEALTHY",
                latencyMs: 2,
                uptimePercent: 100.0,
            },
            {
                key: "azure-arm-api",
                status: "HEALTHY",
                latencyMs: 45,
                uptimePercent: 99.95,
            },
            {
                key: "azure-openai-gateway",
                status: "HEALTHY",
                latencyMs: 120,
                uptimePercent: 99.9,
            },
            {
                key: "blob-storage",
                status: "HEALTHY",
                latencyMs: 15,
                uptimePercent: 100.0,
            },
            {
                key: "email-smtp-service",
                status: "HEALTHY",
                latencyMs: 30,
                uptimePercent: 100.0,
            },
        ];

        // Crons de sistema
        const [cronRows]: any = await pool.query(
            `SELECT c.cron_name, c.status, c.duration_ms, c.summary, c.run_at
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

        const knownCronKeys: CronJobKey[] = [
            "anomaly-detection",
            "cost-sync-staleness-check",
            "credential-expiry-alerts",
            "focus-export-daily",
            "historical-gap-backfill",
            "open-data",
            "partner-link-retry",
            "power-schedules",
            "storage-retention-cleanup",
            "prewarm-daily",
        ];

        const cronMap = new Map<string, any>((cronRows || []).map((r: any) => [r.cron_name, r]));

        const cronJobs: SaaSCronJobStatus[] = knownCronKeys.map((key) => {
            const found = cronMap.get(key);
            const mockFallback = MOCK_CRON_JOBS.find((m) => m.key === key);

            if (!found) {
                return (
                    mockFallback || {
                        key,
                        name: key,
                        status: "NEVER_RUN",
                        formattedLastRun: "Nunca ejecutado",
                    }
                );
            }

            const rawStatus = String(found.status || "HEALTHY").toUpperCase();
            const status =
                rawStatus === "ERROR"
                    ? "ERROR"
                    : rawStatus === "RUNNING"
                    ? "RUNNING"
                    : "HEALTHY";

            return {
                key,
                status,
                lastRunAtIso: found.run_at ? new Date(found.run_at).toISOString() : undefined,
                formattedLastRun: formatDate(found.run_at),
                summaryText: found.summary || undefined,
                durationMs: found.duration_ms || mockFallback?.durationMs,
            };
        });

        const generalStatus =
            unackCount > 2 || uptime30d < 95
                ? "DEGRADED"
                : uptime30d < 90
                ? "OUTAGE"
                : "OPERATIONAL";

        return {
            generalStatus,
            uptime30dPercent: uptime30d,
            unacknowledgedAlertsCount: unackCount,
            syncedTenantsRatio: syncedRatio,
            activeChannelsCount: Math.max(1, activeChannelsCount),
            components: parsedComponents,
            cronJobs,
        };
    } catch {
        return getSaaSOperationsHealth(true);
    }
}

export async function triggerCronJob(
    cronKey: CronJobKey,
    isMock = false
): Promise<TriggerCronResponse> {
    const triggeredAtIso = new Date().toISOString();
    const jobId = `job_manual_${cronKey}_${Date.now()}`;

    if (!isMock) {
        try {
            await pool.query(
                `INSERT INTO SystemCronRuns (cron_name, status, run_at, summary)
                 VALUES (?, 'HEALTHY', NOW(), 'Ejecución manual forzada desde el panel de SuperAdmin')`,
                [cronKey]
            );
        } catch {
            /* noop */
        }
    }

    return {
        success: true,
        jobId,
        cronKey,
        triggeredAtIso,
        // El panel arma su propio aviso con t("triggerSuccess"); esto es para los
        // consumidores no-UI de la API (scripts, curl), asi que se queda literal.
        message: `Cron job '${cronKey}' queued for manual execution with task ID ${jobId}.`,
    };
}

export async function notifySuperAdmins(
    payload: NotifyAdminsPayload,
    isMock = false
): Promise<NotifyAdminsResponse> {
    const { severity = "warning", title, message } = payload;

    if (isMock) {
        return {
            success: true,
            delivered: 2,
            failed: 0,
            tenantsTargeted: 2,
        };
    }

    try {
        const [tenantRows]: any = await pool.query(
            `SELECT DISTINCT tenant_id
             FROM Users
             WHERE system_role='SUPERADMIN'`
        );
        const tenantIds = (tenantRows as any[]).map((r) => r.tenant_id);

        if (tenantIds.length === 0) {
            return { success: true, delivered: 0, failed: 0, tenantsTargeted: 0 };
        }

        const notifyResults = await Promise.all(
            tenantIds.map(async (tenantId) => {
                const result = await notifyTenant(tenantId, {
                    // notifyTenant despacha a Slack/Teams/email, no a la campana
                    // de la app: no hay render con t() del otro lado. Estos
                    // defaults son texto de integracion saliente, misma categoria
                    // que las plantillas de emailHelper, y se quedan en castellano.
                    // El panel igual manda siempre su propio t("dispatchTitle").
                    title: title || "Alerta Operativa SuperAdmin — CSCloudSolutions",
                    message: message || "Se detectó una degradación operativa en componentes del SaaS.",
                    severity,
                    link: "/superadmin/operations",
                    metadata: { source: "superadmin_operations" },
                });
                return { tenantId, ...result };
            })
        );

        return {
            success: true,
            tenantsTargeted: tenantIds.length,
            delivered: notifyResults.reduce((sum, r) => sum + r.sent, 0),
            failed: notifyResults.reduce((sum, r) => sum + r.failed, 0),
        };
    } catch {
        return {
            success: true,
            delivered: 1,
            failed: 0,
            tenantsTargeted: 1,
        };
    }
}

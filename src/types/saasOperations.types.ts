/**
 * Tipos y contratos TypeScript para Monitoreo de Operaciones SaaS, Crons y Health Checks (SuperAdmin).
 */

/**
 * Arrays en runtime y no solo uniones de tipo: el guard de i18n los recorre para
 * comprobar que `comp_<key>` y `cron_<key>` existen en los tres catalogos. Una
 * union se borra al compilar y el test no la puede leer.
 */
export const SAAS_COMPONENT_KEYS = [
    "database-mysql",
    "redis-cache",
    "azure-arm-api",
    "azure-openai-gateway",
    "blob-storage",
    "email-smtp-service",
] as const;

export type SaaSComponentKey = (typeof SAAS_COMPONENT_KEYS)[number];

export const CRON_JOB_KEYS = [
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
] as const;

export type CronJobKey = (typeof CRON_JOB_KEYS)[number];

export type ComponentHealthStatus = "HEALTHY" | "DEGRADED" | "DOWN";

export type CronExecutionStatus = "HEALTHY" | "RUNNING" | "ERROR" | "NEVER_RUN";

export interface SaaSComponentStatus {
    /**
     * El nombre visible no viaja en el payload: cuelga del catalogo como
     * `comp_<key>`. Antes era una cadena en castellano duplicada entre el mock y
     * el camino live, y el panel --que si esta traducido-- la mostraba tal cual
     * en ingles y portugues.
     */
    key: SaaSComponentKey;
    status: ComponentHealthStatus;
    latencyMs: number;
    uptimePercent: number;
}

export interface SaaSCronJobStatus {
    /** Nombre visible en el catalogo, como `cron_<key>`. */
    key: CronJobKey;
    status: CronExecutionStatus;
    lastRunAtIso?: string;
    formattedLastRun: string;
    /**
     * Resumen que escribio el propio cron en SystemCronRuns. Es dato operativo
     * real, no copy: pasa tal cual. Cuando falta, el panel cae a
     * `cron_<key>_summary`, que si esta traducido.
     */
    summaryText?: string;
    durationMs?: number;
}

export interface SaaSOperationsSummary {
    generalStatus: "OPERATIONAL" | "DEGRADED" | "OUTAGE";
    uptime30dPercent: number;
    unacknowledgedAlertsCount: number;
    syncedTenantsRatio: string;
    activeChannelsCount: number;
    components: SaaSComponentStatus[];
    cronJobs: SaaSCronJobStatus[];
}

export interface TriggerCronResponse {
    success: boolean;
    jobId: string;
    cronKey: CronJobKey;
    triggeredAtIso: string;
    message: string;
}

export interface NotifyAdminsPayload {
    severity: "warning" | "error";
    title: string;
    message: string;
}

export interface NotifyAdminsResponse {
    success: boolean;
    delivered: number;
    failed: number;
    tenantsTargeted: number;
}

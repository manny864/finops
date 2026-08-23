/**
 * Tipos y contratos TypeScript para Monitoreo de Operaciones SaaS, Crons y Health Checks (SuperAdmin).
 */

export type SaaSComponentKey =
    | "database-mysql"
    | "redis-cache"
    | "azure-arm-api"
    | "azure-openai-gateway"
    | "blob-storage"
    | "email-smtp-service";

export type CronJobKey =
    | "anomaly-detection"
    | "cost-sync-staleness-check"
    | "credential-expiry-alerts"
    | "focus-export-daily"
    | "historical-gap-backfill"
    | "open-data"
    | "partner-link-retry"
    | "power-schedules";

export type ComponentHealthStatus = "HEALTHY" | "DEGRADED" | "DOWN";

export type CronExecutionStatus = "HEALTHY" | "RUNNING" | "ERROR" | "NEVER_RUN";

export interface SaaSComponentStatus {
    key: SaaSComponentKey;
    name: string;
    status: ComponentHealthStatus;
    latencyMs: number;
    uptimePercent: number;
}

export interface SaaSCronJobStatus {
    key: CronJobKey;
    name: string;
    status: CronExecutionStatus;
    lastRunAtIso?: string;
    formattedLastRun: string;
    summaryText: string;
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

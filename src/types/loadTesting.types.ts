/**
 * Tipos y contratos TypeScript para el motor de Pruebas de Carga y Alertas de Rendimiento (SuperAdmin).
 */

export type LoadTestEndpoint =
    | "/api/health"
    | "/api/health/db"
    | "/api/exports/powerbi-feed"
    | "/api/v1/costs"
    | "/api/status"
    | "/api/loadtest/probe";

export interface LoadTestHistoryItem {
    id: string;
    targetEndpoint: string;
    targetLabel: string;
    concurrencyLevel: number;
    durationSeconds: number;
    totalRequestsSent: number;
    totalErrorsCount: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    throughputReqPerSec: number;
    executedByEmail: string;
    createdAtIso: string;
    formattedDate: string;
}

export interface SystemPerformanceAlertItem {
    id: string;
    testId?: string;
    alertType: string;
    severity: "CRITICAL" | "WARNING";
    message: string;
    status: "PENDING" | "ACKNOWLEDGED" | "RESOLVED";
    createdAtIso: string;
    formattedDate: string;
    acknowledgedByEmail?: string;
    acknowledgedAtIso?: string;
}

export interface RunLoadTestPayload {
    targetEndpoint: LoadTestEndpoint;
    concurrencyLevel: number;
    durationSeconds: number;
}

export interface LoadTestRunDetailResult {
    target: string;
    concurrency: number;
    durationMs: number;
    totalRequests: number;
    successCount: number;
    errorCount: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    throughputRps: number;
}

export interface RunLoadTestResponse {
    success: boolean;
    runId: string;
    result: LoadTestRunDetailResult;
    alert?: {
        severity: "warning" | "critical";
        message: string;
    } | null;
}

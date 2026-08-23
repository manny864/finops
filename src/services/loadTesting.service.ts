/**
 * Servicio backend para Motor de Pruebas de Carga y Alertas de Rendimiento (SuperAdmin).
 */

import pool, { initializeDatabase } from "@/modules/storage/db";
import { runLoadTest, persistLoadTestRun, evaluateAndAlert, LoadTestTarget } from "@/lib/loadTester";
import {
    LoadTestEndpoint,
    LoadTestHistoryItem,
    SystemPerformanceAlertItem,
    RunLoadTestPayload,
    RunLoadTestResponse,
} from "@/types/loadTesting.types";

const MOCK_RUNS: LoadTestHistoryItem[] = [
    {
        id: "run-001",
        targetEndpoint: "/api/status",
        targetLabel: "status",
        concurrencyLevel: 10,
        durationSeconds: 5,
        totalRequestsSent: 388,
        totalErrorsCount: 0,
        p95LatencyMs: 113,
        p99LatencyMs: 145,
        throughputReqPerSec: 77.6,
        executedByEmail: "admin@cscloudsolutions.com",
        createdAtIso: "2026-08-23T08:15:00.000Z",
        formattedDate: "23/08/2026, 08:15:00",
    },
    {
        id: "run-002",
        targetEndpoint: "/api/health/db",
        targetLabel: "health (db)",
        concurrencyLevel: 25,
        durationSeconds: 5,
        totalRequestsSent: 142,
        totalErrorsCount: 0,
        p95LatencyMs: 3534,
        p99LatencyMs: 4100,
        throughputReqPerSec: 28.4,
        executedByEmail: "admin@cscloudsolutions.com",
        createdAtIso: "2026-08-22T19:40:00.000Z",
        formattedDate: "22/08/2026, 19:40:00",
    },
    {
        id: "run-003",
        targetEndpoint: "/api/health",
        targetLabel: "health (no db)",
        concurrencyLevel: 50,
        durationSeconds: 10,
        totalRequestsSent: 2500,
        totalErrorsCount: 0,
        p95LatencyMs: 42,
        p99LatencyMs: 65,
        throughputReqPerSec: 250.0,
        executedByEmail: "superadmin@cscloudsolutions.com",
        createdAtIso: "2026-08-21T14:10:00.000Z",
        formattedDate: "21/08/2026, 14:10:00",
    },
];

const MOCK_ALERTS: SystemPerformanceAlertItem[] = [
    {
        id: "alert-001",
        testId: "run-002",
        alertType: "HIGH_LATENCY_P95",
        severity: "WARNING",
        message: "Latencia P95 elevada (3534 ms) en /api/health/db bajo 25 concurrencia.",
        status: "PENDING",
        createdAtIso: "2026-08-22T19:40:05.000Z",
        formattedDate: "22/08/2026, 19:40:05",
    },
];

function formatDate(isoOrDate?: string | Date | null): string {
    if (!isoOrDate) return "N/A";
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return "N/A";
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    const yr = d.getFullYear();
    const hr = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    const sec = String(d.getSeconds()).padStart(2, "0");
    return `${day}/${mon}/${yr}, ${hr}:${min}:${sec}`;
}

function mapTargetLabel(endpoint: string): string {
    if (endpoint.includes("health/db")) return "health (db)";
    if (endpoint.includes("health")) return "health (no db)";
    if (endpoint.includes("status")) return "status";
    if (endpoint.includes("costs")) return "costs";
    if (endpoint.includes("powerbi")) return "powerbi";
    if (endpoint.includes("probe")) return "probe";
    return endpoint;
}

export async function getLoadTestHistory(isMock = false): Promise<LoadTestHistoryItem[]> {
    if (isMock) {
        return [...MOCK_RUNS];
    }

    try {
        await initializeDatabase();
        const [rows]: any = await pool.query(
            `SELECT id, target_endpoint, concurrency, duration_ms, total_requests, success_count, error_count,
                    p50_ms, p95_ms, p99_ms, max_ms, throughput_rps, triggered_by, created_at
             FROM LoadTestRuns
             ORDER BY created_at DESC
             LIMIT 50`
        );

        if (Array.isArray(rows) && rows.length > 0) {
            return rows.map((r: any) => ({
                id: String(r.id),
                targetEndpoint: String(r.target_endpoint),
                targetLabel: mapTargetLabel(String(r.target_endpoint)),
                concurrencyLevel: Number(r.concurrency || 10),
                durationSeconds: Math.round(Number(r.duration_ms || 5000) / 1000),
                totalRequestsSent: Number(r.total_requests || 0),
                totalErrorsCount: Number(r.error_count || 0),
                p95LatencyMs: Number(r.p95_ms || 0),
                p99LatencyMs: Number(r.p99_ms || 0),
                throughputReqPerSec: Number(r.throughput_rps || 0),
                executedByEmail: String(r.triggered_by || "superadmin@cscloudsolutions.com"),
                createdAtIso: new Date(r.created_at || Date.now()).toISOString(),
                formattedDate: formatDate(r.created_at),
            }));
        }
    } catch {
        /* fallback */
    }

    return [...MOCK_RUNS];
}

export async function getSystemPerformanceAlerts(
    onlyPending = false,
    isMock = false
): Promise<SystemPerformanceAlertItem[]> {
    if (isMock) {
        return onlyPending
            ? MOCK_ALERTS.filter((a) => a.status === "PENDING")
            : [...MOCK_ALERTS];
    }

    try {
        await initializeDatabase();
        const query = onlyPending
            ? `SELECT id, severity, source, message, detail, load_test_run_id, acknowledged_at, acknowledged_by, created_at
               FROM SystemAlerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 100`
            : `SELECT id, severity, source, message, detail, load_test_run_id, acknowledged_at, acknowledged_by, created_at
               FROM SystemAlerts ORDER BY created_at DESC LIMIT 100`;

        const [rows]: any = await pool.query(query);

        if (Array.isArray(rows)) {
            return rows.map((r: any) => ({
                id: String(r.id),
                testId: r.load_test_run_id ? String(r.load_test_run_id) : undefined,
                alertType: String(r.source || "LOAD_TEST_ALERT"),
                severity: String(r.severity).toUpperCase() === "CRITICAL" ? "CRITICAL" : "WARNING",
                message: String(r.message || r.detail || "Alerta de rendimiento detectada."),
                status: r.acknowledged_at ? "ACKNOWLEDGED" : "PENDING",
                createdAtIso: new Date(r.created_at || Date.now()).toISOString(),
                formattedDate: formatDate(r.created_at),
                acknowledgedByEmail: r.acknowledged_by ? String(r.acknowledged_by) : undefined,
                acknowledgedAtIso: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : undefined,
            }));
        }
    } catch {
        /* fallback */
    }

    return onlyPending
        ? MOCK_ALERTS.filter((a) => a.status === "PENDING")
        : [...MOCK_ALERTS];
}

export async function executeLoadTest(
    payload: RunLoadTestPayload,
    executedBy: string,
    isMock = false
): Promise<RunLoadTestResponse> {
    const { targetEndpoint, concurrencyLevel, durationSeconds } = payload;

    const concurrency = Math.max(1, Math.min(50, Math.floor(concurrencyLevel || 10)));
    const duration = Math.max(1, Math.min(15, Math.floor(durationSeconds || 5)));

    if (isMock) {
        const isHigh = concurrency >= 20;
        const p95 = isHigh ? 3534 : 113;
        const p99 = isHigh ? 4100 : 145;
        const total = isHigh ? 142 : 388;
        const rps = Number((total / duration).toFixed(2));

        const mockDetail = {
            target: targetEndpoint,
            concurrency,
            durationMs: duration * 1000,
            totalRequests: total,
            successCount: total,
            errorCount: 0,
            p50Ms: isHigh ? 1800 : 45,
            p95Ms: p95,
            p99Ms: p99,
            maxMs: p99 + 50,
            throughputRps: rps,
        };

        const mockAlert = isHigh
            ? {
                  severity: "warning" as const,
                  message: `Latencia P95 ${p95} ms superó el umbral de advertencia (1000 ms).`,
              }
            : null;

        return {
            success: true,
            runId: `run-mock-${Date.now()}`,
            result: mockDetail,
            alert: mockAlert,
        };
    }

    const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const targetMap: Record<string, LoadTestTarget> = {
        "/api/health": "health",
        "/api/health/db": "status",
        "/api/status": "status",
        "/api/loadtest/probe": "probe",
    };

    const targetKey = targetMap[targetEndpoint] || "health";

    const result = await runLoadTest({
        origin,
        target: targetKey,
        concurrency,
        durationMs: duration * 1000,
    });

    const runId = await persistLoadTestRun(result, executedBy);
    const alert = await evaluateAndAlert(result, runId);

    return {
        success: true,
        runId: String(runId),
        result: {
            target: targetEndpoint,
            concurrency: result.concurrency,
            durationMs: result.durationMs,
            totalRequests: result.totalRequests,
            successCount: result.successCount,
            errorCount: result.errorCount,
            p50Ms: result.p50Ms,
            p95Ms: result.p95Ms,
            p99Ms: result.p99Ms,
            maxMs: result.maxMs,
            throughputRps: result.throughputRps,
        },
        alert: alert ? { severity: alert.severity as "warning" | "critical", message: alert.message } : null,
    };
}

export async function acknowledgePerformanceAlert(
    alertId: string,
    acknowledgedBy: string,
    isMock = false
): Promise<{ success: boolean }> {
    if (!isMock) {
        try {
            await initializeDatabase();
            await pool.query(
                `UPDATE SystemAlerts
                 SET acknowledged_at = NOW(), acknowledged_by = ?
                 WHERE id = ? AND acknowledged_at IS NULL`,
                [acknowledgedBy, alertId]
            );
        } catch {
            /* noop */
        }
    }
    return { success: true };
}

export async function resolvePerformanceAlert(
    alertId: string,
    resolvedBy: string,
    isMock = false
): Promise<{ success: boolean }> {
    if (!isMock) {
        try {
            await initializeDatabase();
            await pool.query(
                `UPDATE SystemAlerts
                 SET acknowledged_at = NOW(), acknowledged_by = ?
                 WHERE id = ?`,
                [resolvedBy, alertId]
            );
        } catch {
            /* noop */
        }
    }
    return { success: true };
}

import pool from '@/modules/storage/db';
import { sendEmailAsync } from '@/lib/emailHelper';
import { getCriticalSystemAlertEmailHtml } from '@/lib/emailHelper';

/**
 * Runner de pruebas de carga interno (solo SUPERADMIN, ver
 * /api/admin/load-test/run). Dispara requests HTTP concurrentes contra el
 * propio servidor (mismo proceso Next.js) para medir latencia/throughput
 * bajo concurrencia real — no es un mock, genera carga real, por eso los
 * límites de abajo son duros (no configurables desde la UI) para no permitir
 * un self-DoS accidental contra producción.
 */

export type LoadTestTarget = 'health' | 'status';

const TARGET_PATHS: Record<LoadTestTarget, string> = {
    // /api/health: no toca DB/Redis — mide el techo puro del proceso Node.
    health: '/api/health',
    // /api/status: hace SELECT 1 + queries de agregación — mide el techo
    // real incluyendo el pool de conexiones MySQL bajo concurrencia.
    status: '/api/status',
};

export const MAX_CONCURRENCY = 50;
export const MAX_DURATION_MS = 15_000;
export const MAX_TOTAL_REQUESTS = 5_000;

// Umbrales fijos de alerta (no configurables desde la UI todavía).
const WARN_P95_MS = 1_000;
const CRITICAL_P95_MS = 3_000;
const WARN_ERROR_RATE = 0.05;
const CRITICAL_ERROR_RATE = 0.20;

export interface LoadTestResult {
    target: LoadTestTarget;
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

function percentile(sortedLatencies: number[], p: number): number {
    if (sortedLatencies.length === 0) return 0;
    const idx = Math.min(sortedLatencies.length - 1, Math.ceil((p / 100) * sortedLatencies.length) - 1);
    return sortedLatencies[Math.max(0, idx)];
}

export async function runLoadTest(opts: {
    origin: string;
    target: LoadTestTarget;
    concurrency: number;
    durationMs: number;
}): Promise<LoadTestResult> {
    const target = TARGET_PATHS[opts.target] ? opts.target : 'health';
    const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(opts.concurrency)));
    const durationMs = Math.max(1000, Math.min(MAX_DURATION_MS, Math.floor(opts.durationMs)));
    const url = `${opts.origin}${TARGET_PATHS[target]}`;

    const latencies: number[] = [];
    let successCount = 0;
    let errorCount = 0;
    let totalRequests = 0;
    const start = Date.now();
    const deadline = start + durationMs;

    async function worker() {
        while (Date.now() < deadline && totalRequests < MAX_TOTAL_REQUESTS) {
            totalRequests++;
            const reqStart = Date.now();
            try {
                const res = await fetch(url, { cache: 'no-store' });
                latencies.push(Date.now() - reqStart);
                if (res.ok) successCount++; else errorCount++;
            } catch {
                latencies.push(Date.now() - reqStart);
                errorCount++;
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const actualDurationMs = Date.now() - start;
    const sorted = [...latencies].sort((a, b) => a - b);

    return {
        target,
        concurrency,
        durationMs: actualDurationMs,
        totalRequests,
        successCount,
        errorCount,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
        maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
        throughputRps: actualDurationMs > 0 ? Math.round((totalRequests / actualDurationMs) * 1000 * 100) / 100 : 0,
    };
}

export async function persistLoadTestRun(result: LoadTestResult, triggeredBy: string): Promise<number> {
    const [insertRes]: any = await pool.query(
        `INSERT INTO LoadTestRuns
            (target_endpoint, concurrency, duration_ms, total_requests, success_count, error_count, p50_ms, p95_ms, p99_ms, max_ms, throughput_rps, triggered_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.target, result.concurrency, result.durationMs, result.totalRequests, result.successCount, result.errorCount,
         result.p50Ms, result.p95Ms, result.p99Ms, result.maxMs, result.throughputRps, triggeredBy]
    );
    return insertRes.insertId as number;
}

/**
 * Evalúa el resultado contra los umbrales fijos y, si corresponde, inserta
 * una fila en SystemAlerts (y dispara email interno si es 'critical').
 * Devuelve la alerta creada, o null si el resultado está dentro de umbral.
 */
export async function evaluateAndAlert(result: LoadTestResult, loadTestRunId: number): Promise<{ id: number; severity: string; message: string } | null> {
    const errorRate = result.totalRequests > 0 ? result.errorCount / result.totalRequests : 0;

    let severity: 'warning' | 'critical' | null = null;
    const reasons: string[] = [];

    if (result.p95Ms >= CRITICAL_P95_MS || errorRate >= CRITICAL_ERROR_RATE) {
        severity = 'critical';
    } else if (result.p95Ms >= WARN_P95_MS || errorRate >= WARN_ERROR_RATE) {
        severity = 'warning';
    }
    if (result.p95Ms >= WARN_P95_MS) reasons.push(`p95 ${result.p95Ms}ms`);
    if (errorRate >= WARN_ERROR_RATE) reasons.push(`tasa de error ${(errorRate * 100).toFixed(1)}%`);

    if (!severity) return null;

    const message = `Prueba de carga contra "${result.target}" (concurrencia ${result.concurrency}) detectó ${reasons.join(' y ')}.`;
    const detail = {
        target: result.target,
        concurrency: result.concurrency,
        totalRequests: result.totalRequests,
        errorCount: result.errorCount,
        p95Ms: result.p95Ms,
        p99Ms: result.p99Ms,
        throughputRps: result.throughputRps,
    };

    const [insertRes]: any = await pool.query(
        `INSERT INTO SystemAlerts (severity, source, message, detail, load_test_run_id) VALUES (?, 'load_test', ?, ?, ?)`,
        [severity, message, JSON.stringify(detail), loadTestRunId]
    );
    const alertId = insertRes.insertId as number;

    if (severity === 'critical') {
        const html = getCriticalSystemAlertEmailHtml({ message, source: 'load_test', detail });
        sendEmailAsync(`🚨 Alerta crítica: ${message}`, html, 'soporte@cscloudsolutions.com.ar');
    }

    return { id: alertId, severity, message };
}

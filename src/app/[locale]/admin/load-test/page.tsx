"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { Loader2, Zap, AlertTriangle, TrendingUp } from "lucide-react";

interface LoadTestResult {
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

interface LoadTestRun {
    id: number;
    target_endpoint: string;
    concurrency: number;
    duration_ms: number;
    total_requests: number;
    success_count: number;
    error_count: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    max_ms: number;
    throughput_rps: number;
    triggered_by: string;
    created_at: string;
}

export default function LoadTestPage() {
    const { instance, accounts } = useMsal();
    const account = accounts[0];

    const [target, setTarget] = useState<"health" | "status" | "probe">("health");
    const [concurrency, setConcurrency] = useState(10);
    const [durationSeconds, setDurationSeconds] = useState(5);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<LoadTestResult | null>(null);
    const [lastAlert, setLastAlert] = useState<{ severity: string; message: string } | null>(null);
    const [runs, setRuns] = useState<LoadTestRun[]>([]);
    const [loadingRuns, setLoadingRuns] = useState(true);

    const loadRuns = useCallback(async () => {
        setLoadingRuns(true);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/load-test/runs");
            const json = await res.json();
            if (json.success) setRuns(json.runs || []);
        } catch (e) {
            console.error("[LoadTest] Failed to load history:", e);
        } finally {
            setLoadingRuns(false);
        }
    }, [instance, account]);

    useEffect(() => { if (account) loadRuns(); }, [account, loadRuns]);

    const runTest = async () => {
        setRunning(true);
        setError(null);
        setLastResult(null);
        setLastAlert(null);
        try {
            const res = await fetchWithAuthRetry(instance, account, "/api/admin/load-test/run", {
                method: "POST",
                body: JSON.stringify({ target, concurrency, durationSeconds }),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error || "Error al ejecutar la prueba de carga.");
            } else {
                setLastResult(json.result);
                setLastAlert(json.alert);
                loadRuns();
            }
        } catch (e: any) {
            setError(e?.message || "Error de red.");
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="content animate-in fade-in max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Zap className="w-6 h-6 text-brand-deep dark:text-brand-bright" /> Prueba de Carga
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Genera concurrencia real contra el propio servidor para evaluar su comportamiento bajo carga.
                    Solo visible para Super Administradores.
                </p>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 dark:text-amber-300">
                    Esto ejecuta tráfico real contra el servidor en producción (no un simulador aislado). Usá valores
                    conservadores primero. Los límites duros son concurrencia máxima 50 y duración máxima 15s.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Endpoint objetivo</label>
                        <select
                            value={target}
                            onChange={(e) => setTarget(e.target.value as "health" | "status" | "probe")}
                            className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="health">/api/health (sin DB — techo del proceso)</option>
                            <option value="status">/api/status (con DB — techo real)</option>
                            <option value="probe">/api/loadtest/probe (autenticado SP — DB + Redis)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Concurrencia (1-50)</label>
                        <input
                            type="number" min={1} max={50} value={concurrency}
                            onChange={(e) => setConcurrency(Number(e.target.value))}
                            className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Duración (segundos, máx 15)</label>
                        <input
                            type="number" min={1} max={15} value={durationSeconds}
                            onChange={(e) => setDurationSeconds(Number(e.target.value))}
                            className="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"
                        />
                    </div>
                </div>
                <button
                    onClick={runTest}
                    disabled={running || !account}
                    className="px-4 py-2 bg-brand-deep hover:bg-brand-bright text-white text-sm font-bold rounded-lg disabled:opacity-50 flex items-center gap-2"
                >
                    {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {running ? "Ejecutando..." : "Ejecutar Prueba de Carga"}
                </button>

                {error && (
                    <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 text-sm px-3 py-2 rounded-lg">
                        {error}
                    </div>
                )}

                {lastAlert && (
                    <div className={`text-sm px-3 py-2 rounded-lg border ${lastAlert.severity === 'critical'
                        ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300'}`}>
                        <strong>Alerta {lastAlert.severity === 'critical' ? 'crítica' : 'de warning'} generada:</strong> {lastAlert.message}
                    </div>
                )}

                {lastResult && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                        <Metric label="Requests" value={lastResult.totalRequests} />
                        <Metric label="Errores" value={lastResult.errorCount} />
                        <Metric label="Throughput" value={`${lastResult.throughputRps} req/s`} />
                        <Metric label="p50" value={`${lastResult.p50Ms} ms`} />
                        <Metric label="p95" value={`${lastResult.p95Ms} ms`} />
                        <Metric label="p99" value={`${lastResult.p99Ms} ms`} />
                        <Metric label="Máx" value={`${lastResult.maxMs} ms`} />
                        <Metric label="Éxito" value={`${lastResult.successCount}/${lastResult.totalRequests}`} />
                    </div>
                )}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
                    <TrendingUp className="w-5 h-5" /> Historial
                </h2>
                {loadingRuns ? (
                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                ) : runs.length === 0 ? (
                    <p className="text-sm text-slate-500">Todavía no se ejecutó ninguna prueba.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                    <th className="py-2 pr-3">Fecha</th>
                                    <th className="py-2 pr-3">Target</th>
                                    <th className="py-2 pr-3">Conc.</th>
                                    <th className="py-2 pr-3">Requests</th>
                                    <th className="py-2 pr-3">Errores</th>
                                    <th className="py-2 pr-3">p95</th>
                                    <th className="py-2 pr-3">Throughput</th>
                                    <th className="py-2 pr-3">Por</th>
                                </tr>
                            </thead>
                            <tbody>
                                {runs.map((r) => (
                                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800/50">
                                        <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{new Date(r.created_at).toLocaleString('es-AR')}</td>
                                        <td className="py-2 pr-3 font-mono text-xs">{r.target_endpoint}</td>
                                        <td className="py-2 pr-3">{r.concurrency}</td>
                                        <td className="py-2 pr-3">{r.total_requests}</td>
                                        <td className="py-2 pr-3">{r.error_count}</td>
                                        <td className="py-2 pr-3">{r.p95_ms} ms</td>
                                        <td className="py-2 pr-3">{r.throughput_rps} req/s</td>
                                        <td className="py-2 pr-3 text-slate-500 text-xs">{r.triggered_by}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
            <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</div>
        </div>
    );
}

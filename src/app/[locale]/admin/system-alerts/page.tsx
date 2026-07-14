"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { fetchWithAuthRetry } from "@/lib/msalToken";
import { Loader2, ShieldAlert, CheckCircle2 } from "lucide-react";

interface SystemAlert {
    id: number;
    severity: "warning" | "critical";
    source: string;
    message: string;
    detail: Record<string, unknown> | null;
    load_test_run_id: number | null;
    acknowledged_at: string | null;
    acknowledged_by: string | null;
    created_at: string;
}

export default function SystemAlertsPage() {
    const { instance, accounts } = useMsal();
    const account = accounts[0];

    const [alerts, setAlerts] = useState<SystemAlert[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [onlyUnacknowledged, setOnlyUnacknowledged] = useState(true);
    const [ackingId, setAckingId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuthRetry(
                instance, account,
                `/api/admin/system-alerts${onlyUnacknowledged ? '?unacknowledged=true' : ''}`
            );
            const json = await res.json();
            if (!json.success) setError(json.error || "Error al cargar alertas.");
            else setAlerts(json.alerts || []);
        } catch (e: any) {
            setError(e?.message || "Error de red.");
        } finally {
            setLoading(false);
        }
    }, [instance, account, onlyUnacknowledged]);

    useEffect(() => { if (account) load(); }, [account, load]);

    const acknowledge = async (id: number) => {
        setAckingId(id);
        try {
            await fetchWithAuthRetry(instance, account, `/api/admin/system-alerts/${id}/ack`, { method: "POST" });
            load();
        } catch (e) {
            console.error("[SystemAlerts] Failed to acknowledge:", e);
        } finally {
            setAckingId(null);
        }
    };

    return (
        <div className="content animate-in fade-in max-w-4xl space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <ShieldAlert className="w-6 h-6 text-brand-deep dark:text-brand-bright" /> Alertas del Sistema
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        Alertas de latencia/errores por alta concurrencia, generadas automáticamente por Pruebas de Carga.
                        Solo visible para Super Administradores.
                    </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <input
                        type="checkbox"
                        checked={onlyUnacknowledged}
                        onChange={(e) => setOnlyUnacknowledged(e.target.checked)}
                    />
                    Solo pendientes
                </label>
            </div>

            {error && (
                <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 text-sm px-3 py-2 rounded-lg">
                    {error}
                </div>
            )}

            {loading ? (
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            ) : alerts.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
                    {onlyUnacknowledged ? "No hay alertas pendientes." : "No hay alertas registradas."}
                </div>
            ) : (
                <div className="space-y-3">
                    {alerts.map((a) => (
                        <div
                            key={a.id}
                            className={`bg-white dark:bg-slate-900 border rounded-xl p-4 flex items-start justify-between gap-4 ${
                                a.severity === 'critical'
                                    ? 'border-rose-200 dark:border-rose-900/50'
                                    : 'border-amber-200 dark:border-amber-900/50'
                            }`}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
                                        a.severity === 'critical'
                                            ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'
                                            : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                                    }`}>
                                        {a.severity === 'critical' ? 'Crítica' : 'Warning'}
                                    </span>
                                    <span className="text-xs text-slate-500">{a.source}</span>
                                    <span className="text-xs text-slate-400">{new Date(a.created_at).toLocaleString('es-AR')}</span>
                                </div>
                                <p className="text-sm text-slate-800 dark:text-slate-200">{a.message}</p>
                                {a.acknowledged_at && (
                                    <p className="text-xs text-slate-500 mt-1">
                                        Reconocida por {a.acknowledged_by} el {new Date(a.acknowledged_at).toLocaleString('es-AR')}
                                    </p>
                                )}
                            </div>
                            {!a.acknowledged_at && (
                                <button
                                    onClick={() => acknowledge(a.id)}
                                    disabled={ackingId === a.id}
                                    className="shrink-0 px-3 py-1.5 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    {ackingId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                    Reconocer
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

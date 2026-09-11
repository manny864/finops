"use client";

import React, { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { History, X, Loader2, AlertCircle, LineChart as LineChartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { useTenant } from "@/components/TenantProvider";
import { useChartTheme } from "@/lib/chartTheme";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    Legend,
} from "recharts";

interface SnapshotPoint {
    date: string;
    payload: Record<string, unknown> | null;
}

const LINE_COLORS = ["#0d9488", "#6366f1", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6", "#ec4899"];

function isoDaysAgo(days: number): string {
    return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * Botón + panel reutilizable para consultar el historial diario de cualquier página.
 * Uso: <HistoryButton domain="dashboard_summary" title="Dashboard" />
 *
 * Es self-contained: obtiene el tenant activo y el token (MSAL) por su cuenta, llama
 * a /api/history y grafica automáticamente las métricas numéricas del payload.
 */
export default function HistoryButton({
    domain,
    title,
    metrics,
    className,
}: {
    domain: string;
    title?: string;
    /** Claves numéricas a graficar; si se omite, se detectan automáticamente. */
    metrics?: string[];
    className?: string;
}) {
    const t = useTranslations("History");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const chart = useChartTheme();

    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState(isoDaysAgo(365));
    const [to, setTo] = useState(isoDaysAgo(0));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [series, setSeries] = useState<SnapshotPoint[]>([]);

    const authFetch = useCallback(async (url: string) => {
        const account = accounts[0];
        const headers: Record<string, string> = {};
        if (account) {
            try {
                const token = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
                // El backend (requestAuth.ts) valida un ID token (aud = nuestro
                // AZURE_CLIENT_ID, claims.tid, issuer v2.0). token.accessToken es
                // el access token para Microsoft Graph (aud distinto) y siempre
                // fallaba la validacion de audience -> 401 Unauthorized.
                headers["Authorization"] = `Bearer ${token.idToken}`;
            } catch { /* sin token: el server valida por sesión/guard */ }
        }
        const res = await fetch(url, { headers });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || t("error"));
        return json;
    }, [accounts, instance]);

    const load = useCallback(async () => {
        if (!selectedTenant || selectedTenant.id === "default") return;
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ tenantId: selectedTenant.id, domain, from, to });
            if (selectedTenant.tier) params.set("tier", selectedTenant.tier);
            const json = await authFetch(`/api/history?${params.toString()}`);
            setSeries(Array.isArray(json.series) ? json.series : []);
        } catch (e) {
            setError((e as Error)?.message || "Error");
            setSeries([]);
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, domain, from, to, authFetch]);

    const openPanel = useCallback(() => {
        setOpen(true);
        void load();
    }, [load]);

    // Detecta las métricas numéricas presentes en la serie.
    const metricKeys = useMemo(() => {
        if (metrics && metrics.length) return metrics;
        const keys = new Set<string>();
        for (const p of series) {
            if (p.payload && typeof p.payload === "object") {
                for (const [k, v] of Object.entries(p.payload)) {
                    if (typeof v === "number" && Number.isFinite(v)) keys.add(k);
                }
            }
        }
        return Array.from(keys).slice(0, 7);
    }, [series, metrics]);

    const chartData = useMemo(() => {
        return series.map((p) => {
            const row: Record<string, string | number> = { date: p.date };
            for (const k of metricKeys) {
                const v = p.payload?.[k];
                if (typeof v === "number" && Number.isFinite(v)) row[k] = v;
            }
            return row;
        });
    }, [series, metricKeys]);

    const panel = open ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
            <div
                className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                        <History className="w-5 h-5 text-teal-600" />
                        <h3 className="font-bold text-gray-900 dark:text-white">
                            {t("title")}{title ? ` — ${title}` : ""}
                        </h3>
                    </div>
                    <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white" aria-label={t("close")}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-800 flex flex-wrap items-end gap-3">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300 flex flex-col gap-1">
                        {t("from")}
                        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
                            className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded px-2 py-1 text-sm" />
                    </label>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300 flex flex-col gap-1">
                        {t("to")}
                        <input type="date" value={to} min={from} max={isoDaysAgo(0)} onChange={(e) => setTo(e.target.value)}
                            className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded px-2 py-1 text-sm" />
                    </label>
                    <button onClick={() => void load()} disabled={loading}
                        className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-3 py-1.5 rounded disabled:opacity-50 flex items-center gap-1.5">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LineChartIcon className="w-4 h-4" />}
                        {t("query")}
                    </button>
                    <div className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                        {t("retentionNote")}
                    </div>
                </div>

                <div className="p-5 overflow-auto flex-1 min-h-0">
                    {loading ? (
                        <div className="flex items-center justify-center h-64 text-gray-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : error ? (
                        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"><AlertCircle className="w-4 h-4" /> {error}</div>
                    ) : series.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2">
                            <History className="w-10 h-10 opacity-30" />
                            <p className="text-sm">{t("empty")}</p>
                        </div>
                    ) : (
                        <>
                            <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                                        <YAxis tick={{ fontSize: 11 }} width={56} />
                                        <Tooltip {...TOOLTIP_TEMA} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        {metricKeys.map((k, i) => (
                                            <Line key={k} type="monotone" dataKey={k} stroke={LINE_COLORS[i % LINE_COLORS.length]}
                                                dot={false} strokeWidth={2} isAnimationActive={chart.animate} />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="mt-4 overflow-auto max-h-64 border border-gray-100 dark:border-slate-800 rounded-lg">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 dark:bg-slate-800 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">{t("date")}</th>
                                            {metricKeys.map((k) => (
                                                <th key={k} className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{k}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...chartData].reverse().map((row) => (
                                            <tr key={String(row.date)} className="border-t border-gray-100 dark:border-slate-800">
                                                <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{String(row.date)}</td>
                                                {metricKeys.map((k) => (
                                                    <td key={k} className="px-3 py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-200">
                                                        {typeof row[k] === "number" ? (row[k] as number).toLocaleString() : "—"}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    ) : null;

    return (
        <>
            <button
                type="button"
                onClick={openPanel}
                className={className || "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"}
                title={t("title")}
            >
                <History className="w-4 h-4" />
                {t("button")}
            </button>
            {panel}
        </>
    );
}

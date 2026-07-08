"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { Loader2, BrainCircuit, AlertTriangle, TrendingUp, Cpu, DollarSign, Zap } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from '@/lib/mockData';

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 shrink-0">{icon}</div>
            <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
                <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
                {sub && <p className="text-xs text-slate-400">{sub}</p>}
            </div>
        </div>
    );
}

// ── Mini progress bar ─────────────────────────────────────────────────────────
function BarRow({ label, value, max, color = "bg-blue-500" }: { label: string; value: number; max: number; color?: string }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return (
        <div className="flex items-center gap-3 text-sm">
            <span className="w-44 truncate text-slate-700 dark:text-slate-300 text-xs" title={label}>{label}</span>
            <div className="flex-1 h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-20 text-right font-mono text-xs text-slate-600 dark:text-slate-400">${value.toLocaleString()}</span>
        </div>
    );
}

// ── Simple SVG trend line ─────────────────────────────────────────────────────
function TrendLine({ points }: { points: { date: string; cost: number }[] }) {
    if (!points || points.length < 2) return null;
    const w = 400, h = 80;
    const maxCost = Math.max(...points.map(p => p.cost));
    const minCost = Math.min(...points.map(p => p.cost));
    const range = maxCost - minCost || 1;
    const xs = points.map((_, i) => (i / (points.length - 1)) * w);
    const ys = points.map(p => h - ((p.cost - minCost) / range) * (h - 10) - 5);
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ");
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
            <path d={d} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
            {xs.map((x, i) => (
                <circle key={i} cx={x} cy={ys[i]} r="3" fill="#3b82f6" />
            ))}
        </svg>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AIAnalyticsDashboard() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations("AIAnalytics");
    const tMock = useTranslations("Mock");
    const [days, setDays] = useState(30);
    const [appSort, setAppSort] = useState<"cost" | "application">("cost");

    const fetcher = async (url: string) => {
        const token = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const j = await res.json();
            throw new Error(j.error || "Error al cargar AI Analytics");
        }
        return res.json();
    };

    const apiUrl =
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/ai-analytics?tenantId=${selectedTenant.id}&days=${days}`
            : null;

    const { data, error, isLoading } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Cargando AI Analytics...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const { summary, byModel, byApplication, byTeam, trend, mock } = data;

    if (!summary && !mock) {
        return <p className="text-slate-500 dark:text-slate-400 text-sm py-10 text-center">{t("noData")}</p>;
    }

    const maxModelCost = Math.max(...(byModel ?? []).map((m: any) => m.cost), 1);
    const maxAppCost = Math.max(...(byApplication ?? []).map((a: any) => a.cost), 1);
    const maxTeamCost = Math.max(...(byTeam ?? []).map((t: any) => t.cost), 1);

    const sortedApps = [...(byApplication ?? [])].sort((a: any, b: any) =>
        appSort === "cost" ? b.cost - a.cost : a.application.localeCompare(b.application)
    );

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span><strong>{tMock("badge")}</strong> — {tMock("description")}</span>
                </div>
            )}

            {/* Days filter */}
            <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 dark:text-slate-400">Período:</span>
                {[7, 30, 60, 90].map(d => (
                    <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={`px-3 py-1 rounded-lg border text-xs font-medium transition-colors ${days === d ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800"}`}
                    >
                        {d}d
                    </button>
                ))}
            </div>

            {/* KPI cards */}
            {summary && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <KpiCard label="Total Cost" value={`$${summary.totalCost.toLocaleString()}`} icon={<DollarSign className="w-5 h-5" />} />
                    <KpiCard
                        label="Total Tokens"
                        value={`${((summary.totalInputTokens + summary.totalOutputTokens) / 1_000_000).toFixed(1)}M`}
                        sub={`${t("inputTokens")}: ${(summary.totalInputTokens / 1_000_000).toFixed(1)}M`}
                        icon={<Zap className="w-5 h-5" />}
                    />
                    <KpiCard
                        label={t("costPer1k")}
                        value={`$${summary.costPer1kTokens.toFixed(3)}`}
                        icon={<TrendingUp className="w-5 h-5" />}
                    />
                    <KpiCard
                        label="Modelos Activos"
                        value={String(summary.activeModels)}
                        sub={`${summary.activeApplications} aplicaciones`}
                        icon={<Cpu className="w-5 h-5" />}
                    />
                </div>
            )}

            {/* byModel + byApplication */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* byModel */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <BrainCircuit className="w-4 h-4 text-blue-500" />
                        {t("byModel")}
                    </h3>
                    <div className="space-y-3">
                        {(byModel ?? []).map((m: any) => (
                            <div key={m.model}>
                                <BarRow label={m.model} value={m.cost} max={maxModelCost} />
                                <p className="text-xs text-slate-400 ml-48 -mt-0.5">
                                    {t("costPer1k")}: ${m.costPer1k?.toFixed(3)} · {t("inputTokens")}: {(m.inputTokens / 1e6).toFixed(1)}M
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* byApplication */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-purple-500" />
                            {t("byApplication")}
                        </h3>
                        <select
                            value={appSort}
                            onChange={e => setAppSort(e.target.value as "cost" | "application")}
                            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        >
                            <option value="cost">Por costo</option>
                            <option value="application">Por nombre</option>
                        </select>
                    </div>
                    <div className="overflow-auto max-h-64">
                        <table className="w-full text-xs">
                            <thead className="text-slate-500 dark:text-slate-400">
                                <tr>
                                    <th className="text-left pb-2">{t("application")}</th>
                                    <th className="text-left pb-2">{t("model")}</th>
                                    <th className="text-right pb-2">Cost</th>
                                    <th className="text-right pb-2 w-24">%</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                {sortedApps.map((a: any) => {
                                    const pct = maxAppCost > 0 ? ((a.cost / maxAppCost) * 100).toFixed(0) : "0";
                                    return (
                                        <tr key={a.application}>
                                            <td className="py-1.5 font-medium text-slate-700 dark:text-slate-300 max-w-[140px] truncate">{a.application}</td>
                                            <td className="py-1.5 text-slate-400">{a.model}</td>
                                            <td className="py-1.5 text-right font-mono">${a.cost.toLocaleString()}</td>
                                            <td className="py-1.5 pl-2">
                                                <div className="flex items-center gap-1">
                                                    <div className="flex-1 h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                        <div className="h-1.5 bg-purple-400 rounded-full" style={{ width: `${pct}%` }} />
                                                    </div>
                                                    <span className="text-slate-400 w-6 text-right">{pct}%</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Trend + byTeam */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Trend */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                        {t("tokensTrend")}
                    </h3>
                    <TrendLine points={trend ?? []} />
                    <div className="mt-3 flex flex-wrap gap-3">
                        {(trend ?? []).map((p: any) => (
                            <div key={p.date} className="text-center">
                                <p className="text-xs text-slate-400">{p.date.substring(5)}</p>
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">${p.cost}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* byTeam */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-orange-500" />
                        {t("byTeam")}
                    </h3>
                    <div className="space-y-3">
                        {(byTeam ?? []).map((tm: any) => (
                            <BarRow key={tm.team} label={tm.team} value={tm.cost} max={maxTeamCost} color="bg-orange-400" />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

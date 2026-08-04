"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { Loader2, BrainCircuit, AlertTriangle, TrendingUp, Cpu, DollarSign, Zap, Info, Clock, Activity } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from '@/lib/mockData';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, Legend, AreaChart, Area } from "recharts";

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({
    label,
    value,
    sub,
    icon,
    tooltip,
}: {
    label: string;
    value: string;
    sub?: string;
    icon: React.ReactNode;
    tooltip?: string;
}) {
    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3 relative group">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 shrink-0">{icon}</div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</p>
                    {tooltip && (
                        <div className="relative group/tip inline-flex items-center">
                            <Info className="w-3.5 h-3.5 text-slate-400 hover:text-blue-500 cursor-pointer transition-colors" />
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tip:block w-64 p-2.5 bg-slate-900 text-white text-[11px] rounded-lg shadow-xl z-30 leading-tight">
                                {tooltip}
                                <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-900" />
                            </div>
                        </div>
                    )}
                </div>
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
            <span className="w-44 truncate text-slate-700 dark:text-slate-300 text-xs font-semibold" title={label}>{label}</span>
            <div className="flex-1 h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-20 text-right font-mono text-xs text-slate-600 dark:text-slate-400">${value.toLocaleString()}</span>
        </div>
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
            throw new Error(j.error || t("fetch_error"));
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
                <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="AI Analytics" />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {t("error_title")}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const { summary, byModel, byApplication, byTeam, trend, mock, tokensAvailable } = data;
    const showTokens = tokensAvailable !== false;

    if (!summary && !mock) {
        return <p className="text-slate-500 dark:text-slate-400 text-sm py-10 text-center">{t("noData")}</p>;
    }

    const maxModelCost = Math.max(...(byModel ?? []).map((m: any) => m.cost), 1);
    const maxAppCost = Math.max(...(byApplication ?? []).map((a: any) => a.cost), 1);
    const maxTeamCost = Math.max(...(byTeam ?? []).map((t: any) => t.cost), 1);

    const sortedApps = [...(byApplication ?? [])].sort((a: any, b: any) =>
        appSort === "cost" ? b.cost - a.cost : a.application.localeCompare(b.application)
    );

    const chartTrendData = (trend ?? []).map((tItem: any) => {
        const inp = Number(tItem.inputTokens) || 0;
        const out = Number(tItem.outputTokens) || 0;
        return {
            date: String(tItem.date).substring(5), // MM-DD
            fullDate: tItem.date,
            cost: Number(tItem.cost || 0),
            inputTokens: inp,
            outputTokens: out,
            totalTokens: inp + out,
        };
    });

    return (
        <div className="w-full space-y-6">
            {/* Disclaimer Banner de latencia de facturación Azure Cost Management */}
            <div className="bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 text-sky-800 dark:text-sky-300 rounded-xl px-4 py-3 flex items-center gap-3 text-xs shadow-xs">
                <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>
                    <strong>{t("billing_latency_title")}</strong> {t("billing_latency_disclaimer")}
                </span>
            </div>

            {/* Mock banner */}
            {mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span><strong>{tMock("badge")}</strong> — {tMock("description")}</span>
                </div>
            )}
            {!mock && !showTokens && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-300 rounded-xl px-4 py-3 flex items-center gap-3 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{t("azure_openai_note")}</span>
                </div>
            )}

            {/* Days filter */}
            <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 dark:text-slate-400">{t("period")}</span>
                {[7, 30, 60, 90].map(d => (
                    <button
                        key={d}
                        onClick={() => setDays(d)}
                        className={`px-3 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${days === d ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800"}`}
                    >
                        {d}d
                    </button>
                ))}
            </div>

            {/* KPI cards */}
            {summary && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <KpiCard
                        label={t("total_cost")}
                        value={`$${summary.totalCost.toLocaleString()}`}
                        icon={<DollarSign className="w-5 h-5" />}
                        tooltip={t("cost_forecast_tooltip")}
                    />
                    {showTokens ? (
                        <>
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
                                label={t("active_models")}
                                value={String(summary.activeModels)}
                                sub={t("applications_suffix", { count: summary.activeApplications })}
                                icon={<Cpu className="w-5 h-5" />}
                            />
                        </>
                    ) : (
                        <>
                            <KpiCard
                                label={t("avg_daily_cost")}
                                value={`$${(summary.totalCost / days).toFixed(2)}`}
                                sub={t("last_days", { days })}
                                icon={<TrendingUp className="w-5 h-5" />}
                            />
                            <KpiCard
                                label={t("meter_types")}
                                value={String(summary.activeModels)}
                                sub={t("model_service_proxy")}
                                icon={<Zap className="w-5 h-5" />}
                            />
                            <KpiCard
                                label={t("resource_groups")}
                                value={String(summary.activeApplications)}
                                sub={t("ai_cost_suffix")}
                                icon={<Cpu className="w-5 h-5" />}
                            />
                        </>
                    )}
                </div>
            )}

            {/* Gráfico de Coste Estimado Diario (Estilo Azure AI Studio / Azure Portal) */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-emerald-600" />
                        Coste estimado por día ($ USD)
                    </h3>
                    <span className="text-[11px] text-slate-400">Desglose histórico en el período</span>
                </div>
                <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartTrendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                            <RechartsTooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Coste Estimado"]} />
                            <Area type="monotone" dataKey="cost" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#costGradient)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Gráficos de Tokens por Modelo / Métricas de Despliegue (Entrada, Salida y Total) */}
            {showTokens && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-blue-500" />
                            Tokens de entrada frente a salida frente a total
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">Realiza un seguimiento de las tendencias de uso de tokens en la entrada, la salida y el total.</p>
                        <div className="h-56 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartTrendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                    <RechartsTooltip formatter={(v: any) => [Number(v).toLocaleString(), "Tokens"]} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                                    <Line type="monotone" name="Tokens de entrada" dataKey="inputTokens" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                                    <Line type="monotone" name="Tokens de salida" dataKey="outputTokens" stroke="#ec4899" strokeWidth={2} dot={{ r: 2 }} />
                                    <Line type="monotone" name="Total de tokens" dataKey="totalTokens" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-purple-500" />
                            Distribución de Tokens por Modelo
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">Muestra la carga de trabajo y volumen procesado por cada modelo desplegado.</p>
                        <div className="space-y-4">
                            {(byModel ?? []).map((m: any) => {
                                const total = m.inputTokens + m.outputTokens;
                                return (
                                    <div key={m.model} className="p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="font-bold text-xs text-slate-800 dark:text-slate-200">{m.model}</span>
                                            <span className="font-mono text-xs text-blue-600 dark:text-blue-400 font-bold">${m.cost.toLocaleString()}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                            <div>
                                                <span className="block text-[10px] text-slate-400">Input:</span>
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">{(m.inputTokens / 1000).toFixed(1)}K</span>
                                            </div>
                                            <div>
                                                <span className="block text-[10px] text-slate-400">Output:</span>
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">{(m.outputTokens / 1000).toFixed(1)}K</span>
                                            </div>
                                            <div>
                                                <span className="block text-[10px] text-slate-400">Costo/1K:</span>
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">${m.costPer1k?.toFixed(4)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* byModel + byApplication */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* byModel */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <BrainCircuit className="w-4 h-4 text-blue-500" />
                        {showTokens ? t("byModel") : t("by_meter_type")}
                    </h3>
                    <div className="space-y-3">
                        {(byModel ?? []).map((m: any) => (
                            <div key={m.model}>
                                <BarRow label={m.model} value={m.cost} max={maxModelCost} />
                                {showTokens && (
                                    <p className="text-xs text-slate-400 ml-48 -mt-0.5">
                                        {t("costPer1k")}: ${m.costPer1k?.toFixed(3)} · {t("inputTokens")}: {(m.inputTokens / 1e6).toFixed(1)}M
                                    </p>
                                )}
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
                            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer"
                        >
                            <option value="cost">{t("sort_by_cost")}</option>
                            <option value="application">{t("sort_by_name")}</option>
                        </select>
                    </div>
                    <div className="overflow-auto max-h-64">
                        <table className="w-full text-xs">
                            <thead className="text-slate-500 dark:text-slate-400">
                                <tr>
                                    <th className="text-left pb-2">{t("application")}</th>
                                    <th className="text-left pb-2">{t("model")}</th>
                                    <th className="text-right pb-2">{t("col_cost")}</th>
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
                    <div className="h-44 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartTrendData}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                                <RechartsTooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Costo"]} />
                                <Line type="monotone" dataKey="cost" stroke="#0054a6" strokeWidth={2} dot={{ r: 2 }} />
                            </LineChart>
                        </ResponsiveContainer>
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

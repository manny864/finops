"use client";
import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { Loader2, BrainCircuit, AlertTriangle, TrendingUp, Cpu, DollarSign, Zap, Info, Clock, Activity, RefreshCw } from "lucide-react";
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
    const [days, setDays] = useState<number | "mtd">(30);
    const [appSort, setAppSort] = useState<"cost" | "application">("cost");
    const [isRefreshing, setIsRefreshing] = useState(false);

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

    const { data, error, isLoading, mutate } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });

    const handleRefresh = async () => {
        if (!selectedTenant?.id) return;
        setIsRefreshing(true);
        try {
            const token = await getFreshIdToken(instance, accounts[0]);
            await fetch(`/api/intelligence/ai-analytics?tenantId=${selectedTenant.id}&days=${days}&bust=1`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            await mutate();
        } catch (err) {
            console.error("Error refreshing AI analytics:", err);
        } finally {
            setIsRefreshing(false);
        }
    };
    const compact = (value: number) =>
        Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 2 }).format(value || 0);
    const chartTrendData = useMemo(() => {
        const now = new Date();
        const currentMonthDay = now.getDate();
        const isMtd = days === "mtd";
        const daysNum = isMtd ? currentMonthDay : Number(days);
        const source = (
            isMtd && Array.isArray(data?.trendMtd) && data.trendMtd.length > 0
                ? data.trendMtd
                : (data?.trend ?? [])
        ) as any[];
        const start = isMtd
            ? new Date(now.getFullYear(), now.getMonth(), 1)
            : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (daysNum - 1));
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const formatDate = (date: Date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, "0");
            const d = String(date.getDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
        };
        const normalizeDateKey = (value: unknown): string => {
            if (value instanceof Date) return formatDate(value);
            const raw = String(value || "");
            if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
            const parsed = new Date(raw);
            if (!Number.isNaN(parsed.getTime())) return formatDate(parsed);
            return raw.substring(0, 10);
        };
        const sourceMap = new Map<string, any>(
            source.map((entry) => [normalizeDateKey(entry.date), entry])
        );
        const out: Array<{
            date: string;
            fullDate: string;
            cost: number;
            cumulativeCost: number;
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            cumulativeInputTokens: number;
            cumulativeOutputTokens: number;
            cumulativeTokens: number;
        }> = [];
        let runningCost = 0;
        let runningInput = 0;
        let runningOutput = 0;
        for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
            const dateKey = formatDate(day);
            const row = sourceMap.get(dateKey) || {};
            const dailyCost = Number(row.cost || 0);
            const dailyInput = Number(row.inputTokens || 0);
            const dailyOutput = Number(row.outputTokens || 0);
            runningCost = row.cumulativeCost != null ? Number(row.cumulativeCost || 0) : runningCost + dailyCost;
            runningInput = row.cumulativeInputTokens != null ? Number(row.cumulativeInputTokens || 0) : runningInput + dailyInput;
            runningOutput = row.cumulativeOutputTokens != null ? Number(row.cumulativeOutputTokens || 0) : runningOutput + dailyOutput;
            out.push({
                date: dateKey.substring(5),
                fullDate: dateKey,
                cost: dailyCost,
                cumulativeCost: runningCost,
                inputTokens: dailyInput,
                outputTokens: dailyOutput,
                totalTokens: dailyInput + dailyOutput,
                cumulativeInputTokens: runningInput,
                cumulativeOutputTokens: runningOutput,
                cumulativeTokens: runningInput + runningOutput,
            });
        }
        return out;
    }, [data?.trendMtd, data?.trend, days]);

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

    const { summary, byModel, byApplication, byTeam, mock, tokensAvailable } = data;
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

            {/* Period filter & Refresh */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">{t("period")}:</span>
                    {[
                        { id: 7, label: "7D (7 días)" },
                        { id: 30, label: "1 mes (30D)" },
                        { id: "mtd" as const, label: "Mes actual (MTD)" },
                        { id: 90, label: "90D" },
                    ].map((opt) => (
                        <button
                            key={String(opt.id)}
                            onClick={() => setDays(opt.id)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                                days === opt.id
                                    ? "bg-[#0054A6] border-[#0054A6] text-white shadow-xs"
                                    : "border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>

                <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-blue-600" : ""}`} />
                    <span>{isRefreshing ? "Actualizando telemetría..." : "Refrescar datos"}</span>
                </button>
            </div>

            {/* KPI cards */}
            {summary && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                    {showTokens ? (
                        <>
                            <KpiCard
                                label="Total de solicitudes"
                                value={`${(summary.totalRequests || 0).toLocaleString("es-ES")}`}
                                icon={<Activity className="w-5 h-5" />}
                            />
                            <KpiCard
                                label="Recuento total de tokens"
                                value={compact((summary.totalInputTokens || 0) + (summary.totalOutputTokens || 0))}
                                sub={`${summary.avgTokensPerRequest || 0} promedio por solicitud`}
                                icon={<Zap className="w-5 h-5" />}
                            />
                            <KpiCard
                                label={t("kpiTotalCost")}
                                value={`$${summary.totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                icon={<TrendingUp className="w-5 h-5" />}
                                tooltip={t("cost_forecast_tooltip")}
                            />
                            <KpiCard
                                label="Tokens de entrada"
                                value={compact(summary.totalInputTokens || 0)}
                                sub={`${summary.avgInputPerRequest || 0} promedio por solicitud`}
                                icon={<Cpu className="w-5 h-5" />}
                            />
                            <KpiCard
                                label="Tokens de salida"
                                value={compact(summary.totalOutputTokens || 0)}
                                sub={`${summary.avgOutputPerRequest || 0} promedio por solicitud`}
                                icon={<BrainCircuit className="w-5 h-5" />}
                            />
                        </>
                    ) : (
                        <>
                            <KpiCard
                                label={t("total_cost")}
                                value={`$${summary.totalCost.toLocaleString()}`}
                                icon={<DollarSign className="w-5 h-5" />}
                                tooltip={t("cost_forecast_tooltip")}
                            />
                            <KpiCard
                                label={t("avg_daily_cost")}
                                value={`$${(summary.totalCost / (days === "mtd" ? Math.max(1, new Date().getDate()) : Number(days))).toFixed(2)}`}
                                sub={days === "mtd" ? "Mes actual" : t("last_days", { days })}
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
                        {t("mtdCostProgressUsd")}
                    </h3>
                    <span className="text-[11px] text-slate-400">{t("mtdAccumulated")}</span>
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
                            <RechartsTooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Costo acumulado MTD"]} />
                            <Area type="monotone" dataKey="cumulativeCost" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#costGradient)" />
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
                            Progreso de tokens de entrada, salida y total (MTD)
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">{t("tokenTrendHint")}</p>
                        <div className="h-56 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartTrendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                    <RechartsTooltip formatter={(v: any) => [Number(v).toLocaleString(), "Tokens acumulados"]} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                                    <Line type="monotone" name="Tokens de entrada" dataKey="cumulativeInputTokens" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                                    <Line type="monotone" name="Tokens de salida" dataKey="cumulativeOutputTokens" stroke="#ec4899" strokeWidth={2} dot={{ r: 2 }} />
                                    <Line type="monotone" name="Total de tokens" dataKey="cumulativeTokens" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-purple-500" />
                            {t("tokensByModel")}
                        </h3>
                        <p className="text-xs text-slate-400 mb-4">{t("tokensByModelHint")}</p>
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
                                                <span className="block text-[10px] text-slate-400">{t("costPer1kLabel")}</span>
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
                        {t("mtdCostProgress")}
                    </h3>
                    <div className="h-44 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartTrendData}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                                <RechartsTooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Costo acumulado MTD"]} />
                                <Line type="monotone" dataKey="cumulativeCost" stroke="#0054a6" strokeWidth={2} dot={{ r: 2 }} />
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

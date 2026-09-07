"use client";
import React from "react";
import useSWR from "swr";
import Link from "next/link";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import {
    AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip,
    ResponsiveContainer, CartesianGrid, ReferenceLine, BarChart, Bar, Cell,
} from "recharts";
import {
    Loader2, Cpu, TrendingDown, TrendingUp, AlertCircle, Info,
    MemoryStick, Sparkles, Gauge, PiggyBank, ArrowRight, ShieldCheck,
    Layers, HardDrive,
} from "lucide-react";
import { isMockTenant } from '@/lib/mockData';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import InfoTooltip from "@/components/InfoTooltip";
import type { ComputeEfficiencySummary, RateOptimizationAction } from "@/lib/computeEfficiencyTypes";

const RATE_ACTION_ICON: Record<RateOptimizationAction['type'], React.ComponentType<{ className?: string }>> = {
    savings_plan: PiggyBank,
    arm_migration: Cpu,
    ahub: ShieldCheck,
    region_arbitrage: TrendingDown,
};

const ARCH_COLORS: Record<string, string> = {
    Intel: '#0054A6',
    AMD: '#00AEEF',
    ARM: '#10B981',
};

export default function ComputeEfficiencyDashboard() {
    const t = useTranslations("ComputeEfficiency");
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${idToken}`,
                "x-tenant-id": selectedTenant?.id ?? "",
            },
        });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || t("loadDataError"));
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR<ComputeEfficiencySummary>(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/compute-cost-per-core?tenantId=${selectedTenant.id}&days=30`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('tierLockedFeatureName')} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {t("error")}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const vssBenchmark = data.costPerCore < data.benchmark;
    const delta = Math.abs(data.costPerCore - data.benchmark).toFixed(2);
    const trendData: { month: string; costPerCore: number }[] = data.trend || [];
    const unit = data.unitEconomics;
    const mix = data.purchaseMix;
    const actions = data.rateOptimizationActions || [];
    const totalPotentialSavings = actions.reduce((s, a) => s + (a.potentialMonthlySavings || 0), 0);
    const archMix = data.architectureMix || [];
    const genMix = data.generationMix || [];
    const subDetail = data.subscriptionDetail || [];

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {data.mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <span className="font-bold mr-2 px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 rounded text-xs">{tm("badge")}</span>
                        {tm("description")}
                    </div>
                </div>
            )}

            {/* KPI row: Dual Unit Economics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Card 1: $/vCore */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 inline-flex items-center gap-1">
                        <Cpu className="w-3.5 h-3.5 text-[#0054A6]" />
                        <span>{t("costPerCore")}</span>
                        <InfoTooltip content={t("tooltip_cost_per_core")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {format(data.costPerCore)}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1">/core</span>
                    </p>
                    <div className="flex items-center gap-1 mt-1.5">
                        {vssBenchmark ? <TrendingDown className="w-3.5 h-3.5 text-emerald-500" /> : <TrendingUp className="w-3.5 h-3.5 text-red-500" />}
                        <span className={`text-xs font-semibold ${vssBenchmark ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                            {format(Number(delta))} {vssBenchmark ? t("belowBenchmark") : t("aboveBenchmark")}
                        </span>
                    </div>
                </div>

                {/* Card 2: $/GiB RAM */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 inline-flex items-center gap-1">
                        <MemoryStick className="w-3.5 h-3.5 text-[#00AEEF]" />
                        <span>{t("costPerGiB")}</span>
                        <InfoTooltip content={t("tooltip_cost_per_gib")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {unit.costPerGiB != null ? format(unit.costPerGiB) : "N/D"}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1">/GiB</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1.5">
                        {unit.totalRamGiB != null ? `${unit.totalRamGiB.toLocaleString()} GiB ${t("totalLabel")}` : t("inventoryUnavailable")}
                    </p>
                </div>

                {/* Card 3: vCores totales + mix de compra */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 inline-flex items-center gap-1">
                        <span>{t("totalCores")}</span>
                        <InfoTooltip content={t("tooltip_total_cores")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{data.totalCores}</p>
                    <p className="text-xs text-slate-400 mt-1.5">
                        {mix.inventoryAvailable
                            ? `${mix.paygCores} PAYG · ${mix.spotCores} Spot · ${mix.ahubActiveCores} AHUB`
                            : t("inventoryUnavailable")}
                    </p>
                </div>

                {/* Card 4: Eficiencia de uso */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 inline-flex items-center gap-1">
                        <Gauge className="w-3.5 h-3.5 text-amber-500" />
                        <span>{t("efficiencyOfUse")}</span>
                        <InfoTooltip content={t("tooltip_efficiency_of_use")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {unit.avgCpuUtilization != null ? `${unit.avgCpuUtilization}%` : "N/D"}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1">CPU real</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1.5">
                        {unit.effectiveCorePriceUtilized != null
                            ? `${format(unit.effectiveCorePriceUtilized)} / ${t("effectiveCore")}`
                            : t("noMetricsData")}
                    </p>
                </div>

                {/* Card 5: Ahorro potencial de tarifa */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 inline-flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-[#0054A6]" />
                        <span>{t("potentialSavings")}</span>
                        <InfoTooltip content={t("tooltip_potential_savings")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {format(totalPotentialSavings)}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1">{t("perMonth")}</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1.5">{actions.length} {t("actionsAvailable")}</p>
                </div>
            </div>

            {/* Gap 1: Trend chart with Recharts AreaChart + benchmark ReferenceLine */}
            {trendData.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-[#0054A6]" />
                        {t("trend")}
                        <InfoTooltip content={t("tooltip_trend")} position="bottom" align="left" />
                    </h3>
                    <div className="h-52">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trendData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#0054A6" stopOpacity={0.25} />
                                        <stop offset="95%" stopColor="#0054A6" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis
                                    dataKey="month"
                                    tickFormatter={(v: string) => v.slice(5)}
                                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={50}
                                    tickFormatter={(v: number) => `$${v}`}
                                />
                                <RechartsTooltip
                                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                                    formatter={(value: any) => [format(Number(value) || 0), t("costPerCore")]}
                                    labelFormatter={(label: any) => String(label || "")}
                                />
                                <ReferenceLine
                                    y={data.benchmark}
                                    stroke="#10B981"
                                    strokeDasharray="6 4"
                                    strokeWidth={1.5}
                                    label={{ value: `Benchmark: $${data.benchmark}`, position: 'insideTopRight', fontSize: 10, fill: '#10B981' }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="costPerCore"
                                    stroke="#0054A6"
                                    strokeWidth={2}
                                    fill="url(#trendGrad)"
                                    dot={{ r: 3, fill: '#0054A6', strokeWidth: 0 }}
                                    activeDot={{ r: 5, fill: '#0054A6' }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Gap 2: Architecture & Generation mix visual breakdown */}
            {(archMix.length > 0 || genMix.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Architecture mix */}
                    {archMix.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                                <Layers className="w-4 h-4 text-[#0054A6]" />
                                {t("architectureMix")}
                                <InfoTooltip content={t("tooltip_architecture_mix")} position="bottom" align="left" />
                            </h3>
                            <div className="h-40">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={archMix} layout="vertical" margin={{ top: 5, right: 30, left: 50, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                                        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}`} />
                                        <YAxis type="category" dataKey="architecture" tick={{ fontSize: 12, fill: '#475569', fontWeight: 600 }} axisLine={false} tickLine={false} width={50} />
                                        <RechartsTooltip
                                            contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                                            formatter={(value: any, name: any) => {
                                                if (name === 'cores') return [value, 'vCores'];
                                                return [format(Number(value) || 0), '$/Core'];
                                            }}
                                        />
                                        <Bar dataKey="cores" radius={[0, 4, 4, 0]} barSize={20}>
                                            {archMix.map((entry, i) => (
                                                <Cell key={i} fill={ARCH_COLORS[entry.architecture] || '#94a3b8'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex flex-wrap gap-3 mt-3 text-xs">
                                {archMix.map((a) => (
                                    <div key={a.architecture} className="flex items-center gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ARCH_COLORS[a.architecture] || '#94a3b8' }} />
                                        <span className="text-slate-600 dark:text-slate-400">{a.architecture}:</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200">{a.cores} cores</span>
                                        <span className="text-slate-400">({format(a.costPerCore)}/core)</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Generation mix */}
                    {genMix.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                                <HardDrive className="w-4 h-4 text-[#00AEEF]" />
                                {t("generationMix")}
                                <InfoTooltip content={t("tooltip_generation_mix")} position="bottom" align="left" />
                            </h3>
                            <div className="space-y-3">
                                {genMix.map((g) => {
                                    const totalGenCores = genMix.reduce((s, x) => s + x.cores, 0);
                                    const pct = totalGenCores > 0 ? Math.round((g.cores / totalGenCores) * 100) : 0;
                                    return (
                                        <div key={g.generation}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{g.generation}</span>
                                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                                    {g.cores} cores · {format(g.costPerCore)}/core
                                                </span>
                                            </div>
                                            <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-500"
                                                    style={{
                                                        width: `${pct}%`,
                                                        backgroundColor: g.generation.includes('5') || g.generation.includes('6') ? '#0054A6' : g.generation.includes('4') ? '#00AEEF' : '#94a3b8',
                                                    }}
                                                />
                                            </div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">{pct}%</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Rate Optimization Engine — tarjetas resolutivas */}
            {actions.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-[#0054A6]" />
                            {t("rateOptimizationTitle")}
                            <InfoTooltip content={t("tooltip_rate_optimization")} position="bottom" align="left" />
                        </h3>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-slate-800/50">
                        {actions.map((action) => {
                            const Icon = RATE_ACTION_ICON[action.type] || Sparkles;
                            return (
                                <div key={action.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                                    <div className="flex items-start gap-3 flex-1">
                                        <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                                            <Icon className="w-4 h-4 text-[#0054A6]" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(`rateAction_${action.type}_title`)}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t(`rateAction_${action.type}_desc`, action.params)}</p>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">
                                                    {t("estimatedSavings")}: {action.potentialSavingsPct}% ({format(action.potentialMonthlySavings)}{t("perMonth")})
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <Link
                                        href={action.ctaHref}
                                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                    >
                                        {t(`rateAction_${action.type}_cta`, action.params)}
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </Link>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Tables grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* By Region (con comparativa vs región más barata) */}
                {(data.regionDetail?.length || data.byRegion?.length) > 0 && (
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                {t("byRegion")}
                                <InfoTooltip content={t("tooltip_by_region")} position="bottom" align="left" />
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-2 font-semibold">{t("colRegion")}</th>
                                        <th className="px-4 py-2 font-semibold text-right">Cores</th>
                                        <th className="px-4 py-2 font-semibold text-right">$/Core</th>
                                        <th className="px-4 py-2 font-semibold text-right">{t("vsCheapest")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                    {(data.regionDetail?.length ? data.regionDetail : data.byRegion).map((r: any, i: number) => (
                                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                            <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">{r.region}</td>
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{r.cores}</td>
                                            <td className="px-4 py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{format(r.costPerCore)}</td>
                                            <td className="px-4 py-2 text-right">
                                                {typeof r.deltaVsCheapestPct === "number" ? (
                                                    <span className={r.deltaVsCheapestPct > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
                                                        {r.deltaVsCheapestPct > 0 ? "+" : ""}{r.deltaVsCheapestPct}%
                                                    </span>
                                                ) : "—"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Gap 4: By Subscription */}
                {subDetail.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                {t("bySubscription")}
                                <InfoTooltip content={t("tooltip_by_subscription")} position="bottom" align="left" />
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-2 font-semibold">{t("colSubscription")}</th>
                                        <th className="px-4 py-2 font-semibold text-right">Cores</th>
                                        <th className="px-4 py-2 font-semibold text-right">{t("colTotalCost")}</th>
                                        <th className="px-4 py-2 font-semibold text-right">$/Core</th>
                                        <th className="px-4 py-2 font-semibold text-right">{t("colCoverage")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                    {subDetail.map((s, i) => (
                                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                            <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]" title={s.subscriptionName}>
                                                {s.subscriptionName}
                                            </td>
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{s.cores}</td>
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{format(s.totalCost)}</td>
                                            <td className="px-4 py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{format(s.costPerCore)}</td>
                                            <td className="px-4 py-2 text-right">
                                                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${s.commitmentCoveragePct >= 30 ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'}`}>
                                                    {s.commitmentCoveragePct}%
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Gap 3: Full SKU table with RAM, PurchaseType, Cost columns */}
            {(data.skuDetail?.length || data.bySku?.length) > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            {t("bySku")}
                            <InfoTooltip content={t("tooltip_by_sku")} position="bottom" align="left" />
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                <tr>
                                    <th className="px-4 py-2 font-semibold">SKU</th>
                                    {data.skuDetail?.length > 0 && <th className="px-4 py-2 font-semibold">{t("colArchitecture")}</th>}
                                    {data.skuDetail?.length > 0 && <th className="px-4 py-2 font-semibold text-right">{t("colInstances")}</th>}
                                    <th className="px-4 py-2 font-semibold text-right">{data.skuDetail?.length > 0 ? "vCPU/VM" : "Cores"}</th>
                                    {data.skuDetail?.length > 0 && <th className="px-4 py-2 font-semibold text-right">RAM/VM (GiB)</th>}
                                    {data.skuDetail?.length > 0 && <th className="px-4 py-2 font-semibold">{t("colPurchaseType")}</th>}
                                    {data.skuDetail?.length > 0 && <th className="px-4 py-2 font-semibold text-right">{t("colTotalCost")}</th>}
                                    <th className="px-4 py-2 font-semibold text-right">$/Core</th>
                                    {data.skuDetail?.length > 0 && <th className="px-4 py-2 font-semibold text-right">$/GiB</th>}
                                    {data.skuDetail?.length > 0 && <th className="px-4 py-2 font-semibold">{t("colAction")}</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                {(data.skuDetail?.length ? data.skuDetail : data.bySku).map((s: any, i: number) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                        <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                                            {s.sku}
                                        </td>
                                        {data.skuDetail?.length > 0 && (
                                            <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400">{s.architecture} · {s.generation}</td>
                                        )}
                                        {data.skuDetail?.length > 0 && (
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{s.instances}</td>
                                        )}
                                        <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{s.cores}</td>
                                        {data.skuDetail?.length > 0 && (
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{s.ramGiB != null ? s.ramGiB : "—"}</td>
                                        )}
                                        {data.skuDetail?.length > 0 && (
                                            <td className="px-4 py-2">
                                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                                    s.purchaseType === 'Spot' ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
                                                    : s.purchaseType === 'Reserved/SavingsPlan' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                                }`}>
                                                    {s.purchaseType}{s.ahubActive ? ' + AHUB' : ''}
                                                </span>
                                            </td>
                                        )}
                                        {data.skuDetail?.length > 0 && (
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{format(s.cost)}</td>
                                        )}
                                        <td className="px-4 py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{format(s.costPerCore)}</td>
                                        {data.skuDetail?.length > 0 && (
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{s.costPerGiB != null ? format(s.costPerGiB) : "—"}</td>
                                        )}
                                        {data.skuDetail?.length > 0 && (
                                            <td className="px-4 py-2 text-xs">
                                                {s.suggestedAction ? (
                                                    <span className="text-[10px] text-[#0054A6] font-semibold">
                                                        {s.suggestedAction.key === 'arm'
                                                            ? t("skuAction_arm", { sku: s.suggestedAction.sku })
                                                            : t("skuAction_ahub")}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">—</span>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

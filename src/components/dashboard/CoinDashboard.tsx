"use client";
import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import Link from "next/link";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import {
    IconTarget,
    IconTrendingUp,
    IconShieldCheck,
    IconCoin,
    IconCpu,
    IconCheck,
    IconClock,
    IconX,
    IconArrowUpRight,
    IconLoader2,
    IconSparkles,
    IconAward,
    IconFlame,
    IconChecklist,
    IconInfoCircle,
} from "@tabler/icons-react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Cell,
    ReferenceLine,
    Area,
    AreaChart,
} from "recharts";
import { hasAccess } from "@/lib/tierLogic";
import PremiumBanner from "@/components/PremiumBanner";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import type { CoinIndexSummary, CategoryCoinBreakdown, QuickWinRecommendation } from "@/lib/coinTypes";

const CATEGORY_COLORS: Record<string, string> = {
    Cost: "#0054A6",
    Security: "#EF4444",
    Reliability: "#F59E0B",
    HighAvailability: "#F59E0B",
    Performance: "#8B5CF6",
    OperationalExcellence: "#00AEEF",
    "Operational Excellence": "#00AEEF",
};

const CATEGORY_LABELS: Record<string, string> = {
    Cost: "Cost Optimization",
    Security: "Security & Compliance",
    Reliability: "Reliability & HA",
    HighAvailability: "Reliability & HA",
    Performance: "Performance",
    OperationalExcellence: "Operational Excellence",
    "Operational Excellence": "Operational Excellence",
};

export default function CoinDashboard() {
    const t = useTranslations("IntelligenceOptimizationIndex");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || "Professional";
    const isPro = hasAccess(tier, "Professional");
    const [selectedDays, setSelectedDays] = useState<number>(90);

    const fetcher = async (url: string): Promise<CoinIndexSummary> => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || t("errorLoading"));
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR<CoinIndexSummary>(
        isPro && selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/kpis/coin?tenantId=${selectedTenant.id}&days=${selectedDays}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const gaugeColor = useMemo(() => {
        const c = data?.coinVolumeRate ?? data?.coin ?? 0;
        if (c >= 70) return "#10B981"; // Verde
        if (c >= 40) return "#F59E0B"; // Ámbar
        return "#EF4444"; // Rojo
    }, [data?.coinVolumeRate, data?.coin]);

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (!isPro) {
        return (
            <PremiumBanner
                title={t("title")}
                description={t("premiumDescription")}
                requiredTier="Professional"
                icon="zap"
            />
        );
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <IconLoader2 className="w-10 h-10 animate-spin text-[#0054A6] mb-4" />
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">{t("calculating")}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 p-6 rounded-2xl border border-rose-200 dark:border-rose-900/50 flex items-center gap-3">
                <IconX className="w-6 h-6 shrink-0" />
                <p className="font-semibold text-sm">{t("errorLabel", { message: error.message })}</p>
            </div>
        );
    }

    if (!data || data.total === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 text-center shadow-sm">
                <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-400">
                    <IconTarget className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-[#1B2A41] dark:text-white">{t("noManagedRecommendationsTitle")}</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-lg mx-auto mt-2 text-sm">
                    {t("noManagedRecommendationsDescription")}
                </p>
            </div>
        );
    }

    const implemented = data.statusBreakdown?.implemented ?? data.implemented ?? 0;
    const pending = data.statusBreakdown?.pending ?? data.pending ?? (data.total - implemented);
    const accepted = data.statusBreakdown?.accepted ?? data.accepted ?? 0;
    const snoozed = data.statusBreakdown?.snoozed ?? data.suppressed ?? 0;
    const dismissed = data.statusBreakdown?.dismissed ?? data.dismissed ?? 0;
    const total = data.statusBreakdown?.total ?? data.total ?? (pending + accepted + implemented + snoozed + dismissed);

    const coinVolume = data.coinVolumeRate ?? data.coin ?? 0;
    const coinFinancial = data.coinFinancialRate ?? 0;
    const totalPotential = data.totalPotentialSavingsUsd ?? 420.0;
    const realizedSavings = data.realizedSavingsUsd ?? 0.0;

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            {/* Header y Control de Ventana Temporal */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#E6F2FB] dark:bg-slate-800 flex items-center justify-center text-[#0054A6]">
                        <IconTarget className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                            {t("title")}
                            <InfoTooltip content="El Índice de Implementación de Optimización de Costos (COIN) cuantifica la tasa de éxito de su equipo en convertir recomendaciones abiertas en ahorros y mejoras de arquitectura ejecutadas." />
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t("subtitle")}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {[30, 60, 90, 180].map((d) => (
                        <button
                            key={d}
                            onClick={() => setSelectedDays(d)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                                selectedDays === d
                                    ? "bg-white dark:bg-slate-900 border-[#0054A6] text-[#0054A6] shadow-sm"
                                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                            }`}
                        >
                            {d}d
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI Cards Superiores: Score Dual + Embudo de 5 Estados */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Card 1: Índice COIN Dual (Volumen vs Financiero) */}
                <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {t("coinLastDays", { days: data.windowDays || selectedDays })}
                            </span>
                            <InfoTooltip content="Tasa de ejecución porcentual de recomendaciones WAF implementadas sobre el total gestionado en el período." />
                        </div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#E6F2FB] dark:bg-slate-800 text-[#0054A6]">
                            <IconAward className="w-3.5 h-3.5" />
                            FinOps KPI
                        </span>
                    </div>

                    <div className="flex items-center gap-6 my-2">
                        {/* Gauge Circular Badge */}
                        <div className="relative flex items-center justify-center">
                            <svg className="w-28 h-28 transform -rotate-90">
                                <circle
                                    cx="56"
                                    cy="56"
                                    r="44"
                                    stroke="currentColor"
                                    strokeWidth="10"
                                    className="text-slate-100 dark:text-slate-800"
                                    fill="transparent"
                                />
                                <circle
                                    cx="56"
                                    cy="56"
                                    r="44"
                                    stroke={gaugeColor}
                                    strokeWidth="10"
                                    strokeDasharray={276.46}
                                    strokeDashoffset={276.46 - (276.46 * Math.min(100, Math.max(0, coinVolume))) / 100}
                                    strokeLinecap="round"
                                    fill="transparent"
                                    className="transition-all duration-1000 ease-out"
                                />
                            </svg>
                            <div className="absolute flex flex-col items-center justify-center text-center">
                                <span className="text-2xl font-black text-[#1B2A41] dark:text-white">
                                    {coinVolume}%
                                </span>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">
                                    COIN
                                </span>
                            </div>
                        </div>

                        {/* Tasas Duales */}
                        <div className="flex-1 space-y-3">
                            <div>
                                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                    <span>{t("coinVolumeLabel")}</span>
                                    <span className="font-bold text-[#1B2A41] dark:text-white">{coinVolume}%</span>
                                </div>
                                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{ width: `${coinVolume}%`, backgroundColor: gaugeColor }}
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                    <span>{t("coinFinancialLabel")}</span>
                                    <span className="font-bold text-[#0054A6] dark:text-cyan-400">{coinFinancial}%</span>
                                </div>
                                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-[#0054A6] dark:bg-cyan-400 rounded-full transition-all duration-500"
                                        style={{ width: `${coinFinancial}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                        {t("capturedSavingsSummary", {
                            implemented,
                            total,
                            realized: `$${realizedSavings.toFixed(2)}`,
                            potential: `$${totalPotential.toFixed(2)}`,
                            days: data.windowDays || selectedDays,
                        })}
                    </div>
                </div>

                {/* Card 2: Embudo de Estado Exhaustivo (5 Estados) */}
                <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                            <IconChecklist className="w-5 h-5 text-[#0054A6]" />
                            {t("recommendationsStatus")}
                            <InfoTooltip content="Desglose exhaustivo de las recomendaciones detectadas clasificadas por su ciclo de vida y resolución." />
                        </h3>
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                            Total: <strong className="text-[#1B2A41] dark:text-white">{total}</strong>
                        </span>
                    </div>

                    {/* Grid de 5 Métricas */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 my-auto">
                        {/* 1. Pendientes */}
                        <div className="p-3.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex flex-col items-center text-center">
                            <div className="w-7 h-7 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center mb-2">
                                <IconFlame className="w-4 h-4" />
                            </div>
                            <span className="text-2xl font-black text-amber-700 dark:text-amber-300">{pending}</span>
                            <span className="text-[11px] font-bold text-amber-800 dark:text-amber-400 mt-0.5">{t("statusPending")}</span>
                            <span className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
                                {total > 0 ? `${Math.round((pending / total) * 100)}%` : "0%"}
                            </span>
                        </div>

                        {/* 2. Aceptadas / En Progreso */}
                        <div className="p-3.5 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 flex flex-col items-center text-center">
                            <div className="w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center mb-2">
                                <IconClock className="w-4 h-4" />
                            </div>
                            <span className="text-2xl font-black text-blue-700 dark:text-blue-300">{accepted}</span>
                            <span className="text-[11px] font-bold text-blue-800 dark:text-blue-400 mt-0.5">{t("statusAccepted")}</span>
                            <span className="text-[10px] text-blue-600 dark:text-blue-500 mt-0.5">
                                {total > 0 ? `${Math.round((accepted / total) * 100)}%` : "0%"}
                            </span>
                        </div>

                        {/* 3. Implementadas */}
                        <div className="p-3.5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 flex flex-col items-center text-center">
                            <div className="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mb-2">
                                <IconCheck className="w-4 h-4" />
                            </div>
                            <span className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{implemented}</span>
                            <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-400 mt-0.5">{t("statusImplemented")}</span>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-0.5">
                                {total > 0 ? `${Math.round((implemented / total) * 100)}%` : "0%"}
                            </span>
                        </div>

                        {/* 4. Pospuestas / Snoozed */}
                        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center">
                            <div className="w-7 h-7 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center mb-2">
                                <IconClock className="w-4 h-4" />
                            </div>
                            <span className="text-2xl font-black text-slate-700 dark:text-slate-300">{snoozed}</span>
                            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mt-0.5">{t("statusSuppressed")}</span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-500 mt-0.5">
                                {total > 0 ? `${Math.round((snoozed / total) * 100)}%` : "0%"}
                            </span>
                        </div>

                        {/* 5. Descartadas */}
                        <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center">
                            <div className="w-7 h-7 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center mb-2">
                                <IconX className="w-4 h-4" />
                            </div>
                            <span className="text-2xl font-black text-slate-500 dark:text-slate-400">{dismissed}</span>
                            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">{t("statusDismissed")}</span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                                {total > 0 ? `${Math.round((dismissed / total) * 100)}%` : "0%"}
                            </span>
                        </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                        <span>Balance de Inventario: <strong>{pending} abiertas</strong> de {total} totales</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            Tasa de Resolución Activa: {coinVolume}%
                        </span>
                    </div>
                </div>
            </div>

            {/* Gráficos Principales: COIN por Categoría WAF + Tendencia Mensual */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Gráfico 1: COIN por Categoría WAF (Horizontal Bar Chart con Margen Amplio) */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                                <IconSparkles className="w-5 h-5 text-[#0054A6]" />
                                {t("coinByCategory")}
                                <InfoTooltip content="Tasa de implementación lograda en cada uno de los 5 pilares del Azure Well-Architected Framework." />
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                5 Pilares Well-Architected Framework (WAF)
                            </p>
                        </div>
                    </div>

                    <div className="h-[280px] w-full mt-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={data.breakdown || []}
                                layout="vertical"
                                margin={{ top: 10, right: 30, left: 20, bottom: 10 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" opacity={0.15} />
                                <XAxis
                                    type="number"
                                    domain={[0, 100]}
                                    tick={{ fontSize: 11, fill: "#64748B", fontWeight: 600 }}
                                    tickFormatter={(v) => `${v}%`}
                                />
                                <YAxis
                                    type="category"
                                    dataKey="category"
                                    width={150}
                                    tick={{ fontSize: 11, fill: "#1B2A41", fontWeight: 700 }}
                                    tickFormatter={(cat) => CATEGORY_LABELS[cat] || cat}
                                />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const item: CategoryCoinBreakdown = payload[0].payload;
                                            const label = CATEGORY_LABELS[item.category] || item.category;
                                            const color = CATEGORY_COLORS[item.category] || "#0054A6";
                                            return (
                                                <div className="bg-[#1B2A41] text-white p-3 rounded-xl shadow-2xl border border-slate-700 text-xs space-y-1 z-[9999]">
                                                    <div className="flex items-center gap-2 font-bold text-sm" style={{ color }}>
                                                        <span>●</span>
                                                        <span>{label}</span>
                                                    </div>
                                                    <p className="text-slate-300">
                                                        Implementado: <strong>{item.coinRate}%</strong> ({item.implemented} de {item.total} recomendaciones)
                                                    </p>
                                                    {item.potentialSavingsUsd > 0 && (
                                                        <p className="text-emerald-400 font-semibold">
                                                            Ahorro: ${item.realizedSavingsUsd || 0} / ${item.potentialSavingsUsd} USD/mes
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Bar dataKey="coinRate" radius={[0, 6, 6, 0]} barSize={20}>
                                    {(data.breakdown || []).map((entry) => (
                                        <Cell
                                            key={entry.category}
                                            fill={CATEGORY_COLORS[entry.category] || "#0054A6"}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Gráfico 2: Tendencia Mensual con Línea de Benchmark (70%) */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                                <IconTrendingUp className="w-5 h-5 text-[#0054A6]" />
                                {t("monthlyTrend")}
                                <InfoTooltip content="Evolución histórica de la tasa COIN durante los últimos 6 meses comparada con el objetivo de excelencia (70%)." />
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {t("benchmarkTarget")}
                            </p>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                            Objetivo: 70%
                        </span>
                    </div>

                    <div className="h-[280px] w-full mt-2">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={data.monthly || []}
                                margin={{ top: 15, right: 20, left: 10, bottom: 10 }}
                            >
                                <defs>
                                    <linearGradient id="coinGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#0054A6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#0054A6" stopOpacity={0.0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.15} />
                                <XAxis
                                    dataKey="month"
                                    tick={{ fontSize: 11, fill: "#64748B", fontWeight: 600 }}
                                />
                                <YAxis
                                    domain={[0, 100]}
                                    tick={{ fontSize: 11, fill: "#64748B", fontWeight: 600 }}
                                    tickFormatter={(v) => `${v}%`}
                                />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const item = payload[0].payload;
                                            return (
                                                <div className="bg-[#1B2A41] text-white p-3 rounded-xl shadow-2xl border border-slate-700 text-xs space-y-1 z-[9999]">
                                                    <p className="font-bold text-cyan-400">{item.month}</p>
                                                    <p className="text-slate-200">
                                                        Tasa COIN: <strong>{item.coinRate}%</strong>
                                                    </p>
                                                    <p className="text-slate-400 text-[11px]">
                                                        {item.implementedCount} implementadas de {item.totalCount} gestionadas
                                                    </p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <ReferenceLine
                                    y={70}
                                    stroke="#10B981"
                                    strokeDasharray="4 4"
                                    strokeWidth={2}
                                    label={{
                                        value: "Benchmark Target (70%)",
                                        position: "insideTopRight",
                                        fill: "#10B981",
                                        fontSize: 11,
                                        fontWeight: 700,
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="coinRate"
                                    stroke="#0054A6"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#coinGrad)"
                                    activeDot={{ r: 6, fill: "#0054A6", stroke: "#FFFFFF", strokeWidth: 2 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Sección Inferior: Top Quick Wins Pendientes de Implementar */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
                    <div>
                        <h3 className="text-lg font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                            <IconFlame className="w-5 h-5 text-amber-500" />
                            {t("quickWinsTitle")}
                            <InfoTooltip content="Recomendaciones abiertas con mayor retorno de inversión y facilidad técnica para ejecutar de inmediato." />
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("quickWinsSubtitle")}
                        </p>
                    </div>
                    <span className="text-xs font-bold text-[#0054A6] dark:text-cyan-400">
                        {data.quickWins?.length || 0} Oportunidades Priorizadas
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                                <th className="pb-3 px-3">{t("colRecommendation")}</th>
                                <th className="pb-3 px-3">{t("colCategory")}</th>
                                <th className="pb-3 px-3">{t("colResource")}</th>
                                <th className="pb-3 px-3 text-right">{t("colSavings")}</th>
                                <th className="pb-3 px-3 text-right">{t("colAction")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                            {(data.quickWins && data.quickWins.length > 0) ? (
                                data.quickWins.map((qw) => (
                                    <tr
                                        key={qw.id}
                                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                                    >
                                        <td className="py-3.5 px-3 font-semibold text-[#1B2A41] dark:text-white max-w-sm">
                                            {qw.name}
                                        </td>
                                        <td className="py-3.5 px-3">
                                            <span
                                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border"
                                                style={{
                                                    backgroundColor: `${CATEGORY_COLORS[qw.category] || "#0054A6"}15`,
                                                    borderColor: `${CATEGORY_COLORS[qw.category] || "#0054A6"}30`,
                                                    color: CATEGORY_COLORS[qw.category] || "#0054A6",
                                                }}
                                            >
                                                {qw.category}
                                            </span>
                                        </td>
                                        <td className="py-3.5 px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                                            {qw.impactedResource}
                                        </td>
                                        <td className="py-3.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                            {qw.estimatedMonthlySavingsUsd > 0
                                                ? `$${qw.estimatedMonthlySavingsUsd.toFixed(2)} USD/mes`
                                                : "Protección / HA"}
                                        </td>
                                        <td className="py-3.5 px-3 text-right">
                                            <Link
                                                href={qw.targetModuleUrl || "/intelligence/computo"}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 text-[#0054A6] dark:text-cyan-400 border border-[#0054A6] dark:border-cyan-500 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-all shadow-sm"
                                            >
                                                <span>{t("btnResolve")}</span>
                                                <IconArrowUpRight className="w-3.5 h-3.5" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className="py-8 text-center text-slate-400">
                                        No hay recomendaciones pendientes de resolver en este momento.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

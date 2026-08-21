"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import {
    DataLakeAccountDetail,
    DataLakeRemediationAction,
    DataLakeResponse,
} from "@/types/dataLakeGen2.types";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import {
    IconRefresh,
    IconSearch,
    IconDatabase,
    IconTrendingUp,
    IconArrowDownRight,
    IconShieldCheck,
    IconAlertTriangle,
    IconCode,
    IconCopy,
    IconCheck,
    IconX,
    IconServer,
    IconCpu,
    IconLayersLinked,
    IconFlame,
    IconSnowflake,
    IconArrowsExchange,
    IconFileCode,
} from "@tabler/icons-react";

export default function DataLakeGen2FinopsDashboard() {
    const t = useTranslations("DataLakeFinops");
    const { selectedTenant } = useTenant();
    const { instance, accounts: msalAccounts } = useMsal();
    const tenantId = selectedTenant?.id || "demo-tenant-id";

    const fetcher = async (url: string) => {
        let token: string | null = null;
        if (msalAccounts[0]) {
            token = await getFreshIdToken(instance, msalAccounts[0], ["User.Read"]).catch(() => null);
        }
        const res = await fetch(url, {
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                "x-tenant-id": tenantId,
            },
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    };

    const swrKey = tenantId && tenantId !== "default"
        ? `/api/intelligence/storage/data-lake-gen2?tenantId=${tenantId}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<DataLakeResponse>(
        swrKey,
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 60000 }
    );

    // Filters & Sorting State
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedRegion, setSelectedRegion] = useState("all");
    const [selectedRedundancy, setSelectedRedundancy] = useState("all");
    const [selectedLifecycle, setSelectedLifecycle] = useState("all");
    const [selectedEnvironment, setSelectedEnvironment] = useState("all");
    const [sortBy, setSortBy] = useState<"cost_desc" | "cost_asc" | "storage_desc" | "transactions_desc" | "name_asc">("cost_desc");

    // Pagination State
    const [pageSize, setPageSize] = useState<15 | 30 | 45 | 60>(15);
    const [currentPage, setCurrentPage] = useState(1);

    // Modal / Drawer State
    const [selectedAccount, setSelectedAccount] = useState<DataLakeAccountDetail | null>(null);
    const [activeRemediation, setActiveRemediation] = useState<DataLakeRemediationAction | null>(null);
    const [activeScriptTab, setActiveScriptTab] = useState<"cli" | "ps" | "json">("cli");
    const [copied, setCopied] = useState(false);

    const accounts = useMemo(() => data?.accounts || [], [data]);
    const kpis = data?.kpis;
    const storageBreakdown = data?.storageBreakdown || {
        totalStorageBytes: 0,
        totalStorageGB: 0,
        totalStorageTB: 0,
        hotTierBytes: 0,
        coolTierBytes: 0,
        coldTierBytes: 0,
        archiveTierBytes: 0,
        hotTierGB: 0,
        coolTierGB: 0,
        coldTierGB: 0,
        archiveTierGB: 0,
    };
    const remediations = data?.remediations || [];

    // Filter Options
    const regions = useMemo(() => Array.from(new Set(accounts.map((a) => a.location))).filter(Boolean), [accounts]);
    const redundancies = useMemo(() => Array.from(new Set(accounts.map((a) => a.redundancyType))).filter(Boolean), [accounts]);
    const environments = useMemo(() => Array.from(new Set(accounts.map((a) => a.environmentTag))).filter(Boolean), [accounts]);

    // Filtered & Sorted Accounts
    const filteredAccounts = useMemo(() => {
        return accounts
            .filter((a) => {
                const matchesSearch =
                    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    a.resourceGroup.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    a.subscriptionName.toLowerCase().includes(searchTerm.toLowerCase());
                const matchesRegion = selectedRegion === "all" || a.location === selectedRegion;
                const matchesRedundancy = selectedRedundancy === "all" || a.redundancyType === selectedRedundancy;
                const matchesLifecycle =
                    selectedLifecycle === "all" ||
                    (selectedLifecycle === "active" && a.hasLifecyclePolicy) ||
                    (selectedLifecycle === "none" && !a.hasLifecyclePolicy);
                const matchesEnv = selectedEnvironment === "all" || a.environmentTag === selectedEnvironment;

                return matchesSearch && matchesRegion && matchesRedundancy && matchesLifecycle && matchesEnv;
            })
            .sort((a, b) => {
                if (sortBy === "cost_desc") return b.monthlyCostUsd - a.monthlyCostUsd;
                if (sortBy === "cost_asc") return a.monthlyCostUsd - b.monthlyCostUsd;
                if (sortBy === "storage_desc") return b.storageBreakdown.totalStorageGB - a.storageBreakdown.totalStorageGB;
                if (sortBy === "transactions_desc") return b.metrics.transactionsCount - a.metrics.transactionsCount;
                if (sortBy === "name_asc") return a.name.localeCompare(b.name);
                return 0;
            });
    }, [accounts, searchTerm, selectedRegion, selectedRedundancy, selectedLifecycle, selectedEnvironment, sortBy]);

    // Pagination calculations
    const totalPages = Math.ceil(filteredAccounts.length / pageSize) || 1;
    const paginatedAccounts = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredAccounts.slice(start, start + pageSize);
    }, [filteredAccounts, currentPage, pageSize]);

    const format = (val: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(val);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSort = (field: "cost" | "storage" | "transactions" | "name") => {
        if (field === "cost") setSortBy((prev) => (prev === "cost_desc" ? "cost_asc" : "cost_desc"));
        if (field === "storage") setSortBy((prev) => (prev === "storage_desc" ? "cost_desc" : "storage_desc"));
        if (field === "transactions") setSortBy((prev) => (prev === "transactions_desc" ? "cost_desc" : "transactions_desc"));
        if (field === "name") setSortBy((prev) => (prev === "name_asc" ? "cost_desc" : "name_asc"));
    };

    if (isLoading) {
        return (
            <div className="p-8 space-y-6 animate-pulse">
                <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-1/3" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
                    ))}
                </div>
                <div className="h-40 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
                <div className="h-64 bg-slate-100 dark:bg-slate-800/60 rounded-xl" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300">
                <div className="flex items-center gap-2 font-semibold">
                    <IconAlertTriangle className="w-5 h-5 text-rose-600" />
                    <span>Error al cargar telemetría de Azure Data Lake Gen2</span>
                </div>
                <p className="text-sm mt-1">{error?.message || "Ocurrió un error inesperado al conectar con Azure Resource Graph."}</p>
                <button
                    onClick={() => mutate()}
                    className="mt-3 px-4 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 rounded-lg hover:bg-rose-100/50"
                >
                    Reintentar
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6 font-['ui-sans-serif',system-ui,sans-serif]">
            {/* Header & Controls */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                        <IconDatabase className="w-6 h-6 text-[#0054A6]" stroke={1.5} />
                        <span>{t("cockpitTitle")}</span>
                        <InfoTooltip content={t("tooltipCockpit")} />
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {t("cockpitSubtitle")}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => mutate()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                    >
                        <IconRefresh className="w-4 h-4" stroke={1.5} />
                        <span>{t("refreshButton")}</span>
                    </button>
                </div>
            </div>

            {/* 8 KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Costo MTD */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiMtdCost")}
                            <InfoTooltip content={t("tooltipMtdCost")} />
                        </span>
                        <IconDatabase className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {format(kpis?.totalMtdCost ?? 0)}
                    </p>
                    <span className="text-[11px] text-slate-400">gasto acumulado mes actual</span>
                </div>

                {/* 2. Forecast Fin de Mes */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiForecastEom")}
                            <InfoTooltip content={t("tooltipForecastEom")} />
                        </span>
                        <IconTrendingUp className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {format(kpis?.projectedEndOfMonthCost ?? 0)}
                    </p>
                    <span className="text-[11px] text-slate-400">proyección de cierre</span>
                </div>

                {/* 3. Ahorro Potencial Total */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiPotentialSavings")}
                            <InfoTooltip content={t("tooltipPotentialSavings")} />
                        </span>
                        <IconArrowDownRight className="w-4 h-4 text-emerald-600" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-['Montserrat']">
                        {format(kpis?.potentialMonthlySavings ?? 0)}
                        <span className="text-xs font-normal text-slate-500 ml-1">/mes</span>
                    </p>
                    <span className="text-[11px] text-slate-500">
                        {remediations.length} acciones de optimización
                    </span>
                </div>

                {/* 4. Variación MoM */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiMomVariation")}
                            <InfoTooltip content={t("tooltipMomVariation")} />
                        </span>
                        <IconTrendingUp className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                            {(kpis?.momVariationPercent ?? 0) > 0 ? `+${kpis?.momVariationPercent}%` : `${kpis?.momVariationPercent ?? 0}%`}
                        </p>
                    </div>
                    <span className="text-[11px] text-slate-400">vs. mes anterior</span>
                </div>

                {/* 5. Recursos Evaluados */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiTotalAccounts")}
                            <InfoTooltip content={t("tooltipTotalAccounts")} />
                        </span>
                        <IconLayersLinked className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {kpis?.totalAccountsCount ?? 0}
                    </p>
                    <span className="text-[11px] text-slate-400">{storageBreakdown.totalStorageTB} TB gestionados</span>
                </div>

                {/* 6. Eficiencia ($/TB) */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiCostPerTb")}
                            <InfoTooltip content={t("tooltipCostPerTb")} />
                        </span>
                        <IconCpu className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        ${kpis?.costPerTbManaged ?? 0}
                        <span className="text-xs font-normal text-slate-500 ml-1">/TB-mes</span>
                    </p>
                    <span className="text-[11px] text-slate-400">costo promedio de lago</span>
                </div>

                {/* 7. Fríos en Hot (Candidatos a Cool/Cold) */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiColdCandidates")}
                            <InfoTooltip content={t("tooltipColdCandidates")} />
                        </span>
                        <IconFlame className="w-4 h-4 text-amber-500" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 font-['Montserrat']">
                        {((kpis?.coldCandidatesTotalGB ?? 0) / 1024).toFixed(1)}
                        <span className="text-xs font-normal text-slate-500 ml-1">TB</span>
                    </p>
                    <span className="text-[11px] text-slate-400">en Hot sin ciclo de vida</span>
                </div>

                {/* 8. Salud Operativa */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiHealthScore")}
                            <InfoTooltip content={t("tooltipHealthScore")} />
                        </span>
                        <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                            {kpis?.healthScore ?? 100}
                        </p>
                        <span className="text-xs text-slate-400">/ 100</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
                        <div
                            className={`h-full rounded-full ${
                                (kpis?.healthScore ?? 100) >= 85
                                    ? "bg-emerald-500"
                                    : (kpis?.healthScore ?? 100) >= 60
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                            }`}
                            style={{ width: `${kpis?.healthScore ?? 100}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Data Lake Storage Temperature Breakdown Bar (Corporate Blue Palette) */}
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5 font-['Montserrat']">
                            <IconSnowflake className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                            <span>{t("storageBreakdownTitle")}</span>
                            <InfoTooltip content={t("tooltipStorageBreakdown")} />
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Distribución de capacidad entre Hot, Cool, Cold y Archive Tiers ({storageBreakdown.totalStorageTB} TB Totales)
                        </p>
                    </div>
                </div>

                {/* Stacked Progress Bar */}
                <div className="w-full h-4 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 flex shadow-inner">
                    {storageBreakdown.totalStorageGB > 0 ? (
                        <>
                            {/* 1. Hot Tier (#0078D4) */}
                            <div
                                style={{ width: `${(storageBreakdown.hotTierGB / storageBreakdown.totalStorageGB) * 100}%` }}
                                className="bg-[#0078D4] h-full transition-all hover:opacity-85"
                                title={`Hot Tier: ${(storageBreakdown.hotTierGB / 1024).toFixed(2)} TB`}
                            />
                            {/* 2. Cool Tier (#2563EB) */}
                            <div
                                style={{ width: `${(storageBreakdown.coolTierGB / storageBreakdown.totalStorageGB) * 100}%` }}
                                className="bg-[#2563EB] h-full transition-all hover:opacity-85"
                                title={`Cool Tier: ${(storageBreakdown.coolTierGB / 1024).toFixed(2)} TB`}
                            />
                            {/* 3. Cold Tier (#38BDF8) */}
                            <div
                                style={{ width: `${(storageBreakdown.coldTierGB / storageBreakdown.totalStorageGB) * 100}%` }}
                                className="bg-[#38BDF8] h-full transition-all hover:opacity-85"
                                title={`Cold Tier: ${(storageBreakdown.coldTierGB / 1024).toFixed(2)} TB`}
                            />
                            {/* 4. Archive Tier (#BAE6FD) */}
                            <div
                                style={{ width: `${(storageBreakdown.archiveTierGB / storageBreakdown.totalStorageGB) * 100}%` }}
                                className="bg-[#BAE6FD] h-full transition-all hover:opacity-85"
                                title={`Archive Tier: ${(storageBreakdown.archiveTierGB / 1024).toFixed(2)} TB`}
                            />
                        </>
                    ) : (
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-full" />
                    )}
                </div>

                {/* Micro Cards Legend */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm bg-[#0078D4] shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Hot Tier</p>
                                <p className="text-[11px] text-slate-500">{(storageBreakdown.hotTierGB / 1024).toFixed(2)} TB ({storageBreakdown.totalStorageGB > 0 ? ((storageBreakdown.hotTierGB / storageBreakdown.totalStorageGB) * 100).toFixed(1) : 0}%)</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm bg-[#2563EB] shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Cool Tier</p>
                                <p className="text-[11px] text-slate-500">{(storageBreakdown.coolTierGB / 1024).toFixed(2)} TB ({storageBreakdown.totalStorageGB > 0 ? ((storageBreakdown.coolTierGB / storageBreakdown.totalStorageGB) * 100).toFixed(1) : 0}%)</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm bg-[#38BDF8] shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Cold Tier</p>
                                <p className="text-[11px] text-slate-500">{(storageBreakdown.coldTierGB / 1024).toFixed(2)} TB ({storageBreakdown.totalStorageGB > 0 ? ((storageBreakdown.coldTierGB / storageBreakdown.totalStorageGB) * 100).toFixed(1) : 0}%)</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm bg-[#BAE6FD] shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Archive Tier</p>
                                <p className="text-[11px] text-slate-500">{(storageBreakdown.archiveTierGB / 1024).toFixed(2)} TB ({storageBreakdown.totalStorageGB > 0 ? ((storageBreakdown.archiveTierGB / storageBreakdown.totalStorageGB) * 100).toFixed(1) : 0}%)</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 4 Resolutive FinOps Remediations Cards */}
            {remediations.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5 font-['Montserrat']">
                            <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                            <span>{t("remediationsHeader")}</span>
                            <InfoTooltip content={t("tooltipRemediations")} />
                        </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {remediations.slice(0, 4).map((rem) => (
                            <div
                                key={rem.id}
                                className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between hover:border-[#0054A6]/50 transition-colors"
                            >
                                <div className="space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[#0054A6]">
                                                {rem.category === "LIFECYCLE_TIERING" ? (
                                                    <IconSnowflake className="w-4 h-4" stroke={1.5} />
                                                ) : rem.category === "REDUNDANCY_OPTIMIZATION" ? (
                                                    <IconArrowsExchange className="w-4 h-4" stroke={1.5} />
                                                ) : rem.category === "STORAGE_RESERVATION" ? (
                                                    <IconServer className="w-4 h-4" stroke={1.5} />
                                                ) : (
                                                    <IconCpu className="w-4 h-4" stroke={1.5} />
                                                )}
                                            </span>
                                            <div>
                                                <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">{rem.title}</h4>
                                                <span className="text-[10px] text-slate-400">{rem.accountName}</span>
                                            </div>
                                        </div>
                                        <span className="px-2 py-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-md shrink-0">
                                            +{format(rem.estimatedSavingsUSD)}/mes
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{rem.description}</p>
                                </div>

                                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                                        Impacto: {rem.impact}
                                    </span>
                                    <button
                                        onClick={() => {
                                            setActiveRemediation(rem);
                                            setActiveScriptTab(rem.commandPayload.jsonPolicy ? "json" : "cli");
                                        }}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                                    >
                                        <IconCode className="w-3.5 h-3.5" stroke={1.5} />
                                        <span>{rem.commandPayload.jsonPolicy ? "Ver Política JSON" : "Ver Script"}</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Master Filter Bar */}
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[240px]">
                        <IconSearch className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" stroke={1.5} />
                        <input
                            type="text"
                            placeholder={t("searchPlaceholder")}
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
                        />
                    </div>

                    {/* Dropdowns */}
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Región */}
                        <select
                            value={selectedRegion}
                            onChange={(e) => {
                                setSelectedRegion(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-[#0054A6]"
                        >
                            <option value="all">{t("filterRegion")}: {t("filterAll")}</option>
                            {regions.map((r) => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>

                        {/* Redundancia */}
                        <select
                            value={selectedRedundancy}
                            onChange={(e) => {
                                setSelectedRedundancy(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-[#0054A6]"
                        >
                            <option value="all">{t("filterRedundancy")}: {t("filterAll")}</option>
                            {redundancies.map((r) => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>

                        {/* Lifecycle Policy */}
                        <select
                            value={selectedLifecycle}
                            onChange={(e) => {
                                setSelectedLifecycle(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-[#0054A6]"
                        >
                            <option value="all">{t("filterLifecycle")}: {t("filterAll")}</option>
                            <option value="active">{t("filterLifecycleActive")}</option>
                            <option value="none">{t("filterLifecycleNone")}</option>
                        </select>

                        {/* Entorno */}
                        <select
                            value={selectedEnvironment}
                            onChange={(e) => {
                                setSelectedEnvironment(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-[#0054A6]"
                        >
                            <option value="all">{t("filterEnvironment")}: {t("filterAll")}</option>
                            {environments.map((env) => (
                                <option key={env} value={env}>{env.toUpperCase()}</option>
                            ))}
                        </select>

                        {/* Sort */}
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-[#0054A6]"
                        >
                            <option value="cost_desc">{t("sortCostDesc")}</option>
                            <option value="cost_asc">{t("sortCostAsc")}</option>
                            <option value="storage_desc">{t("sortStorageDesc")}</option>
                            <option value="transactions_desc">{t("sortTransactionsDesc")}</option>
                            <option value="name_asc">{t("sortNameAsc")}</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Master Paginated Table */}
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-[#1B2A41] dark:text-slate-300 font-semibold font-['Montserrat']">
                                <ResizableTh className="py-3 px-4">
                                    <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("name")}>
                                        <span>{t("colAccount")}</span>
                                        <InfoTooltip content={t("tooltipColAccount")} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh className="py-3 px-4">
                                    <div className="flex items-center gap-1">
                                        <span>{t("colRegion")}</span>
                                        <InfoTooltip content={t("tooltipColRegion")} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh className="py-3 px-4">
                                    <div className="flex items-center gap-1">
                                        <span>{t("colRedundancy")}</span>
                                        <InfoTooltip content={t("tooltipColRedundancy")} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh className="py-3 px-4">
                                    <div className="flex items-center gap-1">
                                        <span>{t("colLifecycle")}</span>
                                        <InfoTooltip content={t("tooltipColLifecycle")} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh className="py-3 px-4">
                                    <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("storage")}>
                                        <span>{t("colStorage")}</span>
                                        <InfoTooltip content={t("tooltipColStorage")} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh className="py-3 px-4">
                                    <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("transactions")}>
                                        <span>{t("colTransactions")}</span>
                                        <InfoTooltip content={t("tooltipColTransactions")} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh className="py-3 px-4">
                                    <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("cost")}>
                                        <span>{t("colCost")}</span>
                                        <InfoTooltip content={t("tooltipColCost")} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh className="py-3 px-4">
                                    <div className="flex items-center gap-1">
                                        <span>{t("colSavings")}</span>
                                        <InfoTooltip content={t("tooltipColSavings")} />
                                    </div>
                                </ResizableTh>
                                <th className="py-3 px-4 text-right">{t("colActions")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {paginatedAccounts.length > 0 ? (
                                paginatedAccounts.map((account) => {
                                    const hotPct = account.storageBreakdown.totalStorageGB > 0
                                        ? Math.round((account.storageBreakdown.hotTierGB / account.storageBreakdown.totalStorageGB) * 100)
                                        : 0;
                                    const coolPct = account.storageBreakdown.totalStorageGB > 0
                                        ? Math.round((account.storageBreakdown.coolTierGB / account.storageBreakdown.totalStorageGB) * 100)
                                        : 0;
                                    const totalSavings = account.recommendations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0);

                                    return (
                                        <tr
                                            key={account.id}
                                            className="hover:bg-blue-50/30 dark:hover:bg-slate-800/30 transition-colors"
                                        >
                                            {/* Account Name & Identity */}
                                            <td className="py-3 px-4 font-medium">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-slate-900 dark:text-slate-100 font-semibold">{account.name}</span>
                                                        <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-sm bg-blue-100 dark:bg-blue-950/60 text-[#0054A6]">
                                                            HNS
                                                        </span>
                                                        {account.environmentTag !== "unknown" && (
                                                            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                                                {account.environmentTag.toUpperCase()}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-[11px] text-slate-400">{account.resourceGroup}</span>
                                                </div>
                                            </td>

                                            {/* Región */}
                                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{account.location}</td>

                                            {/* Redundancia */}
                                            <td className="py-3 px-4">
                                                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                                    {account.redundancyType}
                                                </span>
                                            </td>

                                            {/* Lifecycle Policy */}
                                            <td className="py-3 px-4">
                                                {account.hasLifecyclePolicy ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-md">
                                                        <IconCheck className="w-3 h-3" /> Activa ({account.lifecycleRulesCount})
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-amber-700 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md">
                                                        <IconAlertTriangle className="w-3 h-3" /> Sin Reglas
                                                    </span>
                                                )}
                                            </td>

                                            {/* Storage & Temperature Bar */}
                                            <td className="py-3 px-4">
                                                <div className="space-y-1 min-w-[120px]">
                                                    <div className="flex justify-between text-[11px]">
                                                        <span className="font-semibold text-slate-900 dark:text-slate-100">{account.storageBreakdown.totalStorageTB} TB</span>
                                                        <span className="text-slate-400">Hot: {hotPct}%</span>
                                                    </div>
                                                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden flex">
                                                        <div style={{ width: `${hotPct}%` }} className="bg-[#0078D4] h-full" />
                                                        <div style={{ width: `${coolPct}%` }} className="bg-[#2563EB] h-full" />
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Transactions */}
                                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                                                <div className="flex flex-col">
                                                    <span className="font-semibold">{(account.metrics.transactionsCount / 1000000).toFixed(1)} M ops</span>
                                                    {account.metrics.hasSmallFilesAnomaly && (
                                                        <span className="text-[10px] text-amber-600 font-medium">⚠️ Alto costo ops</span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Costo Mensual */}
                                            <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                                                {format(account.monthlyCostUsd)}
                                            </td>

                                            {/* Ahorro Estimado */}
                                            <td className="py-3 px-4">
                                                {totalSavings > 0 ? (
                                                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                                        +{format(totalSavings)}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400">-</span>
                                                )}
                                            </td>

                                            {/* Acciones */}
                                            <td className="py-3 px-4 text-right">
                                                <button
                                                    onClick={() => setSelectedAccount(account)}
                                                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                                                >
                                                    Detalles
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={9} className="py-8 text-center text-slate-400">
                                        {t("noAccountsFound")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                        <span>{t("pageSize")}</span>
                        {[15, 30, 45, 60].map((size) => (
                            <button
                                key={size}
                                onClick={() => {
                                    setPageSize(size as any);
                                    setCurrentPage(1);
                                }}
                                className={`px-2 py-1 rounded-md border ${
                                    pageSize === size
                                        ? "bg-[#0054A6] text-white border-[#0054A6]"
                                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                                }`}
                            >
                                {size}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2">
                        <span>
                            {t("showingResults", {
                                start: filteredAccounts.length > 0 ? (currentPage - 1) * pageSize + 1 : 0,
                                end: Math.min(currentPage * pageSize, filteredAccounts.length),
                                total: filteredAccounts.length,
                            })}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40"
                            >
                                Anterior
                            </button>
                            <button
                                disabled={currentPage >= totalPages}
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal: Lifecycle Policy JSON & CLI Commands (Strict Layer z-[100]) */}
            {activeRemediation && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#0054A6]">
                                    <IconFileCode className="w-5 h-5" stroke={1.5} />
                                </span>
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {activeRemediation.title}
                                    </h3>
                                    <p className="text-xs text-slate-400">{activeRemediation.accountName}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setActiveRemediation(null)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <p className="text-xs text-slate-600 dark:text-slate-300">{activeRemediation.description}</p>

                            {/* Script / Policy Tabs */}
                            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                                {activeRemediation.commandPayload.jsonPolicy && (
                                    <button
                                        onClick={() => setActiveScriptTab("json")}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                                            activeScriptTab === "json"
                                                ? "bg-[#0054A6] text-white"
                                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                        }`}
                                    >
                                        Política JSON
                                    </button>
                                )}
                                <button
                                    onClick={() => setActiveScriptTab("cli")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                                        activeScriptTab === "cli"
                                            ? "bg-[#0054A6] text-white"
                                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                    }`}
                                >
                                    Azure CLI
                                </button>
                                <button
                                    onClick={() => setActiveScriptTab("ps")}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                                        activeScriptTab === "ps"
                                            ? "bg-[#0054A6] text-white"
                                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                    }`}
                                >
                                    PowerShell
                                </button>
                            </div>

                            {/* Code Container */}
                            <div className="relative rounded-xl bg-slate-950 p-4 text-slate-200 text-xs font-mono overflow-x-auto max-h-72">
                                <button
                                    onClick={() =>
                                        copyToClipboard(
                                            activeScriptTab === "json" && activeRemediation.commandPayload.jsonPolicy
                                                ? JSON.stringify(activeRemediation.commandPayload.jsonPolicy, null, 2)
                                                : activeScriptTab === "cli"
                                                ? activeRemediation.commandPayload.azureCli
                                                : activeRemediation.commandPayload.powerShell
                                        )
                                    }
                                    className="absolute right-3 top-3 px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 border border-slate-700"
                                >
                                    {copied ? <IconCheck className="w-3 h-3 text-emerald-400" /> : <IconCopy className="w-3 h-3" />}
                                    <span>{copied ? "Copiado" : "Copiar"}</span>
                                </button>
                                <pre className="whitespace-pre-wrap">
                                    {activeScriptTab === "json" && activeRemediation.commandPayload.jsonPolicy
                                        ? JSON.stringify(activeRemediation.commandPayload.jsonPolicy, null, 2)
                                        : activeScriptTab === "cli"
                                        ? activeRemediation.commandPayload.azureCli
                                        : activeRemediation.commandPayload.powerShell}
                                </pre>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                Ahorro estimado: +{format(activeRemediation.estimatedSavingsUSD)}/mes
                            </span>
                            <button
                                onClick={() => setActiveRemediation(null)}
                                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Account Architectural Detail & Telemetry Drawer (Strict Layer z-[100]) */}
            {selectedAccount && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-2">
                                <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#0054A6]">
                                    <IconDatabase className="w-5 h-5" stroke={1.5} />
                                </span>
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {selectedAccount.name}
                                    </h3>
                                    <p className="text-xs text-slate-400">Detalle Arquitectónico y Telemetría de Lago HNS</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedAccount(null)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6 overflow-y-auto">
                            {/* Architecture & Security Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <span className="text-slate-400">SKU & Redundancia</span>
                                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{selectedAccount.skuName} ({selectedAccount.redundancyType})</p>
                                </div>
                                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <span className="text-slate-400">Jerarquía HNS</span>
                                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">Habilitada (Data Lake Gen2)</p>
                                </div>
                                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <span className="text-slate-400">Private Endpoints</span>
                                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{selectedAccount.privateEndpointsCount} configurados</p>
                                </div>
                                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <span className="text-slate-400">Acceso Público</span>
                                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{selectedAccount.publicAccessBlocked ? "Bloqueado (Seguro)" : "Habilitado"}</p>
                                </div>
                                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <span className="text-slate-400">Costo Almacenamiento</span>
                                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{format(selectedAccount.metrics.storageCostUSD)}/mes</p>
                                </div>
                                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    <span className="text-slate-400">Costo Transacciones</span>
                                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{format(selectedAccount.metrics.transactionsCostUSD)}/mes</p>
                                </div>
                            </div>

                            {/* Storage Temperature Detail */}
                            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                                <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">Desglose de Capacidad ({selectedAccount.storageBreakdown.totalStorageTB} TB)</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div className="p-2 bg-blue-50/50 dark:bg-blue-950/30 rounded-lg">
                                        <span className="text-[11px] text-[#0078D4] font-semibold">Hot Tier</span>
                                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{(selectedAccount.storageBreakdown.hotTierGB / 1024).toFixed(2)} TB</p>
                                    </div>
                                    <div className="p-2 bg-blue-50/50 dark:bg-blue-950/30 rounded-lg">
                                        <span className="text-[11px] text-[#2563EB] font-semibold">Cool Tier</span>
                                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{(selectedAccount.storageBreakdown.coolTierGB / 1024).toFixed(2)} TB</p>
                                    </div>
                                    <div className="p-2 bg-sky-50/50 dark:bg-sky-950/30 rounded-lg">
                                        <span className="text-[11px] text-[#38BDF8] font-semibold">Cold Tier</span>
                                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{(selectedAccount.storageBreakdown.coldTierGB / 1024).toFixed(2)} TB</p>
                                    </div>
                                    <div className="p-2 bg-slate-50 dark:bg-slate-800/40 rounded-lg">
                                        <span className="text-[11px] text-[#BAE6FD] font-semibold">Archive Tier</span>
                                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{(selectedAccount.storageBreakdown.archiveTierGB / 1024).toFixed(2)} TB</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
                            <button
                                onClick={() => setSelectedAccount(null)}
                                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

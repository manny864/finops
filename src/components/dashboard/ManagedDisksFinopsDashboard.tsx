"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import {
    IconDisc,
    IconRefresh,
    IconSearch,
    IconFilter,
    IconTrendingUp,
    IconTrendingDown,
    IconAlertTriangle,
    IconShieldCheck,
    IconServer,
    IconTerminal2,
    IconCopy,
    IconCheck,
    IconX,
    IconExternalLink,
    IconInfoCircle,
    IconChevronLeft,
    IconChevronRight,
    IconAdjustmentsHorizontal,
    IconActivity,
    IconLock,
    IconTrash,
    IconArrowDownRight,
    IconSparkles,
} from "@tabler/icons-react";
import {
    ManagedDiskDetail,
    ManagedDisksResponse,
    DiskRemediationAction,
} from "@/types/managedDisk.types";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";

type SortField = "cost" | "size" | "name" | "iops" | "savings";
type SortDirection = "asc" | "desc";

export default function ManagedDisksFinopsDashboard() {
    const t = useTranslations("ManagedDisks");
    const { selectedTenant } = useTenant();
    const { format } = useCurrency();
    const { instance, accounts } = useMsal();

    // Filters & Pagination state
    const [searchTerm, setSearchTerm] = useState("");
    const [regionFilter, setRegionFilter] = useState("all");
    const [skuFilter, setSkuFilter] = useState("all");
    const [stateFilter, setStateFilter] = useState<"all" | "Attached" | "Unattached">("all");
    const [rgFilter, setRgFilter] = useState("all");
    const [sortField, setSortField] = useState<SortField>("cost");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Modals state
    const [selectedActionForModal, setSelectedActionForModal] = useState<DiskRemediationAction | null>(null);
    const [selectedDiskForDetail, setSelectedDiskForDetail] = useState<ManagedDiskDetail | null>(null);
    const [activeScriptTab, setActiveScriptTab] = useState<"cli" | "ps">("cli");
    const [copiedText, setCopiedText] = useState(false);

    const fetcher = async (url: string) => {
        let token: string | null = null;
        if (accounts[0]) {
            token = await getFreshIdToken(instance, accounts[0], ["User.Read"]).catch(() => null);
        }
        const res = await fetch(url, {
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                "x-tenant-id": selectedTenant?.id || "",
            },
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    };

    const swrKey = selectedTenant?.id
        ? `/api/intelligence/storage/managed-disks?tenantId=${selectedTenant.id}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<ManagedDisksResponse>(swrKey, fetcher, {
        revalidateOnMount: true,
        revalidateOnFocus: false,
        dedupingInterval: 10000,
    });

    const disks = data?.disks || [];
    const kpis = data?.kpis;
    const remediations = data?.remediations || [];
    const skuDistribution = data?.skuDistribution || [];

    // Filter Options
    const regionOptions = useMemo(() => ["all", ...Array.from(new Set(disks.map((d) => d.location))).sort()], [disks]);
    const skuOptions = useMemo(() => ["all", ...Array.from(new Set(disks.map((d) => d.skuName))).sort()], [disks]);
    const rgOptions = useMemo(() => ["all", ...Array.from(new Set(disks.map((d) => d.resourceGroup))).sort()], [disks]);

    // Filtered & Sorted Disks
    const filteredDisks = useMemo(() => {
        return disks
            .filter((d) => {
                if (stateFilter !== "all" && d.diskState !== stateFilter) return false;
                if (regionFilter !== "all" && d.location !== regionFilter) return false;
                if (skuFilter !== "all" && d.skuName !== skuFilter) return false;
                if (rgFilter !== "all" && d.resourceGroup !== rgFilter) return false;
                if (searchTerm.trim()) {
                    const q = searchTerm.toLowerCase();
                    const nameOk = d.name.toLowerCase().includes(q);
                    const vmOk = (d.managedByVmName || "").toLowerCase().includes(q);
                    const rgOk = d.resourceGroup.toLowerCase().includes(q);
                    if (!nameOk && !vmOk && !rgOk) return false;
                }
                return true;
            })
            .sort((a, b) => {
                let valA: any = a.monthlyCostUsd;
                let valB: any = b.monthlyCostUsd;
                if (sortField === "name") {
                    valA = a.name;
                    valB = b.name;
                } else if (sortField === "size") {
                    valA = a.diskSizeGB;
                    valB = b.diskSizeGB;
                } else if (sortField === "iops") {
                    valA = a.metrics.avgIops;
                    valB = b.metrics.avgIops;
                } else if (sortField === "savings") {
                    valA = a.recommendations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0);
                    valB = b.recommendations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0);
                }

                if (typeof valA === "string") {
                    return sortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                return sortDirection === "asc" ? valA - valB : valB - valA;
            });
    }, [disks, stateFilter, regionFilter, skuFilter, rgFilter, searchTerm, sortField, sortDirection]);

    // Paginated items
    const totalPages = Math.max(1, Math.ceil(filteredDisks.length / pageSize));
    const paginatedDisks = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredDisks.slice(start, start + pageSize);
    }, [filteredDisks, currentPage, pageSize]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortField(field);
            setSortDirection("desc");
        }
    };

    const handleCopyScript = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
    };

    return (
        <div className="space-y-6">
            {/* Top Toolbar: Refresh & Quick Stats */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                        <IconDisc className="w-6 h-6 text-[#0054A6]" stroke={1.5} />
                        {t("cockpitTitle")}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {t("cockpitSubtitle")}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => mutate()}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-xs"
                    >
                        <IconRefresh className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} stroke={1.5} />
                        {t("refreshButton")}
                    </button>
                </div>
            </div>

            {/* 8 KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {/* 1. Costo MTD */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiMtdCost")}
                            <InfoTooltip content={t("tooltipMtdCost")} />
                        </span>
                        <IconDisc className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {format(kpis?.totalMtdCost ?? 0)}
                    </p>
                    <span className="text-[11px] text-slate-400">
                        {kpis?.totalProvisionedGB ?? 0} GiB provisionados
                    </span>
                </div>

                {/* 2. Forecast Fin de Mes */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiForecastEom")}
                            <InfoTooltip content={t("tooltipForecastEom")} />
                        </span>
                        <IconTrendingUp className="w-4 h-4 text-blue-600" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {format(kpis?.projectedEndOfMonthCost ?? 0)}
                    </p>
                    <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                        Cierre proyectado mes
                    </span>
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
                        {remediations.length} acciones optimizables
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
                            +{kpis?.momVariationPercent ?? 0}%
                        </p>
                    </div>
                    <span className="text-[11px] text-slate-400">vs. mes anterior</span>
                </div>

                {/* 5. Recursos Evaluados */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiTotalDisks")}
                            <InfoTooltip content={t("tooltipTotalDisks")} />
                        </span>
                        <IconServer className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {kpis?.totalDisksCount ?? 0}
                    </p>
                    <span className="text-[11px] text-slate-400">Discos administrados activos</span>
                </div>

                {/* 6. Discos Huérfanos / Desconectados */}
                <div className={`p-4 rounded-xl bg-white dark:bg-slate-900 border shadow-xs ${
                    (kpis?.orphanDisksCount ?? 0) > 0 ? "border-amber-400 dark:border-amber-600" : "border-slate-200 dark:border-slate-800"
                }`}>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiOrphanDisks")}
                            <InfoTooltip content={t("tooltipOrphanDisks")} />
                        </span>
                        <IconAlertTriangle className={`w-4 h-4 ${(kpis?.orphanDisksCount ?? 0) > 0 ? "text-amber-500" : "text-slate-400"}`} stroke={1.5} />
                    </div>
                    <div className="flex items-baseline gap-2">
                        <p className={`text-2xl font-bold font-['Montserrat'] ${
                            (kpis?.orphanDisksCount ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100"
                        }`}>
                            {kpis?.orphanDisksCount ?? 0}
                        </p>
                        {(kpis?.orphanDisksCount ?? 0) > 0 && (
                            <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                {format(kpis?.orphanDisksCost ?? 0)}/m ocioso
                            </span>
                        )}
                    </div>
                    <span className="text-[11px] text-slate-400">Estado Unattached</span>
                </div>

                {/* 7. Baja Utilización (<10 IOPS) */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiUnderutilized")}
                            <InfoTooltip content={t("tooltipUnderutilized")} />
                        </span>
                        <IconActivity className="w-4 h-4 text-blue-500" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {kpis?.underutilizedDisksCount ?? 0}
                    </p>
                    <span className="text-[11px] text-slate-400">
                        {format(kpis?.underutilizedDisksCost ?? 0)}/m optimizable
                    </span>
                </div>

                {/* 8. Salud Operativa */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiHealthScore")}
                            <InfoTooltip content={t("tooltipHealthScore")} />
                        </span>
                        <IconShieldCheck className="w-4 h-4 text-emerald-500" stroke={1.5} />
                    </div>
                    <div className="flex items-baseline gap-1">
                        <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                            {kpis?.healthScore ?? 100}
                        </p>
                        <span className="text-xs text-slate-400">/100</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                        <div
                            className="bg-[#0054A6] h-full rounded-full transition-all"
                            style={{ width: `${kpis?.healthScore ?? 100}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* SKU & Redundancy Breakdown in Corporate Blue Scale */}
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 uppercase tracking-wider font-['Montserrat'] flex items-center gap-1.5">
                        <IconDisc className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("skuDistributionTitle")}
                        <InfoTooltip content={t("tooltipSkuDistribution")} />
                    </h3>
                    <span className="text-xs text-slate-500">
                        Total {kpis?.totalProvisionedGB ?? 0} GiB provisionados
                    </span>
                </div>

                {/* Stacked Bar */}
                <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-lg flex overflow-hidden">
                    {skuDistribution.map((item) => {
                        const totalGb = kpis?.totalProvisionedGB || 1;
                        const pct = (item.totalSizeGB / totalGb) * 100;
                        if (pct <= 0) return null;
                        return (
                            <div
                                key={item.skuName}
                                className="h-full transition-all hover:opacity-85"
                                style={{ width: `${pct}%`, backgroundColor: item.color }}
                                title={`${item.skuName}: ${item.totalSizeGB} GiB (${pct.toFixed(1)}%) - ${format(item.monthlyCost)}`}
                            />
                        );
                    })}
                </div>

                {/* Micro Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    {skuDistribution.map((item) => (
                        <div
                            key={item.skuName}
                            className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between"
                        >
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
                                <div>
                                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                        {item.skuName}
                                    </p>
                                    <p className="text-[11px] text-slate-500">
                                        {item.count} discos ({item.totalSizeGB} GiB)
                                    </p>
                                </div>
                            </div>
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 font-mono">
                                {format(item.monthlyCost)}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Resolutive Remediation Cards */}
            {remediations.length > 0 && (
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <IconTerminal2 className="w-5 h-5 text-[#0054A6]" stroke={1.5} />
                            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                {t("remediationsHeader")} ({remediations.length})
                            </h3>
                        </div>
                        <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                            Ahorro Total: {format(kpis?.potentialMonthlySavings ?? 0)}/mes
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {remediations.slice(0, 3).map((rec) => (
                            <div
                                key={rec.id}
                                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs hover:border-[#0054A6]/50 transition-all flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-50 text-[#0054A6] dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                            {rec.category}
                                        </span>
                                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                            +{format(rec.estimatedSavingsUSD)}/m
                                        </span>
                                    </div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-1 line-clamp-2">
                                        {rec.title}
                                    </h4>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-3 mb-3">
                                        {rec.description}
                                    </p>
                                </div>

                                <button
                                    onClick={() => setSelectedActionForModal(rec)}
                                    className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg hover:bg-blue-50/60 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <IconTerminal2 className="w-3.5 h-3.5" stroke={1.5} />
                                    {rec.category === "ORPHAN" ? "Crear Snapshot & Eliminar" : "Ver Comando CLI"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Master Resource Table Section */}
            <div className="space-y-4">
                {/* Search and Filters Bar */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                        <div className="relative w-full max-w-sm">
                            <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" stroke={1.5} />
                            <input
                                type="text"
                                placeholder={t("searchPlaceholder")}
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-xs">
                        {/* Estado Filter */}
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-medium">{t("filterState")}:</span>
                            <select
                                value={stateFilter}
                                onChange={(e) => {
                                    setStateFilter(e.target.value as any);
                                    setCurrentPage(1);
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
                            >
                                <option value="all">{t("filterAll")}</option>
                                <option value="Attached">Attached (En Uso)</option>
                                <option value="Unattached">Unattached (Huérfanos)</option>
                            </select>
                        </div>

                        {/* SKU Filter */}
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-medium">{t("filterSku")}:</span>
                            <select
                                value={skuFilter}
                                onChange={(e) => {
                                    setSkuFilter(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
                            >
                                <option value="all">{t("filterAll")}</option>
                                {skuOptions.filter((s) => s !== "all").map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>

                        {/* Region Filter */}
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-medium">{t("filterRegion")}:</span>
                            <select
                                value={regionFilter}
                                onChange={(e) => {
                                    setRegionFilter(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
                            >
                                <option value="all">{t("filterAll")}</option>
                                {regionOptions.filter((r) => r !== "all").map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>

                        {/* Sort Order */}
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-medium">{t("sortBy")}:</span>
                            <select
                                value={`${sortField}-${sortDirection}`}
                                onChange={(e) => {
                                    const [f, d] = e.target.value.split("-") as [SortField, SortDirection];
                                    setSortField(f);
                                    setSortDirection(d);
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
                            >
                                <option value="cost-desc">{t("sortCostDesc")}</option>
                                <option value="cost-asc">{t("sortCostAsc")}</option>
                                <option value="size-desc">{t("sortSizeDesc")}</option>
                                <option value="iops-desc">{t("sortIopsDesc")}</option>
                                <option value="name-asc">{t("sortNameAsc")}</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Main Table */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50/80 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800 select-none">
                                <tr>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("name")}>
                                            <span>{t("colDisk")}</span>
                                            <InfoTooltip content={t("tooltipColDisk")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1">
                                            <span>{t("colState")}</span>
                                            <InfoTooltip content={t("tooltipColState")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1">
                                            <span>{t("colVm")}</span>
                                            <InfoTooltip content={t("tooltipColVm")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <span>{t("colSkuTier")}</span>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("size")}>
                                            <span>{t("colSize")}</span>
                                            <InfoTooltip content={t("tooltipColSize")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("iops")}>
                                            <span>{t("colIops")}</span>
                                            <InfoTooltip content={t("tooltipColIops")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1 justify-end cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("cost")}>
                                            <span>{t("colCost")}</span>
                                            <InfoTooltip content={t("tooltipColCost")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1 justify-end cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("savings")}>
                                            <span>{t("colSavings")}</span>
                                            <InfoTooltip content={t("tooltipColSavings")} />
                                        </div>
                                    </ResizableTh>
                                    <th className="py-3 px-4 text-center">{t("colActions")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {paginatedDisks.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="py-12 text-center text-slate-400">
                                            {t("noDisksFound")}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedDisks.map((disk) => {
                                        const savings = disk.recommendations.reduce((s, r) => s + r.estimatedSavingsUSD, 0);
                                        const isOrphan = disk.diskState === "Unattached";

                                        return (
                                            <tr
                                                key={disk.id}
                                                className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                                                    isOrphan ? "bg-amber-50/20 dark:bg-amber-950/10" : ""
                                                }`}
                                            >
                                                {/* Disk Name & Metadata */}
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2">
                                                        <IconDisc className="w-4 h-4 text-[#0054A6] shrink-0" stroke={1.5} />
                                                        <div>
                                                            <button
                                                                onClick={() => setSelectedDiskForDetail(disk)}
                                                                className="font-bold text-slate-900 dark:text-slate-100 hover:text-[#0054A6] transition-colors text-left"
                                                            >
                                                                {disk.name}
                                                            </button>
                                                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                                                                <span className="font-mono">{disk.location}</span>
                                                                <span>•</span>
                                                                <span>{disk.resourceGroup}</span>
                                                                <span>•</span>
                                                                <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-[10px]">
                                                                    {disk.diskType === "OSDisk" ? "OS Disk" : "Data"}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* State Badge */}
                                                <td className="py-3 px-4">
                                                    {isOrphan ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                                            <IconAlertTriangle className="w-3 h-3" stroke={2} />
                                                            Unattached
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                            Attached
                                                        </span>
                                                    )}
                                                </td>

                                                {/* Attached VM */}
                                                <td className="py-3 px-4">
                                                    {disk.managedByVmName ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <IconServer className="w-3.5 h-3.5 text-slate-400" stroke={1.5} />
                                                            <span className="font-medium text-slate-800 dark:text-slate-200">
                                                                {disk.managedByVmName}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-400 italic text-[11px]">- Desvinculado -</span>
                                                    )}
                                                </td>

                                                {/* SKU & Tier */}
                                                <td className="py-3 px-4">
                                                    <div>
                                                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                                                            {disk.tierName}
                                                        </span>
                                                        <p className="text-[10px] text-slate-400 font-mono">
                                                            {disk.skuName} ({disk.redundancyType})
                                                        </p>
                                                    </div>
                                                </td>

                                                {/* Size */}
                                                <td className="py-3 px-4 font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                    {disk.diskSizeGB} GiB
                                                </td>

                                                {/* IOPS Performance */}
                                                <td className="py-3 px-4">
                                                    <div className="font-mono text-[11px]">
                                                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                                                            {disk.metrics.avgIops} IOPS
                                                        </span>
                                                        <p className="text-[10px] text-slate-400">
                                                            Pico: {disk.metrics.peakIops}
                                                        </p>
                                                    </div>
                                                </td>

                                                {/* Monthly Cost */}
                                                <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                                                    {format(disk.monthlyCostUsd)}
                                                </td>

                                                {/* Potential Savings */}
                                                <td className="py-3 px-4 text-right font-mono">
                                                    {savings > 0 ? (
                                                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                                            +{format(savings)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">-</span>
                                                    )}
                                                </td>

                                                {/* Actions */}
                                                <td className="py-3 px-4 text-center">
                                                    <div className="flex items-center justify-center gap-1.5">
                                                        <button
                                                            onClick={() => setSelectedDiskForDetail(disk)}
                                                            className="p-1.5 text-[#0054A6] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                                            title="Ver Detalle Arquitectónico"
                                                        >
                                                            <IconInfoCircle className="w-4 h-4" stroke={1.5} />
                                                        </button>
                                                        {disk.recommendations.length > 0 && (
                                                            <button
                                                                onClick={() => setSelectedActionForModal(disk.recommendations[0])}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-md hover:bg-blue-50/60 dark:hover:bg-slate-800 transition-colors"
                                                                title="Optimizar Disco"
                                                            >
                                                                <IconSparkles className="w-3.5 h-3.5 text-[#0054A6]" stroke={1.5} />
                                                                <span>Optimizar</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Footer */}
                    <div className="px-4 py-3 bg-slate-50/60 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                        <div className="flex items-center gap-2">
                            <span>{t("pageSize")}:</span>
                            {[15, 30, 45, 60].map((size) => (
                                <button
                                    key={size}
                                    onClick={() => {
                                        setPageSize(size);
                                        setCurrentPage(1);
                                    }}
                                    className={`px-2 py-0.5 rounded border transition-colors ${
                                        pageSize === size
                                            ? "bg-[#0054A6] text-white border-[#0054A6] font-bold"
                                            : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                                    }`}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2">
                            <span>
                                {t("showingResults", {
                                    start: Math.min(filteredDisks.length, (currentPage - 1) * pageSize + 1),
                                    end: Math.min(filteredDisks.length, currentPage * pageSize),
                                    total: filteredDisks.length,
                                })}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40"
                                >
                                    <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                                </button>
                                <span className="font-semibold px-2">
                                    {currentPage} / {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={currentPage >= totalPages}
                                    className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40"
                                >
                                    <IconChevronRight className="w-4 h-4" stroke={1.5} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal 1: Interactive Remediation Modal (Z-Index z-[100]) */}
            {selectedActionForModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#0054A6]">
                                    <IconTerminal2 className="w-5 h-5" stroke={1.5} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {selectedActionForModal.title}
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        Disco: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{selectedActionForModal.diskName}</span>
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedActionForModal(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <IconX className="w-5 h-5" stroke={1.5} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
                            <div className="p-3.5 rounded-xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 text-slate-700 dark:text-slate-300">
                                <p className="font-medium">{selectedActionForModal.description}</p>
                                <p className="mt-2 text-emerald-700 dark:text-emerald-400 font-bold">
                                    Impacto: {selectedActionForModal.impact}
                                </p>
                            </div>

                            {/* Script Tabs */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setActiveScriptTab("cli")}
                                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                                                activeScriptTab === "cli"
                                                    ? "bg-[#0054A6] text-white shadow-xs"
                                                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                            }`}
                                        >
                                            Azure CLI (Bash)
                                        </button>
                                        <button
                                            onClick={() => setActiveScriptTab("ps")}
                                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                                                activeScriptTab === "ps"
                                                    ? "bg-[#0054A6] text-white shadow-xs"
                                                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                            }`}
                                        >
                                            PowerShell
                                        </button>
                                    </div>

                                    <button
                                        onClick={() =>
                                            handleCopyScript(
                                                activeScriptTab === "cli"
                                                    ? selectedActionForModal.commandPayload.azureCli
                                                    : selectedActionForModal.commandPayload.powerShell
                                            )
                                        }
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#0054A6] bg-white dark:bg-slate-800 border border-[#0054A6] rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700"
                                    >
                                        {copiedText ? (
                                            <>
                                                <IconCheck className="w-3.5 h-3.5 text-emerald-500" stroke={2} />
                                                Copiado
                                            </>
                                        ) : (
                                            <>
                                                <IconCopy className="w-3.5 h-3.5" stroke={1.5} />
                                                Copiar Script
                                            </>
                                        )}
                                    </button>
                                </div>

                                <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto border border-slate-800 leading-relaxed">
                                    <code>
                                        {activeScriptTab === "cli"
                                            ? selectedActionForModal.commandPayload.azureCli
                                            : selectedActionForModal.commandPayload.powerShell}
                                    </code>
                                </pre>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
                            <button
                                onClick={() => setSelectedActionForModal(null)}
                                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal 2: Architectural Details Drawer/Modal (Z-Index z-[100]) */}
            {selectedDiskForDetail && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#0054A6]">
                                    <IconDisc className="w-5 h-5" stroke={1.5} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {selectedDiskForDetail.name}
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        Detalle de Arquitectura & Telemetría Azure Monitor
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedDiskForDetail(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <IconX className="w-5 h-5" stroke={1.5} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                    <span className="text-slate-400 font-medium">SKU / Tier</span>
                                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                                        {selectedDiskForDetail.skuName} ({selectedDiskForDetail.tierName})
                                    </p>
                                </div>
                                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                    <span className="text-slate-400 font-medium">Tamaño Provisionado</span>
                                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                                        {selectedDiskForDetail.diskSizeGB} GiB
                                    </p>
                                </div>
                                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                    <span className="text-slate-400 font-medium">Estado de Vinculación</span>
                                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                                        {selectedDiskForDetail.diskState}
                                    </p>
                                </div>
                                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                    <span className="text-slate-400 font-medium">Máquina Virtual Asociada</span>
                                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                                        {selectedDiskForDetail.managedByVmName || "Ninguna (Huérfano)"}
                                    </p>
                                </div>
                            </div>

                            {/* Performance Telemetry */}
                            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20 space-y-2">
                                <h4 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                    <IconActivity className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                                    Métricas de Actividad (Últimos 14 Días)
                                </h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center font-mono">
                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span className="text-[10px] text-slate-400 block font-sans">IOPS Promedio</span>
                                        <span className="font-bold text-slate-900 dark:text-slate-100">
                                            {selectedDiskForDetail.metrics.avgIops}
                                        </span>
                                    </div>
                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span className="text-[10px] text-slate-400 block font-sans">IOPS Pico</span>
                                        <span className="font-bold text-slate-900 dark:text-slate-100">
                                            {selectedDiskForDetail.metrics.peakIops}
                                        </span>
                                    </div>
                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span className="text-[10px] text-slate-400 block font-sans">Throughput Prom.</span>
                                        <span className="font-bold text-slate-900 dark:text-slate-100">
                                            {selectedDiskForDetail.metrics.avgThroughputMbps} MB/s
                                        </span>
                                    </div>
                                    <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        <span className="text-[10px] text-slate-400 block font-sans">Throughput Pico</span>
                                        <span className="font-bold text-slate-900 dark:text-slate-100">
                                            {selectedDiskForDetail.metrics.peakThroughputMbps} MB/s
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Resource ID and Encryption */}
                            <div className="space-y-1.5">
                                <span className="text-slate-400 font-medium">Resource ID Azure</span>
                                <p className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] break-all select-all">
                                    {selectedDiskForDetail.id}
                                </p>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
                            <button
                                onClick={() => setSelectedDiskForDetail(null)}
                                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
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

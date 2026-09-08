"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import {
    IconShieldCheck,
    IconRefresh,
    IconSearch,
    IconTrendingUp,
    IconAlertTriangle,
    IconServer,
    IconTerminal2,
    IconCopy,
    IconCheck,
    IconX,
    IconInfoCircle,
    IconChevronLeft,
    IconChevronRight,
    IconArrowDownRight,
    IconLayersLinked,
    IconFileCheck,
    IconSparkles,
} from "@tabler/icons-react";
import {
    BackupVaultDetail,
    BackupsResponse,
    BackupRemediationAction,
} from "@/types/backup.types";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";

type SortField = "cost" | "storage" | "name" | "items" | "savings";
type SortDirection = "asc" | "desc";

export default function BackupsFinopsDashboard() {
    const t = useTranslations("BackupsFinops");
    const { selectedTenant } = useTenant();
    const { format } = useCurrency();
    const { instance, accounts } = useMsal();

    // Filters & Pagination state
    const [searchTerm, setSearchTerm] = useState("");
    const [regionFilter, setRegionFilter] = useState("all");
    const [vaultTypeFilter, setVaultTypeFilter] = useState<"all" | "RecoveryServicesVault" | "BackupVault">("all");
    const [redundancyFilter, setRedundancyFilter] = useState("all");
    const [rgFilter, setRgFilter] = useState("all");
    const [sortField, setSortField] = useState<SortField>("cost");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Modals state
    const [selectedActionForModal, setSelectedActionForModal] = useState<BackupRemediationAction | null>(null);
    const [selectedVaultForDetail, setSelectedVaultForDetail] = useState<BackupVaultDetail | null>(null);
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
        ? `/api/intelligence/storage/backups?tenantId=${selectedTenant.id}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<BackupsResponse>(swrKey, fetcher, {
        revalidateOnMount: true,
        revalidateOnFocus: false,
        dedupingInterval: 10000,
    });

    const vaults = data?.vaults || [];
    const kpis = data?.kpis;
    const remediations = data?.remediations || [];
    const storageBreakdown = data?.storageBreakdown || {
        totalStorageGB: 0,
        snapshotTierGB: 0,
        vaultStandardGB: 0,
        vaultArchiveGB: 0,
        orphanedStorageGB: 0,
    };

    // Filter Options
    const regionOptions = useMemo(() => ["all", ...Array.from(new Set(vaults.map((v) => v.location))).sort()], [vaults]);
    const redundancyOptions = useMemo(() => ["all", ...Array.from(new Set(vaults.map((v) => v.redundancy))).sort()], [vaults]);
    const rgOptions = useMemo(() => ["all", ...Array.from(new Set(vaults.map((v) => v.resourceGroup))).sort()], [vaults]);

    // Filtered & Sorted Vaults
    const filteredVaults = useMemo(() => {
        return vaults
            .filter((v) => {
                if (vaultTypeFilter !== "all" && v.vaultType !== vaultTypeFilter) return false;
                if (redundancyFilter !== "all" && v.redundancy !== redundancyFilter) return false;
                if (regionFilter !== "all" && v.location !== regionFilter) return false;
                if (rgFilter !== "all" && v.resourceGroup !== rgFilter) return false;
                if (searchTerm.trim()) {
                    const q = searchTerm.toLowerCase();
                    const nameOk = v.name.toLowerCase().includes(q);
                    const subOk = v.subscriptionName.toLowerCase().includes(q);
                    const rgOk = v.resourceGroup.toLowerCase().includes(q);
                    if (!nameOk && !subOk && !rgOk) return false;
                }
                return true;
            })
            .sort((a, b) => {
                let valA: any = a.monthlyCostUsd;
                let valB: any = b.monthlyCostUsd;
                if (sortField === "name") {
                    valA = a.name;
                    valB = b.name;
                } else if (sortField === "storage") {
                    valA = a.storageBreakdown.totalStorageGB;
                    valB = b.storageBreakdown.totalStorageGB;
                } else if (sortField === "items") {
                    valA = a.protectedItemsCount;
                    valB = b.protectedItemsCount;
                } else if (sortField === "savings") {
                    valA = a.recommendations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0);
                    valB = b.recommendations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0);
                }

                if (typeof valA === "string") {
                    return sortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                return sortDirection === "asc" ? valA - valB : valB - valA;
            });
    }, [vaults, vaultTypeFilter, redundancyFilter, regionFilter, rgFilter, searchTerm, sortField, sortDirection]);

    // Paginated items
    const totalPages = Math.max(1, Math.ceil(filteredVaults.length / pageSize));
    const paginatedVaults = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredVaults.slice(start, start + pageSize);
    }, [filteredVaults, currentPage, pageSize]);

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
            {/* Top Toolbar: Refresh & Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                        <IconShieldCheck className="w-6 h-6 text-[#0054A6]" stroke={1.5} />
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
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-xs"
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
                        <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {format(kpis?.totalMtdCost ?? 0)}
                    </p>
                    <span className="text-[11px] text-slate-400">
                        {kpis?.totalStorageGB ?? 0} GiB en almacenamiento
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
                            {(kpis?.momVariationPercent ?? 0) > 0 ? `+${kpis?.momVariationPercent}%` : `${kpis?.momVariationPercent ?? 0}%`}
                        </p>
                    </div>
                    <span className="text-[11px] text-slate-400">vs. mes anterior</span>
                </div>

                {/* 5. Bóvedas Evaluadas */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiTotalVaults")}
                            <InfoTooltip content={t("tooltipTotalVaults")} />
                        </span>
                        <IconServer className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {kpis?.totalVaultsCount ?? 0}
                    </p>
                    <span className="text-[11px] text-slate-400">{t("kpiVaults")}</span>
                </div>

                {/* 6. Ítems Protegidos Totales */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiProtectedItems")}
                            <InfoTooltip content={t("tooltipProtectedItems")} />
                        </span>
                        <IconFileCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {kpis?.totalProtectedItemsCount ?? 0}
                    </p>
                    <span className="text-[11px] text-slate-400">
                        {kpis?.asrInstancesCount ?? 0} réplicas ASR activas
                    </span>
                </div>

                {/* 7. Backups Huérfanos / Riesgos */}
                <div className={`p-4 rounded-xl bg-white dark:bg-slate-900 border shadow-xs ${
                    (kpis?.orphanedItemsCount ?? 0) > 0 ? "border-amber-400 dark:border-amber-600" : "border-slate-200 dark:border-slate-800"
                }`}>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            {t("kpiOrphanBackups")}
                            <InfoTooltip content={t("tooltipOrphanBackups")} />
                        </span>
                        <IconAlertTriangle className={`w-4 h-4 ${(kpis?.orphanedItemsCount ?? 0) > 0 ? "text-amber-500" : "text-slate-400"}`} stroke={1.5} />
                    </div>
                    <div className="flex items-baseline gap-2">
                        <p className={`text-2xl font-bold font-['Montserrat'] ${
                            (kpis?.orphanedItemsCount ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100"
                        }`}>
                            {kpis?.orphanedItemsCount ?? 0}
                        </p>
                        {(kpis?.orphanedItemsCount ?? 0) > 0 && (
                            <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                {format(kpis?.orphanedStorageCost ?? 0)}/m ocioso
                            </span>
                        )}
                    </div>
                    <span className="text-[11px] text-slate-400">ProtectionStopped</span>
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

            {/* Storage Tier Breakdown in Corporate Blue Scale */}
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 uppercase tracking-wider font-['Montserrat'] flex items-center gap-1.5">
                        <IconLayersLinked className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("storageBreakdownTitle")}
                        <InfoTooltip content={t("tooltipStorageBreakdown")} />
                    </h3>
                    <span className="text-xs text-slate-500">
                        Total {storageBreakdown.totalStorageGB} GiB almacenados
                    </span>
                </div>

                {/* Stacked Progress Bar */}
                <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-lg flex overflow-hidden">
                    {storageBreakdown.totalStorageGB > 0 ? (
                        <>
                            {/* 1. Snapshot / Instant Restore (#0078D4) */}
                            <div
                                style={{ width: `${(storageBreakdown.snapshotTierGB / storageBreakdown.totalStorageGB) * 100}%` }}
                                className="bg-[#0078D4] h-full transition-all hover:opacity-85"
                                title={`Snapshot Tier: ${storageBreakdown.snapshotTierGB} GiB`}
                            />
                            {/* 2. Vault-Standard Warm (#2563EB) */}
                            <div
                                style={{ width: `${(storageBreakdown.vaultStandardGB / storageBreakdown.totalStorageGB) * 100}%` }}
                                className="bg-[#2563EB] h-full transition-all hover:opacity-85"
                                title={`Vault-Standard: ${storageBreakdown.vaultStandardGB} GiB`}
                            />
                            {/* 3. Vault-Archive Cold (#93C5FD) */}
                            <div
                                style={{ width: `${(storageBreakdown.vaultArchiveGB / storageBreakdown.totalStorageGB) * 100}%` }}
                                className="bg-[#93C5FD] h-full transition-all hover:opacity-85"
                                title={`Vault-Archive: ${storageBreakdown.vaultArchiveGB} GiB`}
                            />
                            {/* 4. Orphaned Storage (#94A3B8) */}
                            <div
                                style={{ width: `${(storageBreakdown.orphanedStorageGB / storageBreakdown.totalStorageGB) * 100}%` }}
                                className="bg-[#94A3B8] h-full transition-all hover:opacity-85"
                                title={`Huérfano: ${storageBreakdown.orphanedStorageGB} GiB`}
                            />
                        </>
                    ) : (
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-full" />
                    )}
                </div>

                {/* Micro Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm bg-[#0078D4] shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Snapshot Tier</p>
                                <p className="text-[11px] text-slate-500">{storageBreakdown.snapshotTierGB} GiB</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm bg-[#2563EB] shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Vault-Standard</p>
                                <p className="text-[11px] text-slate-500">{storageBreakdown.vaultStandardGB} GiB</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm bg-[#93C5FD] shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Vault-Archive</p>
                                <p className="text-[11px] text-slate-500">{storageBreakdown.vaultArchiveGB} GiB</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm bg-[#94A3B8] shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{t("kpiOrphanStorage")}</p>
                                <p className="text-[11px] text-slate-500">{storageBreakdown.orphanedStorageGB} GiB</p>
                            </div>
                        </div>
                    </div>
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
                                    className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg hover:bg-blue-50/60 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <IconTerminal2 className="w-3.5 h-3.5" stroke={1.5} />
                                    {rec.category === "ORPHAN_PURGE" ? "Purgar Huérfanos" : "Ver Comando CLI"}
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
                        {/* Tipo de Bóveda Filter */}
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-medium">{t("filterVaultType")}:</span>
                            <select
                                value={vaultTypeFilter}
                                onChange={(e) => {
                                    setVaultTypeFilter(e.target.value as any);
                                    setCurrentPage(1);
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
                            >
                                <option value="all">{t("filterAll")}</option>
                                <option value="RecoveryServicesVault">Recovery Services Vault</option>
                                <option value="BackupVault">Backup Vault</option>
                            </select>
                        </div>

                        {/* Redundancia Filter */}
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-medium">{t("filterRedundancy")}:</span>
                            <select
                                value={redundancyFilter}
                                onChange={(e) => {
                                    setRedundancyFilter(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
                            >
                                <option value="all">{t("filterAll")}</option>
                                {redundancyOptions.filter((r) => r !== "all").map((r) => (
                                    <option key={r} value={r}>{r}</option>
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
                                <option value="storage-desc">{t("sortStorageDesc")}</option>
                                <option value="items-desc">{t("sortItemsDesc")}</option>
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
                                            <span>{t("colVault")}</span>
                                            <InfoTooltip content={t("tooltipColVault")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1">
                                            <span>{t("colType")}</span>
                                            <InfoTooltip content={t("tooltipColType")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1">
                                            <span>{t("colRedundancy")}</span>
                                            <InfoTooltip content={t("tooltipColRedundancy")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("items")}>
                                            <span>{t("colProtectedItems")}</span>
                                            <InfoTooltip content={t("tooltipColProtectedItems")} />
                                        </div>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <span>{t("colAsr")}</span>
                                    </ResizableTh>
                                    <ResizableTh className="py-3 px-4">
                                        <div className="flex items-center gap-1 cursor-pointer hover:text-[#0054A6]" onClick={() => handleSort("storage")}>
                                            <span>{t("colStorage")}</span>
                                            <InfoTooltip content={t("tooltipColStorage")} />
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
                                {paginatedVaults.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="py-12 text-center text-slate-400">
                                            {t("noVaultsFound")}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedVaults.map((vault) => {
                                        const savings = vault.recommendations.reduce((s, r) => s + r.estimatedSavingsUSD, 0);

                                        return (
                                            <tr
                                                key={vault.id}
                                                className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                                            >
                                                {/* Vault Name & Metadata */}
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2">
                                                        <IconShieldCheck className="w-4 h-4 text-[#0054A6] shrink-0" stroke={1.5} />
                                                        <div>
                                                            <button
                                                                onClick={() => setSelectedVaultForDetail(vault)}
                                                                className="font-bold text-slate-900 dark:text-slate-100 hover:text-[#0054A6] transition-colors text-left"
                                                            >
                                                                {vault.name}
                                                            </button>
                                                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                                                                <span className="font-mono">{vault.location}</span>
                                                                <span>•</span>
                                                                <span>{vault.resourceGroup}</span>
                                                                <span>•</span>
                                                                <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold text-[10px]">
                                                                    SoftDelete: {vault.softDeleteEnabled ? "ON" : "OFF"}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Vault Type */}
                                                <td className="py-3 px-4">
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-[#0054A6] dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                        {vault.vaultType === "RecoveryServicesVault" ? "Recovery Services" : "Backup Vault"}
                                                    </span>
                                                </td>

                                                {/* Redundancy */}
                                                <td className="py-3 px-4">
                                                    <div>
                                                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                                                            {vault.redundancy}
                                                        </span>
                                                        {vault.crossRegionRestoreEnabled && (
                                                            <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                                                                + Cross-Region Restore
                                                            </p>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Protected Items */}
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                                                            {t("itemsCount", { n: vault.protectedItemsCount })}
                                                        </span>
                                                        {vault.orphanedItemsCount > 0 && (
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                                                <IconAlertTriangle className="w-3 h-3" stroke={2} />
                                                                {t("orphanedCount", { n: vault.orphanedItemsCount })}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* ASR Replicas */}
                                                <td className="py-3 px-4 font-mono font-medium text-slate-800 dark:text-slate-200">
                                                    {vault.asrProtectedItemsCount > 0 ? (
                                                        <span className="text-blue-600 dark:text-blue-400 font-bold">
                                                            {vault.asrProtectedItemsCount} VMs
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">-</span>
                                                    )}
                                                </td>

                                                {/* Storage Consumed */}
                                                <td className="py-3 px-4 font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                    {vault.storageBreakdown.totalStorageGB} GiB
                                                </td>

                                                {/* Monthly Cost */}
                                                <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                                                    {format(vault.monthlyCostUsd)}
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
                                                            onClick={() => setSelectedVaultForDetail(vault)}
                                                            className="p-1.5 text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                                            title={t("viewProtectedItems")}
                                                        >
                                                            <IconInfoCircle className="w-4 h-4" stroke={1.5} />
                                                        </button>
                                                        {vault.recommendations.length > 0 && (
                                                            <button
                                                                onClick={() => setSelectedActionForModal(vault.recommendations[0])}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] rounded-md hover:bg-blue-50/60 dark:hover:bg-slate-800 transition-colors"
                                                                title={t("optimizeVault")}
                                                            >
                                                                <IconSparkles className="w-3.5 h-3.5 text-[#0054A6]" stroke={1.5} />
                                                                <span>{t("optimize")}</span>
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
                                    start: Math.min(filteredVaults.length, (currentPage - 1) * pageSize + 1),
                                    end: Math.min(filteredVaults.length, currentPage * pageSize),
                                    total: filteredVaults.length,
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
                                        {t("vaultLabel")} <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{selectedActionForModal.vaultName}</span>
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
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-800 border border-[#0054A6] rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700"
                                    >
                                        {copiedText ? (
                                            <>
                                                <IconCheck className="w-3.5 h-3.5 text-emerald-500" stroke={2} />
                                                Copiado
                                            </>
                                        ) : (
                                            <>
                                                <IconCopy className="w-3.5 h-3.5" stroke={1.5} />
                                                {t("copyScript")}
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
                                {t("close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal 2: Architectural Details & Protected Items Drawer (Z-Index z-[100]) */}
            {selectedVaultForDetail && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#0054A6]">
                                    <IconShieldCheck className="w-5 h-5" stroke={1.5} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {selectedVaultForDetail.name}
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        {t("protectedItemsAndStorage")}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedVaultForDetail(null)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <IconX className="w-5 h-5" stroke={1.5} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
                            {/* Vault Specs */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                    <span className="text-slate-400 font-medium">{t("colType")}</span>
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                                        {selectedVaultForDetail.vaultType}
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                    <span className="text-slate-400 font-medium">{t("redundancy")}</span>
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                                        {selectedVaultForDetail.redundancy}
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                    <span className="text-slate-400 font-medium">Soft Delete</span>
                                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                                        {selectedVaultForDetail.softDeleteEnabled ? `Activo (${selectedVaultForDetail.softDeleteRetentionDays}d)` : "Inactivo"}
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                                    <span className="text-slate-400 font-medium">Inmutabilidad</span>
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                                        {selectedVaultForDetail.immutabilityState}
                                    </p>
                                </div>
                            </div>

                            {/* Protected Items List */}
                            <div className="space-y-2">
                                <h4 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                    <IconFileCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                                    {t("protectedItemsInventory", { n: selectedVaultForDetail.protectedItems.length })}
                                </h4>

                                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                                            <tr>
                                                <th className="py-2 px-3">{t("colItemResource")}</th>
                                                <th className="py-2 px-3">{t("colType")}</th>
                                                <th className="py-2 px-3">{t("colStatus")}</th>
                                                <th className="py-2 px-3">Tier</th>
                                                <th className="py-2 px-3 text-right">Storage</th>
                                                <th className="py-2 px-3 text-right">{t("colCostMonth")}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {selectedVaultForDetail.protectedItems.length === 0 ? (
                                                <tr>
                                                    <td colSpan={6} className="py-6 text-center text-slate-400">
                                                        {t("emptyVaultItems")}
                                                    </td>
                                                </tr>
                                            ) : (
                                                selectedVaultForDetail.protectedItems.map((item) => (
                                                    <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                                                        <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">
                                                            {item.name}
                                                        </td>
                                                        <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                                                            {item.workloadType}
                                                        </td>
                                                        <td className="py-2 px-3">
                                                            {item.isOrphanCandidate || item.protectionState === "ProtectionStopped" ? (
                                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                                                    {t("badgeOrphan")}
                                                                </span>
                                                            ) : (
                                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                                                    Protegido
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-2 px-3 font-mono text-slate-500">
                                                            {item.backupTier}
                                                        </td>
                                                        <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                            {item.storageConsumedGB} GiB
                                                        </td>
                                                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                                                            {format(item.monthlyCostUsd)}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Resource ID */}
                            <div className="space-y-1.5">
                                <span className="text-slate-400 font-medium">Resource ID Azure</span>
                                <p className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] break-all select-all">
                                    {selectedVaultForDetail.id}
                                </p>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
                            <button
                                onClick={() => setSelectedVaultForDetail(null)}
                                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                                {t("close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

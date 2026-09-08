"use client";
import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { useTextoDeRecomendacion } from "@/lib/recommendationText";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import {
    IconDatabase,
    IconServer,
    IconAlertCircle,
    IconInfoCircle,
    IconSearch,
    IconChevronLeft,
    IconChevronRight,
    IconArrowsSort,
    IconChartBar,
    IconShieldCheck,
    IconShieldX,
    IconRefresh,
    IconTerminal2,
    IconCopy,
    IconCheck,
    IconX,
    IconLayersLinked,
    IconDotsVertical,
    IconClockHour4,
    IconBox,
    IconFolders,
    IconListDetails,
    IconSparkles,
    IconActivity,
} from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import StorageHistoryModal from "@/components/dashboard/StorageHistoryModal";
import {
    StorageAccountDetail,
    StorageEfficiencyResponse,
    StorageRemediationAction,
} from "@/types/storage.types";

// Un hue por tier, no tonos del mismo azul: hot/cool y cold/archive eran
// prácticamente indistinguibles en el swatch de la leyenda y en la barra
// (bg-blue-600 vs bg-blue-500, bg-sky-400 vs bg-sky-200).
const TIER_COLORS: Record<string, string> = {
    hot:     "bg-blue-700 dark:bg-blue-400",      // #0078D4 / Deep corporate blue
    cool:    "bg-cyan-500 dark:bg-cyan-400",      // Teal-cyan, claramente distinto del azul de Hot
    cold:    "bg-indigo-400 dark:bg-indigo-300",  // Índigo, distinto del cyan de Cool
    archive: "bg-slate-400 dark:bg-slate-500",    // Gris neutro: convención visual de "inactivo"
    premium: "bg-fuchsia-600 dark:bg-fuchsia-500",
};

const TIER_TEXT_COLORS: Record<string, string> = {
    hot:     "text-blue-700 dark:text-blue-400",
    cool:    "text-cyan-700 dark:text-cyan-400",
    cold:    "text-indigo-600 dark:text-indigo-300",
    archive: "text-slate-600 dark:text-slate-300",
    premium: "text-fuchsia-700 dark:text-fuchsia-400",
};

export function formatStorageSize(gb: number | null | undefined): string {
    if (gb === null || gb === undefined || gb <= 0) return "0 MB";
    if (gb >= 1000) return `${(gb / 1024).toFixed(2)} TB`;
    if (gb < 1) {
        const mb = gb * 1024;
        return mb < 1 ? `${mb.toFixed(2)} MB` : `${Math.round(mb)} MB`;
    }
    return `${gb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

function formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export default function StorageEfficiencyDashboard() {
    const t = useTranslations("StorageEfficiency");
    const { texto } = useTextoDeRecomendacion("StorageEfficiency");
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();

    // Table State
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTierFilter, setSelectedTierFilter] = useState<string>("all");
    const [selectedRedundancyFilter, setSelectedRedundancyFilter] = useState<string>("all");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [sortField, setSortField] = useState<"name" | "resourceGroup" | "tier" | "usedGb" | "monthlyCost">("monthlyCost");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    // Modals State
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [selectedRemediation, setSelectedRemediation] = useState<StorageRemediationAction | null>(null);
    const [selectedAccountForDetail, setSelectedAccountForDetail] = useState<StorageAccountDetail | null>(null);
    const [remediationTab, setRemediationTab] = useState<"json" | "cli" | "powershell">("json");
    const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

    const currentMonthRange = useMemo(() => {
        const now = new Date();
        return {
            startDate: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
            endDate: formatLocalDate(now),
        };
    }, []);

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

    const { data, error, isLoading, mutate } = useSWR<StorageEfficiencyResponse>(
        selectedTenant && selectedTenant.id !== "default"
            ? `/api/intelligence/storage-efficiency?tenantId=${selectedTenant.id}&startDate=${currentMonthRange.startDate}&endDate=${currentMonthRange.endDate}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const rawAccountsList: StorageAccountDetail[] = useMemo(() => data?.accounts || [], [data]);

    const filteredAccounts = useMemo(() => {
        return rawAccountsList
            .filter((item) => {
                const searchLower = searchQuery.toLowerCase();
                const matchesSearch =
                    searchQuery === "" ||
                    item.name.toLowerCase().includes(searchLower) ||
                    item.resourceGroup.toLowerCase().includes(searchLower) ||
                    (item.subscriptionName && item.subscriptionName.toLowerCase().includes(searchLower)) ||
                    (item.subscriptionId && item.subscriptionId.toLowerCase().includes(searchLower));

                const matchesTier =
                    selectedTierFilter === "all" ||
                    item.tier.toLowerCase() === selectedTierFilter.toLowerCase();

                const matchesRedundancy =
                    selectedRedundancyFilter === "all" ||
                    item.redundancyType.toLowerCase() === selectedRedundancyFilter.toLowerCase();

                return matchesSearch && matchesTier && matchesRedundancy;
            })
            .sort((a, b) => {
                let valA: any = a[sortField];
                let valB: any = b[sortField];
                if (typeof valA === "string") valA = valA.toLowerCase();
                if (typeof valB === "string") valB = valB.toLowerCase();
                if (valA === null || valA === undefined) valA = -1;
                if (valB === null || valB === undefined) valB = -1;

                if (valA < valB) return sortOrder === "asc" ? -1 : 1;
                if (valA > valB) return sortOrder === "asc" ? 1 : -1;
                return 0;
            });
    }, [rawAccountsList, searchQuery, selectedTierFilter, selectedRedundancyFilter, sortField, sortOrder]);

    const totalPages = Math.ceil(filteredAccounts.length / pageSize) || 1;
    const paginatedAccounts = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredAccounts.slice(start, start + pageSize);
    }, [filteredAccounts, currentPage, pageSize]);

    const handleSort = (field: "name" | "resourceGroup" | "tier" | "usedGb" | "monthlyCost") => {
        if (sortField === field) {
            setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortField(field);
            setSortOrder("desc");
        }
    };

    const handleCopy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopiedSnippet(label);
        setTimeout(() => setCopiedSnippet(null), 2500);
    };

    const getTierBadgeClass = (tierStr: string) => {
        const lower = tierStr.toLowerCase();
        if (lower.includes("hot")) return "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800/60";
        if (lower.includes("cool")) return "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border-sky-200 dark:border-sky-800/60";
        if (lower.includes("cold")) return "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800/60";
        if (lower.includes("archive")) return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700";
        if (lower.includes("premium")) return "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60";
        return "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700";
    };

    const getRedundancyBadgeClass = (redundancy: string) => {
        if (redundancy === "ZRS") return "border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300 bg-purple-50/70 dark:bg-purple-950/40";
        if (redundancy === "GRS" || redundancy === "RA-GRS") return "border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/40";
        return "border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/40";
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <IconRefresh className="w-8 h-8 animate-spin text-[#0054A6] mb-4" stroke={1.5} />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    {t("analyzing")}
                </p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t("tierLockedFeatureName")} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-200 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2">
                    <IconAlertCircle className="w-5 h-5" stroke={1.5} /> {t("loadCockpitError")}
                </h3>
                <p className="text-xs mt-1">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const tiers = data.tiers || {
        hot:     { percent: 0, gb: 0, cost: 0 },
        cool:    { percent: 0, gb: 0, cost: 0 },
        cold:    { percent: 0, gb: 0, cost: 0 },
        archive: { percent: 0, gb: 0, cost: 0 },
    };
    const tierKeys = ["hot", "cool", "cold", "archive"] as const;
    const remediations = data.remediations || [];

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {data.mock && (
                <div className="bg-amber-50/80 dark:bg-amber-900/20 p-3.5 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-200">
                    <IconInfoCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" stroke={1.5} />
                    <div className="text-xs leading-relaxed">
                        <span className="font-bold mr-2 px-1.5 py-0.5 bg-amber-200/80 dark:bg-amber-800 rounded text-[11px]">{tm("badge")}</span>
                        {tm("description")}
                    </div>
                </div>
            )}

            {/* Action Bar Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div>
                    <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                        <IconDatabase className="w-5 h-5 text-[#0054A6]" stroke={1.5} />
                        {t("title")}
                        <InfoTooltip content={t("tooltip_page_header")} position="bottom" align="left" />
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {t("subtitle")}
                    </p>
                </div>
                <div className="flex items-center gap-2.5">
                    <button
                        onClick={() => mutate()}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-all"
                        title={t("refreshData")}
                    >
                        <IconRefresh className="w-4 h-4" stroke={1.5} />
                        {t("refresh")}
                    </button>
                    <button
                        onClick={() => setIsHistoryModalOpen(true)}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] hover:bg-blue-50/60 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-all"
                    >
                        <IconChartBar className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("btnHistory")}
                    </button>
                </div>
            </div>

            {/* Top KPI Cards (4 Cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* KPI 1: Costo por GB */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("costPerGb")}</p>
                        <InfoTooltip content={t("tooltip_kpi_cost_per_gb")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {format(data.costPerGb ?? 0, { fractionDigits: 5 })}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                            -7.7% vs Benchmark LRS
                        </span>
                    </div>
                </div>

                {/* KPI 2: Almacenamiento Total */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("totalStorage")}</p>
                        <InfoTooltip content={t("tooltip_kpi_total_storage")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {formatStorageSize(data.totalGb ?? 0)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1">
                        <IconBox className="w-3.5 h-3.5 text-blue-600" stroke={1.5} />
                        {data.accountsCount || rawAccountsList.length} cuentas ({formatStorageSize(tiers.hot.gb)} en Hot)
                    </p>
                </div>

                {/* KPI 3: Costo Total MTD */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("totalCost")}</p>
                        <InfoTooltip content={t("tooltip_kpi_total_cost")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {format(data.totalCost ?? 0)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1">
                        <IconClockHour4 className="w-3.5 h-3.5 text-slate-400" stroke={1.5} />
                        {t("projectedCost")}: <span className="font-semibold text-slate-700 dark:text-slate-300">{format(data.projectedEndOfMonthCost ?? data.totalCost * 1.5)}</span>
                    </p>
                </div>

                {/* KPI 4: Cuentas Detectadas & Redundancia */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("accountsCount")}</p>
                        <InfoTooltip content={t("tooltip_kpi_accounts")} position="bottom" align="left" />
                    </div>
                    <p className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                        {data.accountsCount || rawAccountsList.length} {t("accountsSuffix")}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1">
                        <IconLayersLinked className="w-3.5 h-3.5 text-purple-600" stroke={1.5} />
                        {data.redundancyCounts?.zrs ?? 0} con Redundancia ZRS / {data.redundancyCounts?.lrs ?? 0} LRS
                    </p>
                </div>
            </div>

            {/* Bloque 1: Distribución por Tier (Gráfica en Escala de Azules) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                        <IconDatabase className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("distribution")}
                        <InfoTooltip content={t("tooltip_tier_distribution")} position="bottom" align="left" />
                    </h3>
                    <span className="text-xs text-slate-400">Total: {formatStorageSize(data.totalGb ?? 0)}</span>
                </div>

                {/* Stacked bar in blue tones */}
                <div className="flex h-9 rounded-lg overflow-hidden mb-5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    {tierKeys.map((tier) => {
                        const pct = tiers[tier]?.percent ?? 0;
                        return pct > 0 ? (
                            <div
                                key={tier}
                                className={`${TIER_COLORS[tier]} flex items-center justify-center text-white text-xs font-bold transition-all`}
                                style={{ width: `${pct}%` }}
                                title={`${tier.toUpperCase()}: ${pct}% (${formatStorageSize(tiers[tier]?.gb)})`}
                            >
                                {pct > 10 ? `${pct}%` : ""}
                            </div>
                        ) : null;
                    })}
                </div>

                {/* 4 Tier Micro-cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {tierKeys.map((tier) => {
                        const d = tiers[tier] || { percent: 0, gb: 0, cost: 0 };
                        return (
                            <div key={tier} className="rounded-lg border border-slate-200/80 dark:border-slate-800 p-3 bg-slate-50/40 dark:bg-slate-800/30">
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <span className={`w-2.5 h-2.5 rounded-sm ${TIER_COLORS[tier]}`} />
                                        <span className={`text-xs font-bold uppercase ${TIER_TEXT_COLORS[tier]}`}>{t(tier)}</span>
                                    </div>
                                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{d.percent}%</span>
                                </div>
                                <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{formatStorageSize(d.gb)}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{format(d.cost)} MTD</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Bloque 2: Composición del Storage Account */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                        <IconFolders className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("compositionTitle")}
                        <InfoTooltip content={t("tooltip_storage_composition")} position="bottom" align="left" />
                    </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                        { key: "blob", label: t("blobStorage"), icon: IconDatabase },
                        { key: "files", label: t("azureFiles"), icon: IconFolders },
                        { key: "queue", label: t("queueStorage"), icon: IconListDetails },
                        { key: "table", label: t("tableStorage"), icon: IconLayersLinked },
                    ].map((item) => {
                        const composition = data?.storageComposition?.[item.key as keyof typeof data.storageComposition] || { gb: 0, cost: 0 };
                        const IconComponent = item.icon;
                        return (
                            <div key={item.key} className="rounded-lg border border-slate-200/80 dark:border-slate-800 p-4 bg-white dark:bg-slate-900/60 shadow-xs">
                                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs font-medium">
                                    <IconComponent className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                                    <span>{item.label}</span>
                                </div>
                                <p className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 mt-2 font-['Montserrat']">
                                    {formatStorageSize(Number(composition.gb || 0))}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                                    {format(Number(composition.cost || 0))}
                                </p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Bloque 3: Storage FinOps Engine — Remediaciones Resolutivas (Neutral Enterprise Design) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                            <IconSparkles className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                            {t("remediationsTitle")}
                            <InfoTooltip content={t("tooltip_remediations")} position="bottom" align="left" />
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("remediationsSubtitle")}
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    {remediations.length > 0 ? (
                        remediations.map((rem) => {
                            const isCost = rem.category === "Cost";
                            const isSec = rem.category === "Security";
                            return (
                                <div
                                    key={rem.id}
                                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs"
                                >
                                    <div className="space-y-1.5 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                                                isCost
                                                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                                                    : isSec
                                                    ? "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                                                    : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600"
                                            }`}>
                                                {rem.category.toUpperCase()}
                                            </span>
                                            <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                                {texto(rem.titleKey, rem.params)}
                                            </h4>
                                            {rem.targetAccountName && (
                                                <span className="text-[11px] font-mono text-slate-500 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                                    {rem.targetAccountName}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                            {texto(rem.descKey, rem.params)}
                                        </p>
                                        {rem.impactKey && (
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                                💡 {texto(rem.impactKey, rem.params)}
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3 shrink-0">
                                        {rem.estimatedSavingsUSD > 0 && (
                                            <div className="text-right">
                                                <span className="text-[10px] text-slate-400 block">{t("colEstimatedSavings")}</span>
                                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                                    {format(rem.estimatedSavingsUSD)}{t("perMonthSuffix")}
                                                </span>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => {
                                                setSelectedRemediation(rem);
                                                setRemediationTab("json");
                                            }}
                                            className="px-3 py-2 text-xs font-bold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] hover:bg-blue-50/60 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                                        >
                                            <IconTerminal2 className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                                            {rem.actionType === "LIFECYCLE_POLICY_CREATE"
                                                ? t("btnGeneratePolicy")
                                                : rem.actionType === "REDUNDANCY_OPTIMIZE_LRS"
                                                ? t("btnChangeLrs")
                                                : rem.actionType === "ZOMBIE_ACCOUNT_PURGE"
                                                ? t("btnAuditZombie")
                                                : rem.actionType === "SOFT_DELETE_RETENTION_ADJUST"
                                                ? t("btnAdjustSoftDelete")
                                                : rem.actionType === "SECURITY_HARDENING_PUBLIC_ACCESS"
                                                ? t("btnDisablePublicAccess")
                                                : t("btnExecuteRemediation")}
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <p className="text-xs text-slate-500 py-4 text-center">
                            {t("noAnomalies")}
                        </p>
                    )}
                </div>
            </div>

            {/* Bloque 4: Tabla Maestra de Cuentas de Almacenamiento */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2 font-['Montserrat']">
                            <IconServer className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                            {t("tableTitle")}
                            <InfoTooltip content={t("tooltip_all_resources")} position="bottom" align="left" />
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("tableSubtitle")}
                        </p>
                    </div>

                    {/* Controls: Search + Tier filter + Redundancy filter */}
                    <div className="flex flex-wrap items-center gap-2.5">
                        <div className="relative min-w-[220px] flex-1 sm:flex-none">
                            <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" stroke={1.5} />
                            <input
                                type="text"
                                placeholder={t("searchPlaceholder")}
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0054A6] text-slate-800 dark:text-slate-200"
                            />
                        </div>

                        {/* Tier Filter */}
                        <select
                            value={selectedTierFilter}
                            onChange={(e) => {
                                setSelectedTierFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="py-1.5 px-3 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0054A6] text-slate-800 dark:text-slate-200 font-medium"
                        >
                            <option value="all">{t("allTiers")}</option>
                            <option value="hot">Hot</option>
                            <option value="cool">Cool</option>
                            <option value="cold">Cold</option>
                            <option value="archive">Archive</option>
                            <option value="premium">Premium</option>
                        </select>

                        {/* Redundancy Filter */}
                        <select
                            value={selectedRedundancyFilter}
                            onChange={(e) => {
                                setSelectedRedundancyFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="py-1.5 px-3 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0054A6] text-slate-800 dark:text-slate-200 font-medium"
                        >
                            <option value="all">{t("allRedundancies")}</option>
                            <option value="lrs">Standard_LRS</option>
                            <option value="zrs">Standard_ZRS</option>
                            <option value="grs">Standard_GRS</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                        <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                            <tr>
                                <th onClick={() => handleSort("name")} className="py-3 px-4 cursor-pointer hover:text-[#0054A6] transition-colors">
                                    <div className="flex items-center gap-1">
                                        {t("colAccountName")}
                                        <InfoTooltip content={t("tooltip_col_resource")} position="bottom" align="left" />
                                        <IconArrowsSort className="w-3.5 h-3.5 opacity-60" stroke={1.5} />
                                    </div>
                                </th>
                                <th onClick={() => handleSort("resourceGroup")} className="py-3 px-4 cursor-pointer hover:text-[#0054A6] transition-colors">
                                    <div className="flex items-center gap-1">
                                        {t("colResourceGroup")}
                                        <InfoTooltip content={t("tooltip_col_resource_group")} position="bottom" align="left" />
                                        <IconArrowsSort className="w-3.5 h-3.5 opacity-60" stroke={1.5} />
                                    </div>
                                </th>
                                <th className="py-3 px-4">
                                    <div className="flex items-center gap-1">
                                        {t("colSubscription")}
                                        <InfoTooltip content={t("tooltip_col_subscription")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => handleSort("tier")} className="py-3 px-4 cursor-pointer hover:text-[#0054A6] transition-colors">
                                    <div className="flex items-center gap-1">
                                        {t("colTier")}
                                        <InfoTooltip content={t("tooltip_col_tier")} position="bottom" align="left" />
                                        <IconArrowsSort className="w-3.5 h-3.5 opacity-60" stroke={1.5} />
                                    </div>
                                </th>
                                <th className="py-3 px-4">
                                    <div className="flex items-center gap-1">
                                        {t("colActiveServices")}
                                        <InfoTooltip content={t("tooltip_col_services")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th className="py-3 px-4">
                                    <div className="flex items-center gap-1">
                                        {t("colSecurity")}
                                        <InfoTooltip content={t("tooltip_col_security")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th className="py-3 px-4">
                                    <div className="flex items-center gap-1">
                                        {t("colLifecycle")}
                                        <InfoTooltip content={t("tooltip_col_lifecycle")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => handleSort("usedGb")} className="py-3 px-4 text-right cursor-pointer hover:text-[#0054A6] transition-colors">
                                    <div className="flex items-center justify-end gap-1">
                                        {t("colUsedStorage")}
                                        <InfoTooltip content={t("tooltip_col_storage")} position="bottom" align="right" />
                                        <IconArrowsSort className="w-3.5 h-3.5 opacity-60" stroke={1.5} />
                                    </div>
                                </th>
                                <th onClick={() => handleSort("monthlyCost")} className="py-3 px-4 text-right cursor-pointer hover:text-[#0054A6] transition-colors">
                                    <div className="flex items-center justify-end gap-1">
                                        {t("colCost")}
                                        <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
                                        <IconArrowsSort className="w-3.5 h-3.5 opacity-60" stroke={1.5} />
                                    </div>
                                </th>
                                <th className="py-3 px-4 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                        {t("colActions")}
                                        <InfoTooltip content={t("tooltip_col_actions")} position="bottom" align="right" />
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {paginatedAccounts.length > 0 ? (
                                paginatedAccounts.map((account) => (
                                    <tr
                                        key={account.id || account.name}
                                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                                        onClick={() => setSelectedAccountForDetail(account)}
                                    >
                                        {/* Account name + SKU */}
                                        <td className="py-3.5 px-4 font-mono">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-[#1B2A41] dark:text-slate-100 hover:text-[#0054A6]">
                                                        {account.name}
                                                    </span>
                                                    {account.isZombieCandidate && (
                                                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                                            {t("zombieBadge")}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-1 font-sans">
                                                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${getRedundancyBadgeClass(account.redundancyType)}`}>
                                                        {account.skuName || "Standard_LRS"}
                                                    </span>
                                                    {account.environmentTag && (
                                                        <span className="text-[10px] text-slate-400 uppercase font-semibold">
                                                            • {account.environmentTag}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>

                                        {/* Resource Group */}
                                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                                            {account.resourceGroup}
                                        </td>

                                        {/* Subscription */}
                                        <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 text-[11px] max-w-[150px] truncate" title={account.subscriptionName || account.subscriptionId}>
                                            {account.subscriptionName || account.subscriptionId}
                                        </td>

                                        {/* Tier Badge */}
                                        <td className="py-3.5 px-4">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getTierBadgeClass(account.tier)}`}>
                                                {account.tier}
                                            </span>
                                        </td>

                                        {/* Active Services */}
                                        <td className="py-3.5 px-4">
                                            <div className="flex flex-wrap items-center gap-1">
                                                {account.activeServices?.map((srv) => (
                                                    <span
                                                        key={srv}
                                                        className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded"
                                                    >
                                                        {srv === "adls_gen2" ? "ADLS Gen2" : srv.toUpperCase()}
                                                    </span>
                                                )) || <span className="text-slate-400 text-[11px]">-</span>}
                                            </div>
                                        </td>

                                        {/* Security & Network */}
                                        <td className="py-3.5 px-4">
                                            <div className="flex flex-col gap-1">
                                                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
                                                    account.publicAccessAllowed
                                                        ? "text-rose-600 dark:text-rose-400"
                                                        : "text-emerald-600 dark:text-emerald-400"
                                                }`}>
                                                    {account.publicAccessAllowed ? (
                                                        <IconShieldX className="w-3.5 h-3.5 shrink-0" stroke={1.5} />
                                                    ) : (
                                                        <IconShieldCheck className="w-3.5 h-3.5 shrink-0" stroke={1.5} />
                                                    )}
                                                    {account.publicAccessAllowed ? t("publicAccessAllowed") : t("publicAccessBlocked")}
                                                </span>
                                                <span className="text-[10px] text-slate-400">
                                                    {account.minimumTlsVersion === "TLS1_2" ? t("tlsCompliant") : t("tlsLegacy")}
                                                </span>
                                            </div>
                                        </td>

                                        {/* Lifecycle Policy */}
                                        <td className="py-3.5 px-4">
                                            {account.hasLifecyclePolicy ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                                                    <IconCheck className="w-3 h-3" stroke={2} />
                                                    {t("lifecycleActive", { count: account.lifecycleRulesCount || 1 })}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50">
                                                    <IconClockHour4 className="w-3 h-3" stroke={1.5} />
                                                    {t("lifecycleNoRules")}
                                                </span>
                                            )}
                                        </td>

                                        {/* Used Storage */}
                                        <td className="py-3.5 px-4 text-right font-bold text-[#1B2A41] dark:text-slate-100">
                                            {account.usedGb === null ? t("capacityUnavailable") : formatStorageSize(account.usedGb)}
                                            {account.capacitySource === "azure-monitor" && account.capacityUpdatedAt && (
                                                <span className="block mt-0.5 text-[10px] font-normal text-slate-400 dark:text-slate-500">
                                                    {t("capacityLiveAt", {
                                                        timestamp: new Intl.DateTimeFormat(undefined, {
                                                            dateStyle: "short",
                                                            timeStyle: "short",
                                                        }).format(new Date(account.capacityUpdatedAt)),
                                                    })}
                                                </span>
                                            )}
                                        </td>

                                        {/* Monthly Cost */}
                                        <td className="py-3.5 px-4 text-right font-bold text-[#1B2A41] dark:text-slate-100">
                                            {format(account.monthlyCost)}
                                        </td>

                                        {/* Actions */}
                                        <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => setSelectedAccountForDetail(account)}
                                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
                                                title={t("btnViewDetails")}
                                            >
                                                <IconDotsVertical className="w-4 h-4" stroke={1.5} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={10} className="py-10 text-center text-slate-400 dark:text-slate-500">
                                        {t("emptyState")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <span>{t("perPage")}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="py-1 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0054A6] text-slate-800 dark:text-slate-200 font-semibold"
                        >
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                        <span>
                            ({t("paginationShowing", {
                                from: filteredAccounts.length > 0 ? (currentPage - 1) * pageSize + 1 : 0,
                                to: Math.min(currentPage * pageSize, filteredAccounts.length),
                                total: filteredAccounts.length,
                            })})
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title={t("previous")}
                        >
                            <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                        </button>
                        <span className="px-2 font-medium">
                            {t("page", { current: currentPage, total: totalPages })}
                        </span>
                        <button
                            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title={t("next")}
                        >
                            <IconChevronRight className="w-4 h-4" stroke={1.5} />
                        </button>
                    </div>
                </div>
            </div>

            {/* MODAL 1: Resolutive Remediation Modal (JSON / CLI / PowerShell) */}
            {selectedRemediation && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2.5">
                                <span className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#0054A6]">
                                    <IconTerminal2 className="w-5 h-5" stroke={1.5} />
                                </span>
                                <div>
                                    <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-['Montserrat']">
                                        {texto(selectedRemediation.titleKey, selectedRemediation.params)}
                                    </h3>
                                    <p className="text-xs text-slate-500 font-mono">
                                        {selectedRemediation.targetAccountName} ({selectedRemediation.targetResourceGroup})
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedRemediation(null)}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <IconX className="w-4 h-4" stroke={1.5} />
                            </button>
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {texto(selectedRemediation.descKey, selectedRemediation.params)}
                        </p>

                        {/* Implementation Steps */}
                        {selectedRemediation.stepKeys && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                                <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                                    {t("implementationProtocol")}
                                </h4>
                                <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside">
                                    {selectedRemediation.stepKeys.map((clave) => (
                                        <li key={clave}>{texto(clave, selectedRemediation.params)}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Code snippet tabs */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                                {selectedRemediation.jsonPayload && (
                                    <button
                                        onClick={() => setRemediationTab("json")}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                            remediationTab === "json"
                                                ? "bg-white dark:bg-slate-800 text-[#0054A6] dark:text-blue-400 border-[#0054A6]"
                                                : "bg-transparent text-slate-500 border-transparent hover:bg-slate-100"
                                        }`}
                                    >
                                        {t("jsonPolicy")}
                                    </button>
                                )}
                                {selectedRemediation.cliCommand && (
                                    <button
                                        onClick={() => setRemediationTab("cli")}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                            remediationTab === "cli"
                                                ? "bg-white dark:bg-slate-800 text-[#0054A6] dark:text-blue-400 border-[#0054A6]"
                                                : "bg-transparent text-slate-500 border-transparent hover:bg-slate-100"
                                        }`}
                                    >
                                        Azure CLI
                                    </button>
                                )}
                                {selectedRemediation.powershellCommand && (
                                    <button
                                        onClick={() => setRemediationTab("powershell")}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                            remediationTab === "powershell"
                                                ? "bg-white dark:bg-slate-800 text-[#0054A6] dark:text-blue-400 border-[#0054A6]"
                                                : "bg-transparent text-slate-500 border-transparent hover:bg-slate-100"
                                        }`}
                                    >
                                        PowerShell
                                    </button>
                                )}
                            </div>

                            <div className="relative">
                                <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto max-h-64 leading-relaxed">
                                    {remediationTab === "json"
                                        ? selectedRemediation.jsonPayload
                                        : remediationTab === "cli"
                                        ? selectedRemediation.cliCommand
                                        : selectedRemediation.powershellCommand}
                                </pre>
                                <button
                                    onClick={() => {
                                        const text =
                                            remediationTab === "json"
                                                ? selectedRemediation.jsonPayload || ""
                                                : remediationTab === "cli"
                                                ? selectedRemediation.cliCommand || ""
                                                : selectedRemediation.powershellCommand || "";
                                        handleCopy(text, remediationTab);
                                    }}
                                    className="absolute top-3 right-3 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 shadow-sm transition-all"
                                >
                                    {copiedSnippet === remediationTab ? (
                                        <>
                                            <IconCheck className="w-3.5 h-3.5 text-emerald-400" stroke={2} />
                                            {t("copied")}
                                        </>
                                    ) : (
                                        <>
                                            <IconCopy className="w-3.5 h-3.5" stroke={1.5} />
                                            {t("copy")}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                            <span className="text-slate-500">
                                {t.rich("estSavingsRich", { amount: format(selectedRemediation.estimatedSavingsUSD), b: (c) => <strong className="text-emerald-600 font-mono">{c}</strong> })}
                            </span>
                            <button
                                onClick={() => setSelectedRemediation(null)}
                                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 font-semibold hover:bg-slate-50 transition-colors"
                            >
                                {t("close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL 2: Account Architectural Details Drawer/Modal */}
            {selectedAccountForDetail && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2.5">
                                <span className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#0054A6]">
                                    <IconServer className="w-5 h-5" stroke={1.5} />
                                </span>
                                <div>
                                    <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-mono">
                                        {selectedAccountForDetail.name}
                                    </h3>
                                    <p className="text-xs text-slate-500">
                                        {selectedAccountForDetail.resourceGroup} • {selectedAccountForDetail.location}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedAccountForDetail(null)}
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <IconX className="w-4 h-4" stroke={1.5} />
                            </button>
                        </div>

                        {/* Grid of properties */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40">
                                <span className="text-slate-400 text-[10px] block">{t("skuRedundancy")}</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                                    {selectedAccountForDetail.skuName}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40">
                                <span className="text-slate-400 text-[10px] block">{t("mainTier")}</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">
                                    {selectedAccountForDetail.tier}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40">
                                <span className="text-slate-400 text-[10px] block">Data Lake Gen2 (HNS)</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">
                                    {selectedAccountForDetail.isHnsEnabled ? t("enabled") : t("disabled")}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40">
                                <span className="text-slate-400 text-[10px] block">{t("publicAccess")}</span>
                                <span className={`font-bold ${selectedAccountForDetail.publicAccessAllowed ? "text-rose-600" : "text-emerald-600"}`}>
                                    {selectedAccountForDetail.publicAccessAllowed ? t("publicOpen") : t("blocked")}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40">
                                <span className="text-slate-400 text-[10px] block">{t("minTlsVersion")}</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                                    {selectedAccountForDetail.minimumTlsVersion}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/40">
                                <span className="text-slate-400 text-[10px] block">{t("softDeleteRetention")}</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">
                                    {selectedAccountForDetail.deleteRetentionEnabled ? t("retentionDays", { n: selectedAccountForDetail.deleteRetentionDays }) : t("disabled")}
                                </span>
                            </div>
                        </div>

                        {/* Telemetry Metrics */}
                        {selectedAccountForDetail.metrics && (
                            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 space-y-2">
                                <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5 font-['Montserrat']">
                                    <IconActivity className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                                    {t("telemetryTraffic")}
                                </h4>
                                <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                                    <div>
                                        <span className="text-[10px] text-slate-400 block">{t("apiOperations")}</span>
                                        <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                                            {selectedAccountForDetail.metrics.transactionsCount.toLocaleString()}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-400 block">{t("egress")}</span>
                                        <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                                            {formatStorageSize(selectedAccountForDetail.metrics.egressBytes / (1024 * 1024 * 1024))}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-400 block">{t("ingress")}</span>
                                        <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                                            {formatStorageSize(selectedAccountForDetail.metrics.ingressBytes / (1024 * 1024 * 1024))}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={() => setSelectedAccountForDetail(null)}
                                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 font-semibold hover:bg-slate-50 transition-colors text-xs"
                            >
                                {t("close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Storage History Modal */}
            <StorageHistoryModal
                isOpen={isHistoryModalOpen}
                onClose={() => setIsHistoryModalOpen(false)}
                tenantId={selectedTenant.id}
            />
        </div>
    );
}

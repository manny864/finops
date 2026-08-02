"use client";
import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { Loader2, HardDrive, TrendingDown, AlertCircle, Info, Search, ChevronLeft, ChevronRight, ArrowUpDown, Server } from "lucide-react";
import { isMockTenant } from "@/lib/mockData";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const TIER_COLORS: Record<string, string> = {
    hot:     "bg-orange-400",
    cool:    "bg-blue-400",
    cold:    "bg-cyan-400",
    archive: "bg-slate-400",
};
const TIER_TEXT_COLORS: Record<string, string> = {
    hot:     "text-orange-600 dark:text-orange-400",
    cool:    "text-blue-600 dark:text-blue-400",
    cold:    "text-cyan-600 dark:text-cyan-400",
    archive: "text-slate-600 dark:text-slate-400",
};

interface StorageAccountItem {
    id: string;
    name: string;
    resourceGroup: string;
    subscriptionId: string;
    location: string;
    tier: string;
    kind?: string;
    sku?: string;
    usedGb: number;
    monthlyCost: number;
}

export default function StorageEfficiencyDashboard() {
    const t = useTranslations("StorageEfficiency");
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const [days] = useState(30);

    // Table State
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTierFilter, setSelectedTierFilter] = useState<string>("all");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [sortField, setSortField] = useState<"name" | "resourceGroup" | "tier" | "usedGb" | "monthlyCost">("monthlyCost");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

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
            throw new Error(json.details || json.error || "Error al cargar datos");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/storage-efficiency?tenantId=${selectedTenant.id}&days=${days}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    // Filter & Sort Storage Accounts
    const rawAccountsList: StorageAccountItem[] = useMemo(() => data?.accounts || [], [data]);

    const filteredAccounts = useMemo(() => {
        return rawAccountsList.filter((item) => {
            const matchesSearch =
                searchQuery === "" ||
                item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.resourceGroup.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (item.subscriptionId && item.subscriptionId.toLowerCase().includes(searchQuery.toLowerCase()));

            const matchesTier =
                selectedTierFilter === "all" ||
                item.tier.toLowerCase() === selectedTierFilter.toLowerCase();

            return matchesSearch && matchesTier;
        }).sort((a, b) => {
            let valA: any = a[sortField];
            let valB: any = b[sortField];
            if (typeof valA === "string") valA = valA.toLowerCase();
            if (typeof valB === "string") valB = valB.toLowerCase();

            if (valA < valB) return sortOrder === "asc" ? -1 : 1;
            if (valA > valB) return sortOrder === "asc" ? 1 : -1;
            return 0;
        });
    }, [rawAccountsList, searchQuery, selectedTierFilter, sortField, sortOrder]);

    // Pagination calculations
    const totalPages = Math.ceil(filteredAccounts.length / pageSize) || 1;
    const paginatedAccounts = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredAccounts.slice(start, start + pageSize);
    }, [filteredAccounts, currentPage, pageSize]);

    const handleSort = (field: "name" | "resourceGroup" | "tier" | "usedGb" | "monthlyCost") => {
        if (sortField === field) {
            setSortOrder(prev => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortField(field);
            setSortOrder("desc");
        }
    };

    const getTierBadgeClass = (tierStr: string) => {
        const lower = tierStr.toLowerCase();
        if (lower.includes("hot")) return "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border-orange-200 dark:border-orange-800/50";
        if (lower.includes("cool")) return "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800/50";
        if (lower.includes("cold")) return "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800/50";
        if (lower.includes("archive")) return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700";
        if (lower.includes("premium")) return "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800/50";
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700";
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Analizando eficiencia de almacenamiento...</p>
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
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const tiers: Record<string, { percent: number; gb: number; cost: number }> = data.tiers || {};
    const tierKeys = ["hot", "cool", "cold", "archive"] as const;

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

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t("costPerGb")}</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                        {format(data.costPerGb ?? 0, { fractionDigits: 5 })}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">por GB / mes</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t("totalGb")}</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                        {(data.totalGb ?? 0).toLocaleString()} GB
                    </p>
                    <p className="text-xs text-slate-400 mt-1">almacenamiento total</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Costo Total</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                        {format(data.totalCost ?? 0)}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">últimos {days} días</p>
                </div>
            </div>

            {/* Stacked Bar + Distribution */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-blue-500" />
                    {t("distribution")}
                </h3>
                {/* Stacked bar */}
                <div className="flex h-10 rounded-lg overflow-hidden mb-6">
                    {tierKeys.map((tier) => {
                        const pct = tiers[tier]?.percent ?? 0;
                        return pct > 0 ? (
                            <div
                                key={tier}
                                className={`${TIER_COLORS[tier]} flex items-center justify-center text-white text-xs font-bold transition-all`}
                                style={{ width: `${pct}%` }}
                                title={`${tier}: ${pct}%`}
                            >
                                {pct > 8 ? `${pct}%` : ""}
                            </div>
                        ) : null;
                    })}
                </div>
                {/* Legend + table */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {tierKeys.map((tier) => {
                        const d = tiers[tier] || { percent: 0, gb: 0, cost: 0 };
                        return (
                            <div key={tier} className="rounded-lg border border-gray-100 dark:border-slate-800 p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`w-3 h-3 rounded-sm ${TIER_COLORS[tier]}`} />
                                    <span className={`text-xs font-bold uppercase ${TIER_TEXT_COLORS[tier]}`}>{t(tier as "hot" | "cool" | "cold" | "archive")}</span>
                                </div>
                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{d.gb.toLocaleString()} GB</p>
                                <p className="text-xs text-slate-500">{format(d.cost)}</p>
                                <p className="text-xs text-slate-400">{d.percent}%</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Recommendation */}
            {data.recommendation && (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-2">
                        <TrendingDown className="w-4 h-4" />
                        {t("recommendation")}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">GB movibles</p>
                            <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{data.recommendation.movableGb.toLocaleString()} GB</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                                De <span className="font-semibold uppercase">{data.recommendation.fromTier}</span> → <span className="font-semibold uppercase">{data.recommendation.toTier}</span>
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t("potentialSavings")}</p>
                            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{format(data.recommendation.potentialSavings)}</p>
                            <p className="text-xs text-slate-500 mt-0.5">ahorro mensual estimado</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t("description")}</p>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                                Mover datos de acceso infrecuente a niveles de menor costo reduce el gasto sin impacto operativo.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Storage Accounts Table Section */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <Server className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            {t("tableTitle")}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("tableSubtitle")}
                        </p>
                    </div>

                    {/* Controls: Search + Tier filter */}
                    <div className="flex flex-wrap items-center gap-3">
                        {/* Search Input */}
                        <div className="relative min-w-[200px] flex-1 sm:flex-none">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder={t("searchPlaceholder")}
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/70 border border-gray-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-200"
                            />
                        </div>

                        {/* Tier Filter */}
                        <select
                            value={selectedTierFilter}
                            onChange={(e) => {
                                setSelectedTierFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="py-1.5 px-3 text-xs bg-slate-50 dark:bg-slate-800/70 border border-gray-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-200"
                        >
                            <option value="all">{t("allTiers")}</option>
                            <option value="hot">Hot</option>
                            <option value="cool">Cool</option>
                            <option value="cold">Cold</option>
                            <option value="archive">Archive</option>
                            <option value="premium">Premium</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-800">
                    <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-gray-200 dark:border-slate-800">
                            <tr>
                                <th
                                    onClick={() => handleSort("name")}
                                    className="py-3 px-4 cursor-pointer hover:text-blue-600 transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        {t("colAccountName")}
                                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                                    </div>
                                </th>
                                <th
                                    onClick={() => handleSort("resourceGroup")}
                                    className="py-3 px-4 cursor-pointer hover:text-blue-600 transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        {t("colResourceGroup")}
                                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                                    </div>
                                </th>
                                <th
                                    onClick={() => handleSort("tier")}
                                    className="py-3 px-4 cursor-pointer hover:text-blue-600 transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        {t("colTier")}
                                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                                    </div>
                                </th>
                                <th
                                    onClick={() => handleSort("usedGb")}
                                    className="py-3 px-4 text-right cursor-pointer hover:text-blue-600 transition-colors"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        {t("colUsedStorage")}
                                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                                    </div>
                                </th>
                                <th
                                    onClick={() => handleSort("monthlyCost")}
                                    className="py-3 px-4 text-right cursor-pointer hover:text-blue-600 transition-colors"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        {t("colCost")}
                                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {paginatedAccounts.length > 0 ? (
                                paginatedAccounts.map((account) => (
                                    <tr key={account.id || account.name} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                        <td className="py-3 px-4 font-mono font-medium text-slate-800 dark:text-slate-200">
                                            <div className="flex flex-col">
                                                <span>{account.name}</span>
                                                {account.sku && (
                                                    <span className="text-[10px] text-slate-400 font-sans">{account.sku}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                                            {account.resourceGroup}
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getTierBadgeClass(account.tier)}`}>
                                                {account.tier}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right font-semibold text-slate-800 dark:text-slate-200">
                                            {account.usedGb >= 1000
                                                ? `${(account.usedGb / 1024).toFixed(2)} TB`
                                                : `${account.usedGb.toLocaleString()} GB`}
                                        </td>
                                        <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">
                                            {format(account.monthlyCost)}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className="py-8 text-center text-slate-400 dark:text-slate-500">
                                        {t("emptyState")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 text-xs text-slate-500 dark:text-slate-400">
                    {/* Items per page selector */}
                    <div className="flex items-center gap-2">
                        <span>{t("perPage")}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="py-1 px-2.5 bg-slate-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-slate-200 font-semibold"
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
                                total: filteredAccounts.length
                            })})
                        </span>
                    </div>

                    {/* Pagination Buttons */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 rounded-md border border-gray-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Anterior"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-2 font-medium">
                            {t("page", { current: currentPage, total: totalPages })}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 rounded-md border border-gray-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Siguiente"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

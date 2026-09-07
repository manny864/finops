"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import MockBanner from "@/components/MockBanner";
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip as RechartsTooltip,
    Legend,
} from "recharts";
import {
    IconShieldCheck,
    IconShieldLock,
    IconShieldExclamation,
    IconRefresh,
    IconSearch,
    IconChevronLeft,
    IconChevronRight,
    IconArrowsSort,
    IconCash,
    IconSparkles,
    IconWorld,
    IconNetwork,
    IconTrendingDown,
    IconX,
    IconFilter,
} from "@tabler/icons-react";
import type {
    DdosProtectionResponse,
    DdosResourceDetail,
    DdosRemediationAction,
} from "@/types/ddosProtection.types";
import {
    DDOS_PROTECTION_COLORS,
    DDOS_STATUS_COLORS,
} from "@/types/ddosProtection.types";

// ─── Helpers ──────────────────────────────────────────────────────────────

type SortField = "name" | "location" | "resourceGroup" | "subscriptionName" | "monthlyCostUSD" | "protectionTier" | "status";
type SortOrder = "asc" | "desc";

const PROTECTION_TIER_LABELS: Record<string, string> = {
    NetworkProtection: "Network Protection",
    IpProtection: "IP Protection",
    Basic: "Basic",
};

const STATUS_LABELS: Record<string, string> = {
    Protected: "Protegido",
    UnderAttack: "Bajo Ataque",
    Unprotected: "Sin Protección",
    Orphan: "Huérfano",
};

// ─── Component ────────────────────────────────────────────────────────────

export default function DdosProtectionDashboard() {
    const t = useTranslations("DdosProtection");
    const { selectedTenant } = useTenant();
    const { format } = useCurrency();
    const { instance, accounts: msalAccounts } = useMsal();
    const tenantId = selectedTenant?.id || "demo-tenant-id";

    // ── State ──────────────────────────────────────────────────────────
    const [sortField, setSortField] = useState<SortField>("monthlyCostUSD");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [filterTier, setFilterTier] = useState<string>("all");
    const [filterRg, setFilterRg] = useState<string>("all");
    const [filterSub, setFilterSub] = useState<string>("all");
    const [selectedRemediation, setSelectedRemediation] = useState<DdosRemediationAction | null>(null);

    // ── Data Fetching ──────────────────────────────────────────────────
    const fetcher = async (url: string): Promise<DdosProtectionResponse> => {
        let token: string | null = null;
        if (msalAccounts[0] && !isMockTenant(tenantId)) {
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

    const apiUrl =
        tenantId && tenantId !== "default"
            ? `/api/intelligence/ddos-protection?tenantId=${encodeURIComponent(tenantId)}`
            : `/api/intelligence/ddos-protection?tenantId=demo-tenant-id`;

    const { data, error, isLoading, mutate } = useSWR<DdosProtectionResponse>(apiUrl, fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 30000,
    });

    const isMock =
        data?.mock ??
        (isMockTenant(tenantId) || tenantId.startsWith("demo-") || tenantId.startsWith("mock-"));

    const summary = data?.summary;
    const resources = data?.resources || [];
    const remediations = data?.remediations || [];

    // ── Derived Data ───────────────────────────────────────────────────
    const uniqueRgs = useMemo(
        () => [...new Set(resources.map((r) => r.resourceGroup))].sort(),
        [resources],
    );
    const uniqueSubs = useMemo(
        () => [...new Set(resources.map((r) => r.subscriptionName).filter(Boolean))].sort(),
        [resources],
    );

    const filteredResources = useMemo(() => {
        return resources
            .filter((r) => {
                if (!searchQuery.trim()) return true;
                const q = searchQuery.toLowerCase();
                return (
                    r.name.toLowerCase().includes(q) ||
                    r.resourceGroup.toLowerCase().includes(q) ||
                    (r.publicIpAddress || "").toLowerCase().includes(q) ||
                    r.location.toLowerCase().includes(q)
                );
            })
            .filter((r) => (filterTier === "all" ? true : r.protectionTier === filterTier))
            .filter((r) => (filterRg === "all" ? true : r.resourceGroup === filterRg))
            .filter((r) => (filterSub === "all" ? true : r.subscriptionName === filterSub))
            .sort((a, b) => {
                let cmp = 0;
                switch (sortField) {
                    case "name":
                        cmp = a.name.localeCompare(b.name);
                        break;
                    case "location":
                        cmp = a.location.localeCompare(b.location);
                        break;
                    case "resourceGroup":
                        cmp = a.resourceGroup.localeCompare(b.resourceGroup);
                        break;
                    case "subscriptionName":
                        cmp = (a.subscriptionName || "").localeCompare(b.subscriptionName || "");
                        break;
                    case "monthlyCostUSD":
                        cmp = a.monthlyCostUSD - b.monthlyCostUSD;
                        break;
                    case "protectionTier":
                        cmp = a.protectionTier.localeCompare(b.protectionTier);
                        break;
                    case "status":
                        cmp = a.status.localeCompare(b.status);
                        break;
                }
                return sortOrder === "asc" ? cmp : -cmp;
            });
    }, [resources, searchQuery, filterTier, filterRg, filterSub, sortField, sortOrder]);

    const totalPages = Math.max(1, Math.ceil(filteredResources.length / pageSize));
    const paginatedResources = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredResources.slice(start, start + pageSize);
    }, [filteredResources, currentPage, pageSize]);

    // Donut chart data from breakdown
    const donutData = useMemo(() => {
        if (!summary?.breakdown?.length) return [];
        return summary.breakdown.map((b) => ({
            name: b.tierLabel,
            value: b.costUSD,
            color: b.color,
            count: b.count,
            percentage: b.percentage,
        }));
    }, [summary]);

    // ── Render Helpers ─────────────────────────────────────────────────
    const getResourceIcon = (resource: DdosResourceDetail) => {
        if (resource.resourceType === "DDoS Plan") {
            return <IconShieldLock className="w-4 h-4 text-[#0054A6]" stroke={1.5} />;
        }
        if (resource.protectionTier === "IpProtection") {
            return <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />;
        }
        if (resource.protectionTier === "Basic") {
            return <IconWorld className="w-4 h-4 text-[#0054A6]" stroke={1.5} />;
        }
        return <IconNetwork className="w-4 h-4 text-[#0054A6]" stroke={1.5} />;
    };

    const getStatusBadge = (status: string) => {
        const color = (DDOS_STATUS_COLORS as Record<string, string>)[status] || "#94A3B8";
        const label = (STATUS_LABELS as Record<string, string>)[status] || status;
        const bgMap: Record<string, string> = {
            Protected: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
            UnderAttack: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400",
            Unprotected: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
            Orphan: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
        };
        return (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${bgMap[status] || "bg-slate-100 text-slate-600"}`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
            </span>
        );
    };

    const getTierBadge = (tier: string) => {
        const color = (DDOS_PROTECTION_COLORS as Record<string, string>)[tier] || "#94A3B8";
        const label = (PROTECTION_TIER_LABELS as Record<string, string>)[tier] || tier;
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
            </span>
        );
    };

    // ── Loading State ──────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="p-6 space-y-6 animate-pulse">
                <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-md w-1/3" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                    ))}
                </div>
                <div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-xl" />
            </div>
        );
    }

    // ── Error State ────────────────────────────────────────────────────
    if (error) {
        return (
            <div className="p-6 text-center">
                <IconShieldExclamation className="w-12 h-12 text-red-500 mx-auto mb-3" stroke={1.5} />
                <p className="text-red-600 dark:text-red-400 font-semibold">{t("errorLoading")}</p>
                <p className="text-sm text-slate-500 mt-1">{String(error)}</p>
                <button
                    onClick={() => mutate()}
                    className="mt-4 px-4 py-2 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 rounded-lg hover:bg-blue-50 transition-colors"
                >
                    <IconRefresh className="w-4 h-4 inline mr-1" stroke={1.5} />
                    {t("retry")}
                </button>
            </div>
        );
    }

    // ── Main Render ────────────────────────────────────────────────────
    return (
        <div className="p-6 space-y-6">
            {isMock && <MockBanner />}

            {/* ── KPI Cards ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Costo Mensual DDoS */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                        <IconCash className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("kpiMonthlyCost")}
                        <InfoTooltip content={t("kpiMonthlyCostTooltip")} />
                    </div>
                    <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
                        {format(summary?.totalCostUSD || 0)}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {t("projectedEom")}: {format(summary?.projectedEndOfMonthCostUSD || 0)}
                    </div>
                </div>

                {/* Card 2: Planes & IPs Protegidas */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                        <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("kpiPlansAndIps")}
                        <InfoTooltip content={t("kpiPlansAndIpsTooltip")} />
                    </div>
                    <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
                        {summary?.activePlansCount || 0}{" "}
                        <span className="text-base font-normal text-slate-400">/</span>{" "}
                        {summary?.protectedIpsCount || 0}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {t("plansLabel")} / {t("ipsProtectedLabel")}
                    </div>
                </div>

                {/* Card 3: Ahorro Potencial */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                        <IconSparkles className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("kpiPotentialSavings")}
                        <InfoTooltip content={t("kpiPotentialSavingsTooltip")} />
                    </div>
                    <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {format(summary?.potentialSavingsUSD || 0)}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {summary?.orphanedPlansCount || 0} {t("orphanPlans")}
                    </div>
                </div>

                {/* Card 4: Monitoreo de Amenazas */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                        <IconShieldLock className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("kpiThreatMonitor")}
                        <InfoTooltip content={t("kpiThreatMonitorTooltip")} />
                    </div>
                    <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100">
                        {summary?.activeAttacksCount || 0}{" "}
                        <span className="text-base font-normal text-slate-400">{t("activeAttacks")}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {t("coverage")}: {summary?.coveragePercentage || 0}%
                    </div>
                </div>
            </div>

            {/* ── Donut Chart: Distribución de Protección ────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100 mb-4 flex items-center gap-2">
                        <IconShieldCheck className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("protectionDistribution")}
                        <InfoTooltip content={t("protectionDistributionTooltip")} />
                    </h3>
                    {donutData.length > 0 ? (
                        <>
                            <ResponsiveContainer width="100%" height={280}>
                                <PieChart>
                                    <Pie
                                        data={donutData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={110}
                                        paddingAngle={2}
                                        dataKey="value"
                                    >
                                        {donutData.map((entry, idx) => (
                                            <Cell key={idx} fill={entry.color} stroke="none" />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip
                                        contentStyle={{
                                            backgroundColor: "#1B2A41",
                                            border: "1px solid #475569",
                                            borderRadius: "8px",
                                            color: "#FFFFFF",
                                            fontSize: "11px",
                                        }}
                                        formatter={(_value: any, _name: any, _props: any) => [
                                            `${format(Number(_value ?? 0))} (${_props?.payload?.percentage ?? 0}%)`,
                                            `${_props?.payload?.count ?? 0} ${t("resources")}`,
                                        ]}
                                    />
                                    <Legend
                                        verticalAlign="bottom"
                                        height={36}
                                        formatter={(value: string) => (
                                            <span className="text-xs text-slate-600 dark:text-slate-400">{value}</span>
                                        )}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="flex flex-wrap gap-3 mt-2 justify-center">
                                {donutData.map((entry) => (
                                    <div key={entry.name} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                                        <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                                        {entry.name} ({entry.count})
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
                            {t("noDataAvailable")}
                        </div>
                    )}
                </div>

                {/* ── Remediations Panel ─────────────────────────────── */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100 mb-4 flex items-center gap-2">
                        <IconTrendingDown className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        {t("remediationsTitle")}
                        <InfoTooltip content={t("remediationsTitleTooltip")} />
                    </h3>
                    {remediations.length > 0 ? (
                        <div className="space-y-3 max-h-[350px] overflow-y-auto">
                            {remediations.map((rem) => (
                                <div
                                    key={rem.id}
                                    className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 hover:shadow-md transition-shadow bg-white dark:bg-slate-800/50"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-semibold text-xs text-[#1B2A41] dark:text-slate-100 truncate">
                                                {rem.title}
                                            </h4>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                                                {rem.description}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                                {format(rem.estimatedSavingsUSD)}
                                            </span>
                                            <span className="block text-[10px] text-slate-400">
                                                {rem.confidence === "HIGH" ? "✓ Alta confianza" : rem.confidence === "MEDIUM" ? "~ Media" : "? Baja"}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                            rem.category === "ORPHAN_PLAN"
                                                ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                : rem.category === "ARBITRAGE_IP_PLAN"
                                                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                : rem.category === "DEV_UNLINK"
                                                ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                        }`}>
                                            {rem.category === "ORPHAN_PLAN"
                                                ? t("catOrphanPlan")
                                                : rem.category === "ARBITRAGE_IP_PLAN"
                                                ? t("catArbitrage")
                                                : rem.category === "DEV_UNLINK"
                                                ? t("catDevUnlink")
                                                : t("catEnableIpProtection")}
                                        </span>
                                        <button
                                            onClick={() => setSelectedRemediation(rem)}
                                            className="ml-auto px-2 py-1 text-[11px] bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center gap-1"
                                        >
                                            <IconSparkles size={13} stroke={1.5} className="text-[#0054A6]" />
                                            {t("optimize")}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
                            {t("noRemediations")}
                        </div>
                    )}
                </div>
            </div>

            {/* ── CMP Table: Desglose por Recurso / Plan ─────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
                {/* Header with filters */}
                <div className="p-5 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                        <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                            <IconShieldLock className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                            {t("resourceBreakdown")}
                            <InfoTooltip content={t("resourceBreakdownTooltip")} />
                        </h3>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <IconSearch className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" stroke={1.5} />
                                <input
                                    type="text"
                                    placeholder={t("searchPlaceholder")}
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200 w-56"
                                />
                            </div>
                            <button
                                onClick={() => mutate()}
                                className="p-1.5 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                title={t("refresh")}
                            >
                                <IconRefresh className="w-3.5 h-3.5" stroke={1.5} />
                            </button>
                        </div>
                    </div>

                    {/* Filter row */}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1.5">
                            <IconFilter className="w-3.5 h-3.5 text-slate-400" stroke={1.5} />
                            <select
                                value={filterTier}
                                onChange={(e) => {
                                    setFilterTier(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200"
                            >
                                <option value="all">{t("filterAllTiers")}</option>
                                <option value="NetworkProtection">{t("filterNetworkProtection")}</option>
                                <option value="IpProtection">{t("filterIpProtection")}</option>
                                <option value="Basic">{t("filterBasic")}</option>
                            </select>
                            <select
                                value={filterRg}
                                onChange={(e) => {
                                    setFilterRg(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200 max-w-[180px]"
                            >
                                <option value="all">{t("filterAllRg")}</option>
                                {uniqueRgs.map((rg) => (
                                    <option key={rg} value={rg}>{rg}</option>
                                ))}
                            </select>
                            <select
                                value={filterSub}
                                onChange={(e) => {
                                    setFilterSub(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200 max-w-[200px]"
                            >
                                <option value="all">{t("filterAllSubs")}</option>
                                {uniqueSubs.map((sub) => (
                                    <option key={sub} value={sub}>{sub}</option>
                                ))}
                            </select>
                        </div>
                        <span className="text-[11px] text-slate-400">
                            {filteredResources.length} {t("resourcesFound")}
                        </span>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-xs table-fixed">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                                <ResizableTh minWidth={40}>
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colType")}
                                    </div>
                                </ResizableTh>
                                <ResizableTh
                                    minWidth={140}
                                    onClick={() => {
                                        setSortField("name");
                                        setSortOrder(sortField === "name" && sortOrder === "asc" ? "desc" : "asc");
                                    }}
                                >
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colResource")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh minWidth={100}>
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colProtectionTier")}
                                        <InfoTooltip content={t("colProtectionTierTooltip")} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh minWidth={70}>
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colVnetsIps")}
                                    </div>
                                </ResizableTh>
                                <ResizableTh
                                    minWidth={90}
                                    onClick={() => {
                                        setSortField("status");
                                        setSortOrder(sortField === "status" && sortOrder === "asc" ? "desc" : "asc");
                                    }}
                                >
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colStatus")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh
                                    minWidth={110}
                                    onClick={() => {
                                        setSortField("resourceGroup");
                                        setSortOrder(sortField === "resourceGroup" && sortOrder === "asc" ? "desc" : "asc");
                                    }}
                                >
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colResourceGroup")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh
                                    minWidth={130}
                                    onClick={() => {
                                        setSortField("subscriptionName");
                                        setSortOrder(sortField === "subscriptionName" && sortOrder === "asc" ? "desc" : "asc");
                                    }}
                                >
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colSubscription")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh
                                    minWidth={90}
                                    onClick={() => {
                                        setSortField("monthlyCostUSD");
                                        setSortOrder(sortField === "monthlyCostUSD" && sortOrder === "asc" ? "desc" : "asc");
                                    }}
                                >
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colMonthlyCost")}
                                        <IconArrowsSort className="w-3 h-3 text-slate-400" stroke={1.5} />
                                    </div>
                                </ResizableTh>
                                <ResizableTh minWidth={80}>
                                    <div className="flex items-center gap-1 px-2">
                                        {t("colActions")}
                                    </div>
                                </ResizableTh>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedResources.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="py-8 text-center text-slate-400">
                                        {t("noResources")}
                                    </td>
                                </tr>
                            ) : (
                                paginatedResources.map((res) => (
                                    <tr
                                        key={res.id}
                                        className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                                    >
                                        <td className="py-2.5 px-2">
                                            <div className="flex justify-center">
                                                {getResourceIcon(res)}
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-2">
                                            <div className="font-medium text-[#1B2A41] dark:text-slate-200 truncate">
                                                {res.name}
                                            </div>
                                            {res.isOrphan && (
                                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                                    ⚠ {t("orphanBadge")}
                                                </span>
                                            )}
                                            {res.publicIpAddress && (
                                                <div className="text-[10px] text-slate-400 font-mono truncate">
                                                    {res.publicIpAddress}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-2">{getTierBadge(res.protectionTier)}</td>
                                        <td className="py-2.5 px-2 text-center font-mono text-[#1B2A41] dark:text-slate-200">
                                            {res.resourceType === "DDoS Plan"
                                                ? `${res.associatedVnetsCount} / ${res.protectedIpsCount}`
                                                : res.protectedIpsCount}
                                        </td>
                                        <td className="py-2.5 px-2">{getStatusBadge(res.status)}</td>
                                        <td className="py-2.5 px-2 text-slate-500 truncate">{res.resourceGroup}</td>
                                        <td className="py-2.5 px-2 text-slate-500 truncate">{res.subscriptionName}</td>
                                        <td className="py-2.5 px-2 font-mono font-semibold text-[#1B2A41] dark:text-slate-200">
                                            {format(res.monthlyCostUSD)}
                                        </td>
                                        <td className="py-2.5 px-2">
                                            {res.isOrphan || (res.protectionTier === "NetworkProtection" && res.resourceType === "DDoS Plan" && res.protectedIpsCount < 15 && res.protectedIpsCount > 0) ? (
                                                <button
                                                    onClick={() => {
                                                        const rem = remediations.find(
                                                            (r) => r.resourceId === res.id,
                                                        );
                                                        if (rem) setSelectedRemediation(rem);
                                                    }}
                                                    className="px-2 py-1 text-[10px] bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors whitespace-nowrap flex items-center gap-1"
                                                >
                                                    <IconSparkles size={12} stroke={1.5} className="text-[#0054A6]" />
                                                    {t("optimize")}
                                                </button>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {filteredResources.length > 0 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{t("perPage")}</span>
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 bg-white dark:bg-slate-800 text-xs"
                            >
                                {[15, 30, 45, 60].map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                            <span>
                                {t("paginationShowing", {
                                    from: (currentPage - 1) * pageSize + 1,
                                    to: Math.min(currentPage * pageSize, filteredResources.length),
                                    total: filteredResources.length,
                                })}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                            >
                                <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                            </button>
                            <span className="text-xs text-slate-500 px-2">
                                {t("page", { current: currentPage, total: totalPages })}
                            </span>
                            <button
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
                            >
                                <IconChevronRight className="w-4 h-4" stroke={1.5} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Remediation Detail Modal ───────────────────────────── */}
            {selectedRemediation && (
                <>
                    <div
                        className="fixed inset-0 bg-black/50 z-50"
                        onClick={() => setSelectedRemediation(null)}
                    />
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
                            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                                <h3 className="font-semibold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                                    <IconSparkles className="w-5 h-5 text-[#0054A6]" stroke={1.5} />
                                    {t("remediationDetail")}
                                </h3>
                                <button
                                    onClick={() => setSelectedRemediation(null)}
                                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                    <IconX className="w-4 h-4 text-slate-400" stroke={1.5} />
                                </button>
                            </div>
                            <div className="p-5 space-y-4">
                                <div>
                                    <h4 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">
                                        {selectedRemediation.title}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        {selectedRemediation.description}
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                                        <span className="text-[10px] text-slate-400">{t("estimatedSavings")}</span>
                                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                                            {format(selectedRemediation.estimatedSavingsUSD)}
                                        </p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                                        <span className="text-[10px] text-slate-400">{t("confidence")}</span>
                                        <p className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
                                            {selectedRemediation.confidence === "HIGH"
                                                ? "Alta ✓"
                                                : selectedRemediation.confidence === "MEDIUM"
                                                ? "Media ~"
                                                : "Baja ?"}
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                                        {t("impactSummary")}
                                    </span>
                                    <p className="text-xs text-[#1B2A41] dark:text-slate-200 mt-1 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                                        {selectedRemediation.commandPayload.impactSummary}
                                    </p>
                                </div>

                                <div>
                                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                                        Azure CLI
                                    </span>
                                    <pre className="text-[11px] bg-slate-900 text-green-400 rounded-lg p-3 mt-1 overflow-x-auto whitespace-pre-wrap">
                                        {selectedRemediation.commandPayload.cli}
                                    </pre>
                                </div>

                                <div>
                                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                                        PowerShell
                                    </span>
                                    <pre className="text-[11px] bg-slate-900 text-green-400 rounded-lg p-3 mt-1 overflow-x-auto whitespace-pre-wrap">
                                        {selectedRemediation.commandPayload.powershell}
                                    </pre>
                                </div>
                            </div>
                            <div className="p-5 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                                <button
                                    onClick={() => setSelectedRemediation(null)}
                                    className="px-4 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                    {t("close")}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

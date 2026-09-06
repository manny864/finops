"use client";

import React, { useState, useMemo, useEffect } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import {
    BasicNetworkResource,
    BasicNetworkRemediationAction,
    BasicNetworkingResponse,
    BasicNetworkServiceType,
    BASIC_NETWORK_COLORS,
} from "@/types/basicNetworking.types";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import MockBanner from "@/components/MockBanner";
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    Legend,
} from "recharts";
import {
    IconNetwork,
    IconTopologyStarRing3,
    IconWorldWww,
    IconShieldCheck,
    IconRoute,
    IconCurrencyDollar,
    IconLayersLinked,
    IconAlertTriangle,
    IconLockSquareRounded,
    IconRefresh,
    IconSearch,
    IconCopy,
    IconCheck,
    IconX,
    IconTerminal2,
    IconChevronLeft,
    IconChevronRight,
    IconArrowsSort,
    IconArrowsExchange,
    IconArrowRight,
    IconShieldExclamation,
    IconServer,
    IconEye,
} from "@tabler/icons-react";

export default function BasicNetworkingFinopsDashboard() {
    const t = useTranslations("BasicNetworkingFinops");
    const { selectedTenant } = useTenant();
    const { format } = useCurrency();
    const { instance, accounts: msalAccounts } = useMsal();
    const tenantId = selectedTenant?.id || "demo-tenant-id";

    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);

    const fetcher = async (url: string) => {
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

    const swrKey = tenantId && tenantId !== "default"
        ? `/api/intelligence/network/basic?tenantId=${tenantId}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<BasicNetworkingResponse>(
        swrKey,
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 60000 }
    );

    // Filters State
    const [searchTerm, setSearchTerm] = useState("");
    const [serviceFilter, setServiceFilter] = useState<string>("all");
    const [resourceGroupFilter, setResourceGroupFilter] = useState<string>("all");
    const [subscriptionFilter, setSubscriptionFilter] = useState<string>("all");
    const [sortBy, setSortBy] = useState<"cost_desc" | "cost_asc" | "name_asc" | "name_desc" | "service_asc">("cost_desc");

    // Pagination State
    const [pageSize, setPageSize] = useState<15 | 30 | 45 | 60>(15);
    const [currentPage, setCurrentPage] = useState(1);

    // Modal / Drawer State
    const [selectedResource, setSelectedResource] = useState<BasicNetworkResource | null>(null);
    const [activeRemediation, setActiveRemediation] = useState<BasicNetworkRemediationAction | null>(null);
    const [activeScriptTab, setActiveScriptTab] = useState<"cli" | "ps">("cli");
    const [copied, setCopied] = useState(false);

    const resources = useMemo(() => data?.resources || [], [data]);
    const kpis = data?.kpis;
    const remediations = useMemo(() => data?.remediations || [], [data]);

    // Clean Filter Options (no anomalous '0' prefix or suffix)
    const serviceOptions = useMemo(() => {
        return ["all", ...Array.from(new Set(resources.map((r) => r.serviceType))).filter(Boolean)];
    }, [resources]);

    const resourceGroupOptions = useMemo(() => {
        return ["all", ...Array.from(new Set(resources.map((r) => r.resourceGroup))).filter(Boolean).sort()];
    }, [resources]);

    const subscriptionOptions = useMemo(() => {
        return ["all", ...Array.from(new Set(resources.map((r) => r.subscriptionName))).filter(Boolean).sort()];
    }, [resources]);

    // Filtered & Sorted Resources
    const filteredResources = useMemo(() => {
        return resources
            .filter((r) => {
                const matchesSearch =
                    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    r.cidrOrPrivateIp.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    r.resourceGroup.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    r.subscriptionName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    r.costCenterOwner.toLowerCase().includes(searchTerm.toLowerCase());

                const matchesService = serviceFilter === "all" || r.serviceType === serviceFilter;
                const matchesRg = resourceGroupFilter === "all" || r.resourceGroup === resourceGroupFilter;
                const matchesSub = subscriptionFilter === "all" || r.subscriptionName === subscriptionFilter;

                return matchesSearch && matchesService && matchesRg && matchesSub;
            })
            .sort((a, b) => {
                if (sortBy === "cost_desc") return b.monthlyCostUSD - a.monthlyCostUSD;
                if (sortBy === "cost_asc") return a.monthlyCostUSD - b.monthlyCostUSD;
                if (sortBy === "name_asc") return a.name.localeCompare(b.name);
                if (sortBy === "name_desc") return b.name.localeCompare(a.name);
                if (sortBy === "service_asc") return a.serviceType.localeCompare(b.serviceType);
                return 0;
            });
    }, [resources, searchTerm, serviceFilter, resourceGroupFilter, subscriptionFilter, sortBy]);

    // Pagination calculations
    const totalPages = Math.max(1, Math.ceil(filteredResources.length / pageSize));
    const paginatedResources = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredResources.slice(start, start + pageSize);
    }, [filteredResources, currentPage, pageSize]);

    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [currentPage, totalPages]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getServiceIcon = (serviceType: BasicNetworkServiceType) => {
        switch (serviceType) {
            case "Virtual Networks":
                return <IconNetwork className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            case "Private Endpoints":
                return <IconTopologyStarRing3 className="w-4 h-4 text-[#2563EB] shrink-0" stroke={1.5} />;
            case "Private DNS Zones":
                return <IconWorldWww className="w-4 h-4 text-[#38BDF8] shrink-0" stroke={1.5} />;
            case "Network Security Group":
                return <IconShieldCheck className="w-4 h-4 text-[#93C5FD] shrink-0" stroke={1.5} />;
            case "Route Table":
                return <IconRoute className="w-4 h-4 text-[#60A5FA] shrink-0" stroke={1.5} />;
            default:
                return <IconNetwork className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
        }
    };

    if (isLoading) {
        return (
            <div className="p-6 w-full flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-[#0054A6] rounded-full animate-spin mb-4" />
                    <p className="text-slate-600 dark:text-slate-400 font-semibold">{t("loading")}</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 w-full">
                <MockBanner />
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-red-200 dark:border-red-900/50 p-8 text-center">
                    <IconAlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" stroke={1.5} />
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t("emptyStateTitle")}</h2>
                    <p className="text-slate-600 dark:text-slate-400">{error.message}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 w-full animate-in fade-in duration-500 space-y-6">
            <MockBanner />

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2.5">
                        <IconTopologyStarRing3 className="w-7 h-7 text-[#0078D4] shrink-0" stroke={1.5} />
                        <span>{t("title")}</span>
                        <InfoTooltip content={t("tooltip_title")} position="bottom" align="left" />
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-3xl">
                        {t("subtitle")}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => mutate()}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-xs"
                    >
                        <IconRefresh className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        <span>{t("btnRefresh")}</span>
                    </button>
                </div>
            </div>

            {/* 4 KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Total Cost MTD */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            <span className="flex items-center gap-1.5">
                                <IconCurrencyDollar className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                                {t("kpiTotalCostTitle")}
                            </span>
                            <InfoTooltip content={t("kpiTotalCostTooltip")} position="bottom" align="right" />
                        </div>
                        <div className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white">
                            {format(kpis?.totalCostUSD || 0)}
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                        <span>{t("kpiProjected")}</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {format(kpis?.projectedEndOfMonthCostUSD || 0)}
                        </span>
                    </div>
                </div>

                {/* Card 2: Detected Resources */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            <span className="flex items-center gap-1.5">
                                <IconLayersLinked className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                                {t("kpiDetectedResourcesTitle")}
                            </span>
                            <InfoTooltip content={t("kpiDetectedResourcesTooltip")} position="bottom" align="right" />
                        </div>
                        <div className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white">
                            {kpis?.totalResourcesCount || 0}
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {kpis?.virtualNetworksCount || 0} VNets, {kpis?.privateEndpointsCount || 0} PEs, {kpis?.privateDnsZonesCount || 0} DNS, {kpis?.nsgUdrCount || 0} NSG/UDR
                    </div>
                </div>

                {/* Card 3: Network Hygiene (Orphans) */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            <span className="flex items-center gap-1.5">
                                <IconShieldExclamation className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                                {t("kpiHygieneTitle")}
                            </span>
                            <InfoTooltip content={t("kpiHygieneTooltip")} position="bottom" align="right" />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white">
                                {kpis?.orphanedResourcesCount || 0}
                            </span>
                            {kpis?.orphanedResourcesCount && kpis.orphanedResourcesCount > 0 ? (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                                    {t("reviewRequired")}
                                </span>
                            ) : (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60">
                                    {t("kpiHealthy")}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                        {kpis?.orphanedResourcesCount && kpis.orphanedResourcesCount > 0
                            ? `${kpis.orphanedResourcesCount} ${t("kpiOrphanWarning")}`
                            : "0 NSGs/UDRs huérfanos"}
                    </div>
                </div>

                {/* Card 4: Private Endpoints & DNS */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            <span className="flex items-center gap-1.5">
                                <IconLockSquareRounded className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                                {t("kpiPrivateLinksTitle")}
                            </span>
                            <InfoTooltip content={t("kpiPrivateLinksTooltip")} position="bottom" align="right" />
                        </div>
                        <div className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white">
                            {(kpis?.privateEndpointsCount || 0) + (kpis?.privateDnsZonesCount || 0)}
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                        {kpis?.privateEndpointsCount || 0} Endpoints Privados + {kpis?.privateDnsZonesCount || 0} Zonas DNS
                    </div>
                </div>
            </div>

            {/* Distribution Chart (Donut Chart in Strict Blue Scale) */}
            {isMounted && kpis?.breakdown && kpis.breakdown.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-6">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                            <IconNetwork className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                            <span>{t("chartTitle")}</span>
                            <InfoTooltip content={t("chartTooltip")} position="bottom" align="left" />
                        </h3>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        <div className="lg:col-span-6 h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={kpis.breakdown}
                                        dataKey="costUSD"
                                        nameKey="serviceLabel"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={65}
                                        outerRadius={105}
                                        paddingAngle={3}
                                    >
                                        {kpis.breakdown.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color || BASIC_NETWORK_COLORS[entry.serviceName] || "#0078D4"} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const dataItem = payload[0].payload;
                                                return (
                                                    <div className="bg-[#1B2A41] text-white p-3 rounded-lg shadow-2xl border border-slate-700 text-xs z-[9999]">
                                                        <p className="font-bold text-sm mb-1">{dataItem.serviceLabel}</p>
                                                        <p className="text-slate-300">{t("costMtdLabel")} <span className="text-white font-semibold">{format(dataItem.costUSD)}</span></p>
                                                        <p className="text-slate-300">{t("resourcesLabel")} <span className="text-white font-semibold">{dataItem.count}</span></p>
                                                        <p className="text-slate-300">{t("shareLabel")} <span className="text-sky-300 font-semibold">{dataItem.percentage}%</span></p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Legend
                                        verticalAlign="bottom"
                                        height={36}
                                        formatter={(value) => <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{value}</span>}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Interactive Legend with Share of Wallet */}
                        <div className="lg:col-span-6 space-y-2.5">
                            {kpis.breakdown.map((item, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                                >
                                    <div className="flex items-center gap-3">
                                        <span
                                            className="w-3.5 h-3.5 rounded-full shrink-0"
                                            style={{ backgroundColor: item.color || BASIC_NETWORK_COLORS[item.serviceName] || "#0078D4" }}
                                        />
                                        <div>
                                            <p className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                                                {item.serviceLabel}
                                            </p>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                {item.count} recursos inventariados
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-extrabold text-[#1B2A41] dark:text-white">
                                            {format(item.costUSD)}
                                        </p>
                                        <p className="text-[11px] font-semibold text-[#0078D4] dark:text-sky-400">
                                            {item.percentage}% {t("shareOfWallet")}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Filters Bar (Fixed without anomalous '0' prefix) */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Search */}
                    <div>
                        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                            BÚSQUEDA
                        </label>
                        <div className="relative">
                            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" stroke={1.5} />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder={t("searchPlaceholder")}
                                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>
                    </div>

                    {/* Filter Service */}
                    <div>
                        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                            {t("filterService")}
                        </label>
                        <select
                            value={serviceFilter}
                            onChange={(e) => {
                                setServiceFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full py-1.5 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value="all">{t("allOption")}</option>
                            {serviceOptions.filter((opt) => opt !== "all").map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>

                    {/* Filter Resource Group */}
                    <div>
                        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                            {t("filterResourceGroup")}
                        </label>
                        <select
                            value={resourceGroupFilter}
                            onChange={(e) => {
                                setResourceGroupFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full py-1.5 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value="all">{t("allOption")}</option>
                            {resourceGroupOptions.filter((opt) => opt !== "all").map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>

                    {/* Filter Subscription */}
                    <div>
                        <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                            {t("filterSubscription")}
                        </label>
                        <select
                            value={subscriptionFilter}
                            onChange={(e) => {
                                setSubscriptionFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full py-1.5 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value="all">{t("allOption")}</option>
                            {subscriptionOptions.filter((opt) => opt !== "all").map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Table Desglose por Servicio */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                        <span>{t("tableTitle")}</span>
                        <InfoTooltip content={t("tableTooltip")} position="bottom" align="left" />
                    </h3>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        {filteredResources.length} de {resources.length} recursos mostrados
                    </div>
                </div>

                <div className="overflow-x-auto w-full">
                    <table className="w-full text-left border-collapse table-fixed">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40">
                                <ResizableTh minWidth={160} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colService")}</span>
                                        <InfoTooltip content={t("colService")} position="bottom" align="left" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh minWidth={200} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase cursor-pointer" onClick={() => setSortBy(sortBy === "name_asc" ? "name_desc" : "name_asc")}>
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colResourceName")}</span>
                                        <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" stroke={1.5} />
                                        <InfoTooltip content={t("colResourceName")} position="bottom" align="left" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh minWidth={170} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colCidrOrIp")}</span>
                                        <InfoTooltip content={t("colCidrOrIp")} position="bottom" align="left" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh minWidth={150} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colResourceGroup")}</span>
                                        <InfoTooltip content={t("colResourceGroup")} position="bottom" align="left" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh minWidth={160} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colSubscription")}</span>
                                        <InfoTooltip content={t("colSubscription")} position="bottom" align="left" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh minWidth={130} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colCostCenter")}</span>
                                        <InfoTooltip content={t("colCostCenter")} position="bottom" align="left" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh minWidth={120} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colSubnetsLinks")}</span>
                                        <InfoTooltip content={t("colSubnetsLinks")} position="bottom" align="left" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh minWidth={130} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase text-right cursor-pointer" onClick={() => setSortBy(sortBy === "cost_desc" ? "cost_asc" : "cost_desc")}>
                                    <div className="inline-flex items-center justify-end gap-1 w-full">
                                        <span>{t("colMonthlyCost")}</span>
                                        <IconArrowsSort className="w-3.5 h-3.5 text-slate-400" stroke={1.5} />
                                        <InfoTooltip content={t("colMonthlyCost")} position="bottom" align="right" />
                                    </div>
                                </ResizableTh>

                                <th className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase text-center w-[130px]">
                                    <span>{t("colActions")}</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                            {paginatedResources.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="py-8 text-center text-slate-500 dark:text-slate-400">
                                        {t("emptyFiltered")}
                                    </td>
                                </tr>
                            ) : (
                                paginatedResources.map((res) => (
                                    <tr key={res.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="py-3 px-3.5 font-semibold text-slate-800 dark:text-slate-200">
                                            <div className="flex items-center gap-2">
                                                {getServiceIcon(res.serviceType)}
                                                <span className="truncate">{res.serviceLabel}</span>
                                            </div>
                                        </td>

                                        <td className="py-3 px-3.5 font-medium text-slate-900 dark:text-white">
                                            <div className="flex flex-col">
                                                <span className="truncate font-semibold text-[#1B2A41] dark:text-slate-100" title={res.name}>
                                                    {res.name}
                                                </span>
                                                {res.isOrphan && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                                                        <IconAlertTriangle className="w-3 h-3 text-amber-500 shrink-0" stroke={1.5} />
                                                        {res.orphanReason ? res.orphanReason.slice(0, 45) + "..." : t("badgeOrphan")}
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                                            <span className="truncate block" title={res.cidrOrPrivateIp}>
                                                {res.cidrOrPrivateIp}
                                            </span>
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400">
                                            <span className="truncate block" title={res.resourceGroup}>
                                                {res.resourceGroup}
                                            </span>
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400">
                                            <span className="truncate block font-medium" title={res.subscriptionName}>
                                                {res.subscriptionName}
                                            </span>
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400">
                                            <span className="truncate block">{res.costCenterOwner}</span>
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300">
                                            {res.serviceType === "Virtual Networks" && (
                                                <span className="font-semibold">{res.subnetsCount} subredes</span>
                                            )}
                                            {res.serviceType === "Private DNS Zones" && (
                                                <span className="font-semibold">{res.linkedVnetsCount} VNets</span>
                                            )}
                                            {res.serviceType === "Private Endpoints" && (
                                                <span className="text-slate-500">1 endpoint</span>
                                            )}
                                            {(res.serviceType === "Network Security Group" || res.serviceType === "Route Table") && (
                                                <span className={res.subnetsCount > 0 ? "text-slate-700 dark:text-slate-300 font-semibold" : "text-amber-600 font-bold"}>
                                                    {res.subnetsCount > 0 ? `${res.subnetsCount} asignadas` : "0 (Huérfano)"}
                                                </span>
                                            )}
                                        </td>

                                        <td className="py-3 px-3.5 text-right font-extrabold text-[#0054A6] dark:text-sky-400">
                                            {format(res.monthlyCostUSD)}
                                        </td>

                                        <td className="py-3 px-3.5 text-center">
                                            <button
                                                onClick={() => setSelectedResource(res)}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-2xs whitespace-nowrap"
                                            >
                                                <IconEye className="w-3.5 h-3.5 text-[#0054A6] shrink-0" stroke={1.5} />
                                                <span>Detalles</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <span>{t("perPage")}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value) as 15 | 30 | 45 | 60);
                                setCurrentPage(1);
                            }}
                            className="py-1 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                        >
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                        <span className="ml-2">
                            {t("paginationShowing", {
                                from: filteredResources.length === 0 ? 0 : (currentPage - 1) * pageSize + 1,
                                to: Math.min(currentPage * pageSize, filteredResources.length),
                                total: filteredResources.length,
                            })}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                            title={t("previous")}
                        >
                            <IconChevronLeft className="w-4 h-4" stroke={1.5} />
                        </button>
                        <span>{t("page", { current: currentPage, total: totalPages })}</span>
                        <button
                            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                            title={t("next")}
                        >
                            <IconChevronRight className="w-4 h-4" stroke={1.5} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Prioritized Recommendations Section */}
            {remediations.length > 0 && (
                <div className="space-y-4">
                    <div className="border-b border-slate-200 dark:border-slate-800 pb-2">
                        <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                            <IconShieldCheck className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                            <span>{t("remediationsTitle")}</span>
                            <InfoTooltip content={t("remediationsTooltip")} position="bottom" align="left" />
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("remediationsSubtitle")}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {remediations.map((rem) => (
                            <div
                                key={rem.id}
                                className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between hover:border-blue-300 dark:hover:border-blue-800 transition-all"
                            >
                                <div>
                                    <div className="flex items-start justify-between gap-3 mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#0078D4]">
                                                {rem.category === "ORPHAN_NSG" && <IconShieldCheck className="w-4 h-4" stroke={1.5} />}
                                                {rem.category === "UNUSED_UDR" && <IconRoute className="w-4 h-4" stroke={1.5} />}
                                                {rem.category === "EMPTY_VNET" && <IconNetwork className="w-4 h-4" stroke={1.5} />}
                                                {rem.category === "PE_OPTIMIZATION" && <IconTopologyStarRing3 className="w-4 h-4" stroke={1.5} />}
                                            </span>
                                            <span className="text-xs font-bold text-[#1B2A41] dark:text-white line-clamp-1">
                                                {rem.title}
                                            </span>
                                        </div>
                                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-[#0054A6] dark:text-sky-400 border border-blue-200 dark:border-blue-900">
                                            {rem.confidence}
                                        </span>
                                    </div>

                                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                        {rem.description}
                                    </p>

                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 mb-4">
                                        <span className="font-semibold text-slate-700 dark:text-slate-300">Impacto: </span>
                                        {rem.commandPayload.impactSummary}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                                    <div>
                                        {rem.estimatedSavingsUSD > 0 ? (
                                            <div>
                                                <span className="text-[10px] uppercase font-bold text-slate-400">{t("colEstimatedSavings")}</span>
                                                <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                                                    {format(rem.estimatedSavingsUSD)}/mes
                                                </p>
                                            </div>
                                        ) : (
                                            <div>
                                                <span className="text-[10px] uppercase font-bold text-slate-400">Objetivo</span>
                                                <p className="text-xs font-bold text-[#0078D4]">
                                                    Higiene & Seguridad
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        onClick={() => {
                                            setActiveRemediation(rem);
                                            setActiveScriptTab("cli");
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                                    >
                                        <span>{t("btnExecuteRemediation")}</span>
                                        <IconArrowRight className="w-3.5 h-3.5" stroke={1.5} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Topology Detail Modal (Strict Z-Index Layering: z-50 / z-[100]) */}
            {selectedResource && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto z-50 p-6 space-y-5">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2.5">
                                {getServiceIcon(selectedResource.serviceType)}
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white">
                                        {selectedResource.name}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {selectedResource.serviceLabel} • {selectedResource.resourceGroup}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedResource(null)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <IconX className="w-5 h-5" stroke={1.5} />
                            </button>
                        </div>

                        {/* Resource Metadata Overview */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800">
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{t("colSubscription")}</span>
                                <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{selectedResource.subscriptionName}</p>
                            </div>
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Direccionamiento / CIDR</span>
                                <p className="font-semibold text-slate-800 dark:text-slate-200 font-mono text-[11px] truncate">{selectedResource.cidrOrPrivateIp}</p>
                            </div>
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{t("colMonthlyCostMtd")}</span>
                                <p className="font-extrabold text-[#0054A6] dark:text-sky-400">{format(selectedResource.monthlyCostUSD)}</p>
                            </div>
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{t("colOwnerCostCenter")}</span>
                                <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{selectedResource.costCenterOwner}</p>
                            </div>
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{t("colRegionLocation")}</span>
                                <p className="font-semibold text-slate-800 dark:text-slate-200 uppercase">{selectedResource.location}</p>
                            </div>
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{t("colStatus")}</span>
                                <p className="font-semibold text-slate-800 dark:text-slate-200">
                                    {selectedResource.isOrphan ? (
                                        <span className="text-amber-600 font-bold">{t("badgeOrphan")}</span>
                                    ) : (
                                        <span className="text-emerald-600 font-bold">{t("badgeHealthy")}</span>
                                    )}
                                </p>
                            </div>
                        </div>

                        {/* Specific Subnet List for VNets */}
                        {selectedResource.serviceType === "Virtual Networks" && selectedResource.details?.subnets && (
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    Subredes Configuradas ({selectedResource.details.subnets.length})
                                </h4>
                                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                    {selectedResource.details.subnets.length === 0 ? (
                                        <p className="text-xs text-slate-500 italic">{t("emptySubnets")}</p>
                                    ) : (
                                        selectedResource.details.subnets.map((subnet, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs">
                                                <div className="flex items-center gap-2">
                                                    <IconServer className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                                                    <span className="font-semibold text-slate-800 dark:text-slate-200">{subnet.name}</span>
                                                    <span className="font-mono text-[11px] text-slate-500">({subnet.addressPrefix})</span>
                                                </div>
                                                <span className="text-[11px] text-slate-500">
                                                    {subnet.connectedDevicesCount || 0} dispositivos
                                                </span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Peering Links for VNets */}
                        {selectedResource.serviceType === "Virtual Networks" && selectedResource.details?.peerings && selectedResource.details.peerings.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    VNet Peerings ({selectedResource.details.peerings.length})
                                </h4>
                                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                                    {selectedResource.details.peerings.map((peering, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs">
                                            <div className="flex items-center gap-2">
                                                <IconArrowsExchange className="w-3.5 h-3.5 text-blue-500" stroke={1.5} />
                                                <span className="font-semibold text-slate-800 dark:text-slate-200">{peering.name}</span>
                                                <span className="text-slate-500">→ {peering.remoteVirtualNetworkName}</span>
                                            </div>
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">
                                                {peering.peeringState}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Target Service & DNS for Private Endpoints */}
                        {selectedResource.serviceType === "Private Endpoints" && (
                            <div className="space-y-2 text-xs">
                                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    {t("targetAndPrivateDns")}
                                </h4>
                                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1.5">
                                    <p className="text-slate-700 dark:text-slate-300">
                                        <span className="font-semibold">Servicio Enlazado: </span>
                                        {selectedResource.details?.targetResourceName || selectedResource.targetResourceId || "-"}
                                    </p>
                                    <p className="text-slate-700 dark:text-slate-300">
                                        <span className="font-semibold">IP Privada: </span>
                                        <span className="font-mono">{selectedResource.cidrOrPrivateIp}</span>
                                    </p>
                                    <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                                        {selectedResource.costBreakdownReason}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Modal Footer */}
                        <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={() => setSelectedResource(null)}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors"
                            >
                                {t("btnClose")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Remediation Script Modal (Strict Z-Index Layering: z-50 / z-[100]) */}
            {activeRemediation && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full z-50 p-6 space-y-5">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2.5">
                                <IconTerminal2 className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white">
                                        {t("modalRemediationTitle")}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {activeRemediation.title}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setActiveRemediation(null)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <IconX className="w-5 h-5" stroke={1.5} />
                            </button>
                        </div>

                        <div className="text-xs text-slate-600 dark:text-slate-400 bg-blue-50/60 dark:bg-blue-950/30 p-3.5 rounded-xl border border-blue-100 dark:border-blue-900/60">
                            <span className="font-bold text-[#0054A6] dark:text-sky-300">Resumen Operacional: </span>
                            {activeRemediation.commandPayload.impactSummary}
                        </div>

                        {/* Script Tabs */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setActiveScriptTab("cli")}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                                            activeScriptTab === "cli"
                                                ? "bg-[#0054A6] text-white"
                                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                                        }`}
                                    >
                                        {t("tabCli")}
                                    </button>
                                    <button
                                        onClick={() => setActiveScriptTab("ps")}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                                            activeScriptTab === "ps"
                                                ? "bg-[#0054A6] text-white"
                                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                                        }`}
                                    >
                                        {t("tabPs")}
                                    </button>
                                </div>

                                <button
                                    onClick={() =>
                                        copyToClipboard(
                                            activeScriptTab === "cli"
                                                ? activeRemediation.commandPayload.cli
                                                : activeRemediation.commandPayload.powershell
                                        )
                                    }
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#10B981] text-[#10B981] hover:bg-emerald-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                                >
                                    {copied ? (
                                        <>
                                            <IconCheck className="w-3.5 h-3.5" stroke={2} />
                                            <span>{t("btnCopied")}</span>
                                        </>
                                    ) : (
                                        <>
                                            <IconCopy className="w-3.5 h-3.5" stroke={1.5} />
                                            <span>{t("btnCopyScript")}</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800">
                                <code>
                                    {activeScriptTab === "cli"
                                        ? activeRemediation.commandPayload.cli
                                        : activeRemediation.commandPayload.powershell}
                                </code>
                            </pre>
                        </div>

                        {/* Modal Footer */}
                        <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={() => setActiveRemediation(null)}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors"
                            >
                                {t("btnClose")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import {
    HybridNetworkResource,
    HybridRemediationAction,
    HybridConnectivityResponse,
    HybridNetworkServiceType,
    HYBRID_NETWORK_COLORS,
} from "@/types/hybridConnectivity.types";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import MockBanner from "@/components/MockBanner";
import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
} from "recharts";
import {
    IconNetwork,
    IconTopologyStarRing3,
    IconArrowsSplit,
    IconCurrencyDollar,
    IconLayersLinked,
    IconAlertTriangle,
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
    IconCloudUpload,
} from "@tabler/icons-react";

import { getFreshIdToken } from "@/lib/msalToken";

export default function HybridConnectivityFinopsDashboard() {
    const t = useTranslations("HybridConnectivityFinops");
    const { selectedTenant } = useTenant();
    const { format } = useCurrency();
    const { instance, accounts: msalAccounts } = useMsal();
    const tenantId = selectedTenant?.id || "demo-tenant-id";

    // Filtering, sorting and pagination states
    const [selectedService, setSelectedService] = useState<string>("all");
    const [selectedRg, setSelectedRg] = useState<string>("all");
    const [selectedSub, setSelectedSub] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [sortField, setSortField] = useState<"name" | "cost" | "service">("cost");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Modals
    const [selectedResource, setSelectedResource] = useState<HybridNetworkResource | null>(null);
    const [activeRemediation, setActiveRemediation] = useState<HybridRemediationAction | null>(null);
    const [activeScriptTab, setActiveScriptTab] = useState<"cli" | "ps">("cli");
    const [copiedScript, setCopiedScript] = useState<boolean>(false);

    // Fetcher for SWR
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
        return res.json() as Promise<HybridConnectivityResponse>;
    };

    const apiUrl = tenantId && tenantId !== "default"
        ? `/api/intelligence/network/hybrid?tenantId=${encodeURIComponent(tenantId)}`
        : `/api/intelligence/network/hybrid?tenantId=demo-tenant-id`;

    const { data, error, isLoading, mutate } = useSWR<HybridConnectivityResponse>(apiUrl, fetcher, {
        revalidateOnFocus: false,
        dedupingInterval: 30000,
    });

    const isMock = data?.mock ?? (isMockTenant(tenantId) || tenantId.startsWith("demo-") || tenantId.startsWith("mock-"));
    const kpis = data?.kpis;
    const resources = data?.resources || [];
    const remediations = data?.remediations || [];

    // Filter Options
    const serviceOptions = useMemo(() => {
        const set = new Set<string>();
        resources.forEach((r) => set.add(r.serviceType));
        return ["all", ...Array.from(set)];
    }, [resources]);

    const rgOptions = useMemo(() => {
        const set = new Set<string>();
        resources.forEach((r) => set.add(r.resourceGroup));
        return ["all", ...Array.from(set)];
    }, [resources]);

    const subscriptionOptions = useMemo(() => {
        const set = new Set<string>();
        resources.forEach((r) => set.add(r.subscriptionName || r.subscriptionId));
        return ["all", ...Array.from(set)];
    }, [resources]);

    // Filtered and Sorted Resources
    const filteredResources = useMemo(() => {
        return resources
            .filter((res) => {
                if (selectedService !== "all" && res.serviceType !== selectedService) return false;
                if (selectedRg !== "all" && res.resourceGroup !== selectedRg) return false;
                const subMatch = res.subscriptionName || res.subscriptionId;
                if (selectedSub !== "all" && subMatch !== selectedSub) return false;
                if (searchQuery.trim() !== "") {
                    const q = searchQuery.toLowerCase();
                    const matchName = res.name.toLowerCase().includes(q);
                    const matchRg = res.resourceGroup.toLowerCase().includes(q);
                    const matchIp = res.publicIpOrEndpoint.toLowerCase().includes(q);
                    const matchSku = res.skuTier.toLowerCase().includes(q);
                    if (!matchName && !matchRg && !matchIp && !matchSku) return false;
                }
                return true;
            })
            .sort((a, b) => {
                if (sortField === "name") {
                    return sortOrder === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
                }
                if (sortField === "service") {
                    return sortOrder === "asc" ? a.serviceType.localeCompare(b.serviceType) : b.serviceType.localeCompare(a.serviceType);
                }
                return sortOrder === "asc" ? a.monthlyCostUSD - b.monthlyCostUSD : b.monthlyCostUSD - a.monthlyCostUSD;
            });
    }, [resources, selectedService, selectedRg, selectedSub, searchQuery, sortField, sortOrder]);

    // Paginated Resources
    const totalPages = Math.max(1, Math.ceil(filteredResources.length / pageSize));
    const paginatedResources = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredResources.slice(start, start + pageSize);
    }, [filteredResources, currentPage, pageSize]);

    // Service Icon Helper
    const getServiceIcon = (svc: HybridNetworkServiceType) => {
        switch (svc) {
            case "ExpressRoute":
                return <IconTopologyStarRing3 className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            case "Virtual WAN":
                return <IconArrowsSplit className="w-4 h-4 text-[#2563EB] shrink-0" stroke={1.5} />;
            case "VPN Gateway":
                return <IconNetwork className="w-4 h-4 text-[#0284C7] shrink-0" stroke={1.5} />;
            case "Connection":
                return <IconLayersLinked className="w-4 h-4 text-[#38BDF8] shrink-0" stroke={1.5} />;
            case "Local Network Gateway":
                return <IconServer className="w-4 h-4 text-[#94A3B8] shrink-0" stroke={1.5} />;
            default:
                return <IconNetwork className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
        }
    };

    const handleCopyScript = (scriptText: string) => {
        navigator.clipboard.writeText(scriptText);
        setCopiedScript(true);
        setTimeout(() => setCopiedScript(false), 2500);
    };

    if (isLoading) {
        return (
            <div className="p-6 space-y-6 animate-pulse">
                <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-md w-1/3 mb-2" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-32 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                    ))}
                </div>
                <div className="h-72 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                <div className="h-96 bg-slate-100 dark:bg-slate-800 rounded-xl" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
                    <IconAlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" stroke={1.5} />
                    <h3 className="text-lg font-bold text-red-800 dark:text-red-200 mb-1">{t("errorTitle")}</h3>
                    <p className="text-sm text-red-600 dark:text-red-300 mb-4">{error.message || t("errorMessage")}</p>
                    <button
                        onClick={() => mutate()}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                    >
                        <IconRefresh className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        <span>{t("btnRetry")}</span>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header & Subtitle */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <IconArrowsSplit className="w-7 h-7 text-[#0054A6]" stroke={1.5} />
                        <h1 className="text-2xl font-extrabold text-[#1B2A41] dark:text-white tracking-tight">
                            {t("pageTitle")}
                        </h1>
                        <InfoTooltip content={t("pageTooltip")} position="bottom" align="left" />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("pageSubtitle")}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => mutate()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                    >
                        <IconRefresh className="w-4 h-4 text-[#0054A6]" stroke={1.5} />
                        <span>{t("btnRefresh")}</span>
                    </button>
                </div>
            </div>

            {isMock && <MockBanner />}

            {/* 4 KPI Cards Superiores */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Costo Mensual Total */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            <span className="flex items-center gap-1.5">
                                <IconCurrencyDollar className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                                {t("kpiTotalCostTitle")}
                            </span>
                            <InfoTooltip content={t("kpiTotalCostTooltip")} position="bottom" align="right" />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white">
                                {format(kpis?.totalCostUSD || 0)}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">MTD</span>
                        </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>{t("kpiForecastLabel")}:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {format(kpis?.projectedEndOfMonthCostUSD || 0)}
                        </span>
                    </div>
                </div>

                {/* Card 2: Gateways & Circuitos */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            <span className="flex items-center gap-1.5">
                                <IconTopologyStarRing3 className="w-4 h-4 text-[#2563EB]" stroke={1.5} />
                                {t("kpiGatewaysTitle")}
                            </span>
                            <InfoTooltip content={t("kpiGatewaysTooltip")} position="bottom" align="right" />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white">
                                {kpis?.totalGatewaysCount || 0}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">{t("gatewaysUnit")}</span>
                        </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                        <span>{kpis?.totalCircuitsCount || 0} Circuitos ER</span>
                        <span>{resources.filter((r) => r.serviceType === "Virtual WAN").length} vHubs</span>
                    </div>
                </div>

                {/* Card 3: Túneles Caídos / Huérfanos */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            <span className="flex items-center gap-1.5">
                                <IconShieldExclamation className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                                {t("kpiTunnelsHygieneTitle")}
                            </span>
                            <InfoTooltip content={t("kpiTunnelsHygieneTooltip")} position="bottom" align="right" />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white">
                                {(kpis?.disconnectedTunnelsCount || 0) + (kpis?.orphanedGatewaysCount || 0)}
                            </span>
                            {((kpis?.disconnectedTunnelsCount || 0) > 0 || (kpis?.orphanedGatewaysCount || 0) > 0) ? (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900">
                                    {t("attentionRequiredBadge")}
                                </span>
                            ) : (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
                                    {t("healthyBadge")}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                        <span>{kpis?.disconnectedTunnelsCount || 0} túneles caídos</span>
                        <span>{kpis?.orphanedGatewaysCount || 0} GWs ociosos</span>
                    </div>
                </div>

                {/* Card 4: Throughput / Egress Híbrido */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            <span className="flex items-center gap-1.5">
                                <IconCloudUpload className="w-4 h-4 text-[#0284C7]" stroke={1.5} />
                                {t("kpiThroughputTitle")}
                            </span>
                            <InfoTooltip content={t("kpiThroughputTooltip")} position="bottom" align="right" />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl sm:text-3xl font-extrabold text-[#1B2A41] dark:text-white">
                                {((kpis?.totalEgressGb || 0) / 1024).toFixed(1)}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">TB Egress MTD</span>
                        </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                        <span>{t("kpiOnPremTraffic")}</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {kpis?.totalThroughputMbps || 0} Mbps BW
                        </span>
                    </div>
                </div>
            </div>

            {/* Gráfica Distribución por Servicio (Escala de Azules Estricta) */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div>
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                            <span>{t("chartTitle")}</span>
                            <InfoTooltip content={t("chartTooltip")} position="bottom" align="left" />
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t("chartSubtitle")}
                        </p>
                    </div>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {t("chartShareOfWallet")}
                    </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    {/* Donut Chart */}
                    <div className="lg:col-span-6 h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={kpis?.breakdown || []}
                                    dataKey="costUSD"
                                    nameKey="serviceLabel"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={88}
                                    paddingAngle={3}
                                >
                                    {(kpis?.breakdown || []).map((entry, idx) => (
                                        <Cell
                                            key={`cell-${idx}`}
                                            fill={HYBRID_NETWORK_COLORS[entry.serviceName] || "#0078D4"}
                                            stroke="transparent"
                                        />
                                    ))}
                                </Pie>
                                <RechartsTooltip
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const item = payload[0].payload as any;
                                            return (
                                                <div className="bg-[#1B2A41] text-white p-3 rounded-lg shadow-xl text-xs border border-slate-700 z-[9999]">
                                                    <p className="font-bold text-sm mb-1">{item.serviceLabel}</p>
                                                    <p className="text-sky-300 font-semibold">{format(item.costUSD)}</p>
                                                    <p className="text-slate-300 text-[11px] mt-0.5">
                                                        {item.percentage}% del gasto ({item.count} recursos)
                                                    </p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Breakdown Details List */}
                    <div className="lg:col-span-6 space-y-2.5">
                        {(kpis?.breakdown || []).map((item) => (
                            <div
                                key={item.serviceName}
                                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs"
                            >
                                <div className="flex items-center gap-2.5">
                                    <span
                                        className="w-3 h-3 rounded-full shrink-0"
                                        style={{ backgroundColor: HYBRID_NETWORK_COLORS[item.serviceName] || "#0078D4" }}
                                    />
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                                        {item.serviceLabel}
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                        ({item.count} {item.count === 1 ? "recurso" : "recursos"})
                                    </span>
                                </div>
                                <div className="text-right">
                                    <span className="font-bold text-slate-900 dark:text-white">
                                        {format(item.costUSD)}
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-2">
                                        {item.percentage}%
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Controles y Filtros */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Búsqueda */}
                    <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                            {t("filterSearchLabel")}
                        </label>
                        <div className="relative">
                            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" stroke={1.5} />
                            <input
                                type="text"
                                placeholder={t("searchPlaceholder")}
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-[#0078D4]"
                            />
                        </div>
                    </div>

                    {/* Filtro de Servicio */}
                    <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                            {t("filterServiceLabel")}
                        </label>
                        <select
                            value={selectedService}
                            onChange={(e) => {
                                setSelectedService(e.target.value);
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

                    {/* Filtro de Grupo de Recursos */}
                    <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                            {t("filterRgLabel")}
                        </label>
                        <select
                            value={selectedRg}
                            onChange={(e) => {
                                setSelectedRg(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full py-1.5 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-[#0078D4]"
                        >
                            <option value="all">{t("allOption")}</option>
                            {rgOptions.filter((opt) => opt !== "all").map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>

                    {/* Filtro de Suscripción */}
                    <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                            {t("filterSubLabel")}
                        </label>
                        <select
                            value={selectedSub}
                            onChange={(e) => {
                                setSelectedSub(e.target.value);
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
                                        <InfoTooltip content={t("colTypeTooltip")} position="bottom" align="left" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh
                                    minWidth={180}
                                    className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase cursor-pointer hover:text-slate-700"
                                    onClick={() => {
                                        setSortField("name");
                                        setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                                    }}
                                >
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colResourceName")}</span>
                                        <IconArrowsSort className="w-3.5 h-3.5" />
                                    </div>
                                </ResizableTh>

                                <ResizableTh minWidth={180} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <span>{t("colSkuTier")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={130} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <span>{t("colStatus")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={170} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <span>{t("colEndpoint")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={140} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <span>{t("colResourceGroup")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={150} className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase">
                                    <span>{t("colSubscription")}</span>
                                </ResizableTh>

                                <ResizableTh
                                    minWidth={140}
                                    className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase text-right cursor-pointer hover:text-slate-700"
                                    onClick={() => {
                                        setSortField("cost");
                                        setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                                    }}
                                >
                                    <div className="inline-flex items-center justify-end gap-1 w-full">
                                        <span>{t("colMonthlyCost")}</span>
                                        <IconArrowsSort className="w-3.5 h-3.5" />
                                    </div>
                                </ResizableTh>

                                <th className="py-3 px-3.5 text-[11px] font-bold text-slate-500 uppercase text-center w-28">
                                    <span>{t("colActions")}</span>
                                </th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                            {paginatedResources.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="py-8 text-center text-slate-500 dark:text-slate-400">
                                        <IconArrowsSplit className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" stroke={1.5} />
                                        <p className="font-semibold">{t("emptyStateTitle")}</p>
                                        <p className="text-[11px] text-slate-400">{t("emptyStateDesc")}</p>
                                    </td>
                                </tr>
                            ) : (
                                paginatedResources.map((res) => (
                                    <tr
                                        key={res.id}
                                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                                    >
                                        <td className="py-3 px-3.5 font-semibold text-slate-800 dark:text-slate-200">
                                            <div className="flex items-center gap-2">
                                                {getServiceIcon(res.serviceType)}
                                                <span>{res.serviceLabel}</span>
                                            </div>
                                        </td>

                                        <td className="py-3 px-3.5 font-medium text-[#1B2A41] dark:text-slate-100">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-semibold line-clamp-1" title={res.name}>
                                                    {res.name}
                                                </span>
                                                {res.isOrphan && (
                                                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shrink-0">
                                                        {t("badgeOrphan")}
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400">
                                            <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-sm">
                                                {res.skuTier}
                                            </span>
                                        </td>

                                        <td className="py-3 px-3.5">
                                            {res.connectionStatus === "Connected" && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                    {t("statusConnected")}
                                                </span>
                                            )}
                                            {res.connectionStatus === "Connecting" && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-900">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping"></span>
                                                    {t("statusConnecting")}
                                                </span>
                                            )}
                                            {res.connectionStatus === "NotConnected" && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                                                    {t("statusNotConnected")}
                                                </span>
                                            )}
                                            {res.connectionStatus === "ConfigOnly" && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                    {t("statusConfigOnly")}
                                                </span>
                                            )}
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400 font-mono text-[11px] truncate" title={res.publicIpOrEndpoint}>
                                            {res.publicIpOrEndpoint}
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400 truncate" title={res.resourceGroup}>
                                            {res.resourceGroup}
                                        </td>

                                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400 truncate" title={res.subscriptionName}>
                                            {res.subscriptionName}
                                        </td>

                                        <td className="py-3 px-3.5 text-right font-extrabold text-[#0054A6] dark:text-sky-400">
                                            {res.monthlyCostUSD === 0 ? "$0.00" : format(res.monthlyCostUSD)}
                                        </td>

                                        <td className="py-3 px-3.5 text-center">
                                            <button
                                                onClick={() => setSelectedResource(res)}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-2xs whitespace-nowrap"
                                            >
                                                <IconEye className="w-3.5 h-3.5 text-[#0054A6] shrink-0" stroke={1.5} />
                                                <span>{t("btnDetails")}</span>
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
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="py-1 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                        <span>
                            Página {currentPage} de {totalPages}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            <IconChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            <IconChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Prioritized Recommendations Section */}
            {remediations.length > 0 && (
                <div className="space-y-4">
                    <div className="border-b border-slate-200 dark:border-slate-800 pb-2">
                        <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                            <IconShieldExclamation className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
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
                                                {rem.category === "ORPHAN_GATEWAY" && <IconNetwork className="w-4 h-4" stroke={1.5} />}
                                                {rem.category === "EXPRESSROUTE_ARBITRAGE" && <IconTopologyStarRing3 className="w-4 h-4" stroke={1.5} />}
                                                {rem.category === "GATEWAY_RIGHTSIZING" && <IconArrowsExchange className="w-4 h-4" stroke={1.5} />}
                                                {rem.category === "DISCONNECTED_TUNNEL" && <IconLayersLinked className="w-4 h-4" stroke={1.5} />}
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
                                                    {t("hygieneTitle")}
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

            {/* Topology & Telemetry Detail Modal (Strict Z-Index Layering: z-50 / z-[100]) */}
            {selectedResource && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 z-50">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                {getServiceIcon(selectedResource.serviceType)}
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white">
                                        {selectedResource.name}
                                    </h3>
                                    <p className="text-xs text-slate-400">{selectedResource.serviceLabel}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedResource(null)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                                <span className="text-slate-400 block mb-0.5">SKU / Capacidad:</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedResource.skuTier}</span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                                <span className="text-slate-400 block mb-0.5">{t("detailMonthlyCost")}</span>
                                <span className="font-bold text-[#0054A6] dark:text-sky-400 text-sm">
                                    {selectedResource.monthlyCostUSD === 0 ? "$0.00 (Sin Costo Base)" : format(selectedResource.monthlyCostUSD)}
                                </span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                                <span className="text-slate-400 block mb-0.5">Endpoint / IP / Peering:</span>
                                <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200">{selectedResource.publicIpOrEndpoint}</span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                                <span className="text-slate-400 block mb-0.5">{t("detailOperationalStatus")}</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedResource.connectionStatus}</span>
                            </div>
                        </div>

                        {selectedResource.details && (
                            <div className="space-y-3 pt-2">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    {t("telemetryBgpTitle")}
                                </h4>
                                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs space-y-1.5">
                                    {selectedResource.details.peeringLocation && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">{t("detailPeeringLocation")}</span>
                                            <span className="font-semibold">{selectedResource.details.peeringLocation}</span>
                                        </div>
                                    )}
                                    {selectedResource.details.bandwidthMbps && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Ancho de Banda Aprovisionado:</span>
                                            <span className="font-semibold">{selectedResource.details.bandwidthMbps} Mbps</span>
                                        </div>
                                    )}
                                    {selectedResource.details.asn && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">BGP ASN:</span>
                                            <span className="font-semibold font-mono">{selectedResource.details.asn}</span>
                                        </div>
                                    )}
                                    {selectedResource.details.remoteNetworkAddressSpace && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Espacio de Direcciones On-Prem:</span>
                                            <span className="font-mono text-[11px]">{selectedResource.details.remoteNetworkAddressSpace.join(", ")}</span>
                                        </div>
                                    )}
                                    {selectedResource.costBreakdownReason && (
                                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-slate-500">
                                            <span className="font-semibold">{t("detailFinops")} </span>
                                            {selectedResource.costBreakdownReason}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={() => setSelectedResource(null)}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                            >
                                {t("btnClose")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Resolutive Remediation Modal (Strict Z-Index Layering: z-50 / z-[100]) */}
            {activeRemediation && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 z-50">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                                <IconTerminal2 className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                                <div>
                                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white">
                                        {activeRemediation.title}
                                    </h3>
                                    <p className="text-xs text-slate-400">{activeRemediation.resourceName}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setActiveRemediation(null)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                            {activeRemediation.description}
                        </div>

                        {/* CLI / PowerShell Tabs */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
                                    <button
                                        onClick={() => setActiveScriptTab("cli")}
                                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                                            activeScriptTab === "cli"
                                                ? "bg-white dark:bg-slate-900 text-[#0054A6] shadow-xs"
                                                : "text-slate-500 hover:text-slate-800"
                                        }`}
                                    >
                                        {t("tabCli")}
                                    </button>
                                    <button
                                        onClick={() => setActiveScriptTab("ps")}
                                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                                            activeScriptTab === "ps"
                                                ? "bg-white dark:bg-slate-900 text-[#0054A6] shadow-xs"
                                                : "text-slate-500 hover:text-slate-800"
                                        }`}
                                    >
                                        {t("tabPs")}
                                    </button>
                                </div>

                                <button
                                    onClick={() =>
                                        handleCopyScript(
                                            activeScriptTab === "cli"
                                                ? activeRemediation.commandPayload.cli
                                                : activeRemediation.commandPayload.powershell
                                        )
                                    }
                                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                                >
                                    {copiedScript ? (
                                        <>
                                            <IconCheck className="w-3.5 h-3.5 text-emerald-600" />
                                            <span className="text-emerald-600">{t("btnCopied")}</span>
                                        </>
                                    ) : (
                                        <>
                                            <IconCopy className="w-3.5 h-3.5 text-[#0054A6]" />
                                            <span>{t("btnCopyScript")}</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            <div className="relative">
                                <pre className="p-3.5 rounded-lg bg-slate-950 text-sky-400 font-mono text-[11px] overflow-x-auto leading-relaxed border border-slate-800">
                                    <code>
                                        {activeScriptTab === "cli"
                                            ? activeRemediation.commandPayload.cli
                                            : activeRemediation.commandPayload.powershell}
                                    </code>
                                </pre>
                            </div>
                        </div>

                        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300">
                            <span className="font-bold">Impacto Estimado: </span>
                            {activeRemediation.commandPayload.impactSummary}
                        </div>

                        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
                            <button
                                onClick={() => setActiveRemediation(null)}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
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

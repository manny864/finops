"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import {
    NetworkAnalyticsResponse,
    NetworkRemediationAction,
    NetworkResourceDetail,
} from "@/types/networkAnalytics.types";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip as RechartsTooltip,
} from "recharts";
import {
    IconRefresh,
    IconSearch,
    IconCopy,
    IconCheck,
    IconX,
    IconChevronLeft,
    IconChevronRight,
    IconSparkles,
    IconTopologyStar3,
    IconNetwork,
    IconWorld,
    IconWorldCode,
    IconShieldCheck,
    IconBuildingBridge2,
    IconServer,
    IconRouter,
} from "@tabler/icons-react";

export default function NetworkAnalyticsDashboard() {
    const t = useTranslations("NetworkFamilies");
    const { selectedTenant } = useTenant();
    const { format } = useCurrency();
    const { instance, accounts: msalAccounts } = useMsal();
    const tenantId = selectedTenant?.id || "demo-tenant-id";

    // Fetcher autenticado para tenants reales / bypass para mock
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
        ? `/api/intelligence/network/analytics?tenantId=${tenantId}&tier=${selectedTenant?.tier || "pro"}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<NetworkAnalyticsResponse>(
        swrKey,
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 30000 }
    );

    // Filtros y paginación
    const [searchTerm, setSearchTerm] = useState("");
    const [serviceFilter, setServiceFilter] = useState("all");
    const [rgFilter, setRgFilter] = useState("all");
    const [subFilter, setSubFilter] = useState("all");
    const [sortField, setSortField] = useState<"cost" | "name" | "service" | "orphan">("cost");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
    const [pageSize, setPageSize] = useState<15 | 30 | 45 | 60>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

    // Modal de Remediación / Detalle
    const [selectedAction, setSelectedAction] = useState<NetworkRemediationAction | null>(null);
    const [selectedResource, setSelectedResource] = useState<NetworkResourceDetail | null>(null);
    const [activeScriptTab, setActiveScriptTab] = useState<"cli" | "ps">("cli");
    const [copiedText, setCopiedText] = useState(false);

    const resources = useMemo(() => data?.resources || [], [data]);
    const kpis = data?.kpis;
    const serviceBreakdown = useMemo(() => data?.serviceBreakdown || [], [data]);
    const remediations = useMemo(() => data?.remediations || [], [data]);

    // Opciones dinámicas para dropdowns
    const serviceOptions = useMemo(() => {
        return ["all", ...Array.from(new Set(resources.map((r) => r.serviceType))).sort()];
    }, [resources]);

    const rgOptions = useMemo(() => {
        return ["all", ...Array.from(new Set(resources.map((r) => r.resourceGroup))).filter(Boolean).sort()];
    }, [resources]);

    const subOptions = useMemo(() => {
        return ["all", ...Array.from(new Set(resources.map((r) => r.subscriptionName || r.subscriptionId))).filter(Boolean).sort()];
    }, [resources]);

    // Filtrado y ordenamiento de la tabla
    const filteredResources = useMemo(() => {
        return resources
            .filter((r) => {
                if (serviceFilter !== "all" && r.serviceType !== serviceFilter) return false;
                if (rgFilter !== "all" && r.resourceGroup !== rgFilter) return false;
                if (subFilter !== "all" && (r.subscriptionName !== subFilter && r.subscriptionId !== subFilter)) return false;
                if (searchTerm.trim()) {
                    const q = searchTerm.toLowerCase();
                    const matchName = r.name.toLowerCase().includes(q);
                    const matchIp = r.publicIpAddress.toLowerCase().includes(q);
                    const matchRg = r.resourceGroup.toLowerCase().includes(q);
                    const matchOwner = r.costCenterOwner.toLowerCase().includes(q);
                    if (!matchName && !matchIp && !matchRg && !matchOwner) return false;
                }
                return true;
            })
            .sort((a, b) => {
                let comparison = 0;
                if (sortField === "cost") {
                    comparison = a.monthlyCostUSD - b.monthlyCostUSD;
                } else if (sortField === "name") {
                    comparison = a.name.localeCompare(b.name);
                } else if (sortField === "service") {
                    comparison = a.serviceType.localeCompare(b.serviceType);
                } else if (sortField === "orphan") {
                    comparison = (a.isOrphan === b.isOrphan) ? 0 : a.isOrphan ? -1 : 1;
                }
                return sortDirection === "desc" ? -comparison : comparison;
            });
    }, [resources, serviceFilter, rgFilter, subFilter, searchTerm, sortField, sortDirection]);

    const totalPages = Math.max(1, Math.ceil(filteredResources.length / pageSize));
    const paginatedResources = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredResources.slice(start, start + pageSize);
    }, [filteredResources, currentPage, pageSize]);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
    };

    const getServiceIcon = (serviceType: string) => {
        switch (serviceType) {
            case "Load Balancers":
            case "Application Gateway":
                return <IconTopologyStar3 className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            case "Virtual Networks":
            case "Subnets":
                return <IconNetwork className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            case "Public IP":
                return <IconWorld className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            case "Private DNS Zones":
                return <IconWorldCode className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            case "Private Endpoints":
                return <IconRouter className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            case "NAT Gateway":
            case "Virtual Network Gateway":
                return <IconBuildingBridge2 className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            case "Azure Firewall":
                return <IconShieldCheck className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
            default:
                return <IconServer className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />;
        }
    };

    return (
        <div className="space-y-6">
            {/* Header de controles superiores */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => mutate()}
                        disabled={isLoading}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors shadow-2xs disabled:opacity-50"
                    >
                        <IconRefresh className={`w-4 h-4 text-[#0054A6] ${isLoading ? "animate-spin" : ""}`} stroke={1.5} />
                        <span>{isLoading ? t("loading") : "Actualizar Telemetría"}</span>
                    </button>
                    {data?.mock && (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50">
                            {t("demoMode")}
                        </span>
                    )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                    {t.rich("lastSyncLine", { b: (c) => <span className="font-semibold text-slate-700 dark:text-slate-200">{c}</span> })}
                </div>
            </div>

            {/* 1. HEADER Y KPI CARDS SUPERIORES */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Costo Mensual Total */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiTotalCost")}
                        </span>
                        <InfoTooltip content={t("kpiSpendTooltip")} position="bottom" align="right" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                            {format(kpis?.totalMonthlyCostUSD || 0)}
                        </span>
                        <span className="text-xs text-slate-400">USD</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <span>Run Rate proyectado:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {format(kpis?.projectedRunRateUSD || 0)}
                        </span>
                    </div>
                </div>

                {/* Card 2: Recursos Detectados */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiResourceCount")}
                        </span>
                        <InfoTooltip content={t("totalResourcesTooltip")} position="bottom" align="right" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                            {kpis?.totalResourcesCount || 0}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">recursos activos</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <span>Servicios activos:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {serviceBreakdown.length} familias
                        </span>
                    </div>
                </div>

                {/* Card 3: IPs Huérfanas / Inactivas */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiOrphanIps")}
                        </span>
                        <InfoTooltip content={t("kpiOrphanIpsTooltip")} position="bottom" align="right" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className={`text-2xl font-bold ${(kpis?.orphanIpsCount || 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100"}`}>
                            {kpis?.orphanIpsCount || 0}
                        </span>
                        {(kpis?.orphanIpsCount || 0) > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300">
                                Fuga Activa
                            </span>
                        )}
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <span>{t("recoverableSavings")}</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {format(kpis?.orphanIpsPotentialSavingsUSD || 0)}/mes
                        </span>
                    </div>
                </div>

                {/* Card 4: Volumen de Egress Facturable */}
                <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t("kpiEgress")}
                        </span>
                        <InfoTooltip content={t("kpiEgressTooltip")} position="bottom" align="right" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                            {kpis?.billableEgressGb ? `${kpis.billableEgressGb} GB` : "0.0 GB"}
                        </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <span>{t("totalPotentialSavings")}</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {format(kpis?.potentialTotalSavingsUSD || 0)}/mes
                        </span>
                    </div>
                </div>
            </div>

            {/* 2. PANEL CENTRAL: GRÁFICA DE DISTRIBUCIÓN POR SERVICIO (EXCLUSIVAMENTE TONOS DE AZUL) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="lg:col-span-1 flex flex-col justify-center items-center relative min-h-[260px]">
                    <div className="w-full flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {t("resourcesPieTitle")}
                        </h3>
                        <InfoTooltip content={t("shareTooltip")} position="bottom" align="right" />
                    </div>

                    {serviceBreakdown.length > 0 ? (
                        <div className="w-full h-56 relative flex items-center justify-center">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={serviceBreakdown}
                                        dataKey="totalCostUSD"
                                        nameKey="serviceName"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={55}
                                        outerRadius={85}
                                        paddingAngle={2}
                                    >
                                        {serviceBreakdown.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.colorHex} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const item = payload[0].payload;
                                                return (
                                                    <div className="bg-[#1B2A41] text-white p-3 rounded-lg shadow-2xl border border-slate-700 text-xs">
                                                        <p className="font-bold">{item.serviceName}</p>
                                                        <p className="mt-1">Costo: {format(item.totalCostUSD)}</p>
                                                        <p className="text-sky-300">Participación: {item.percentage}%</p>
                                                        <p className="text-slate-300 text-[11px]">{item.resourceCount} recursos</p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-xs text-slate-400">Total Red</span>
                                <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                                    {format(kpis?.totalMonthlyCostUSD || 0)}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="h-56 flex items-center justify-center text-xs text-slate-400">
                            {isLoading ? t("loadingBreakdown") : t("noNetworkCostData")}
                        </div>
                    )}
                </div>

                {/* Leyenda interactiva en escala de azules */}
                <div className="lg:col-span-2 flex flex-col justify-center">
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                        {t("shareTitle")}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {serviceBreakdown.map((service) => (
                            <div
                                key={service.serviceName}
                                className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                            >
                                <div className="flex items-center gap-2.5 truncate">
                                    <div
                                        className="w-3 h-3 rounded-xs shrink-0"
                                        style={{ backgroundColor: service.colorHex }}
                                    />
                                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                        {service.serviceName}
                                    </span>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                                        {format(service.totalCostUSD)}
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                        {service.percentage}% ({service.resourceCount})
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 3. TABLA "DESGLOSE POR SERVICIO" (ESTÁNDAR CMP) */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            {t("tableTitle")}
                        </h2>
                        <InfoTooltip content={t("inventoryTooltip")} position="bottom" align="left" />
                    </div>

                    {/* Buscador en vivo */}
                    <div className="relative w-full sm:w-64">
                        <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" stroke={1.5} />
                        <input
                            type="text"
                            placeholder={t("searchPlaceholder")}
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
                        />
                    </div>
                </div>

                {/* Filtros obligatorios inmediatamente debajo del título */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs">
                    <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {t("filterService")}
                        </label>
                        <select
                            value={serviceFilter}
                            onChange={(e) => {
                                setServiceFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                            {serviceOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                    {opt === "all" ? t("allOption") : opt}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {t("filterResourceGroup")}
                        </label>
                        <select
                            value={rgFilter}
                            onChange={(e) => {
                                setRgFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                            {rgOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                    {opt === "all" ? t("allOption") : opt}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            {t("filterSubscription")}
                        </label>
                        <select
                            value={subFilter}
                            onChange={(e) => {
                                setSubFilter(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                        >
                            {subOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                    {opt === "all" ? t("allOption") : opt}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Tabla Responsive con Columnas Redimensionables */}
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                            <tr>
                                <ResizableTh minWidth={180}>
                                    <button
                                        onClick={() => {
                                            setSortField("service");
                                            setSortDirection(sortField === "service" && sortDirection === "asc" ? "desc" : "asc");
                                        }}
                                        className="flex items-center gap-1 font-semibold hover:text-[#0054A6]"
                                    >
                                        <span>{t("colService")}</span>
                                        {sortField === "service" && (sortDirection === "asc" ? " ▲" : " ▼")}
                                    </button>
                                </ResizableTh>

                                <ResizableTh minWidth={220}>
                                    <button
                                        onClick={() => {
                                            setSortField("name");
                                            setSortDirection(sortField === "name" && sortDirection === "asc" ? "desc" : "asc");
                                        }}
                                        className="flex items-center gap-1 font-semibold hover:text-[#0054A6]"
                                    >
                                        <span>{t("colResourceName")}</span>
                                        {sortField === "name" && (sortDirection === "asc" ? " ▲" : " ▼")}
                                    </button>
                                </ResizableTh>

                                <ResizableTh minWidth={140}>
                                    <span>{t("colPublicIp")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={180}>
                                    <span>{t("colResourceGroup")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={180}>
                                    <span>{t("colSubscription")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={160}>
                                    <span>{t("colCostGroupOwner")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={120}>
                                    <span>{t("colCreatedAt")}</span>
                                </ResizableTh>

                                <ResizableTh minWidth={140}>
                                    <button
                                        onClick={() => {
                                            setSortField("cost");
                                            setSortDirection(sortField === "cost" && sortDirection === "desc" ? "asc" : "desc");
                                        }}
                                        className="flex items-center gap-1 font-semibold hover:text-[#0054A6]"
                                    >
                                        <span>{t("colMonthlyCost")}</span>
                                        {sortField === "cost" && (sortDirection === "asc" ? " ▲" : " ▼")}
                                    </button>
                                </ResizableTh>

                                <ResizableTh minWidth={120}>
                                    <span>Acciones</span>
                                </ResizableTh>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                            {paginatedResources.length > 0 ? (
                                paginatedResources.map((item) => (
                                    <tr
                                        key={item.id}
                                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                                    >
                                        <td className="p-3">
                                            <div className="flex items-center gap-2">
                                                {getServiceIcon(item.serviceType)}
                                                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                                    {item.serviceLabel}
                                                </span>
                                            </div>
                                        </td>

                                        <td className="p-3">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                                                    {item.name}
                                                </span>
                                                {item.isOrphan && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                                        {t("badgeOrphan")}
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="p-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                                            {item.publicIpAddress !== "-" ? (
                                                <span className="text-blue-600 dark:text-blue-400 font-semibold">
                                                    {item.publicIpAddress}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400">-</span>
                                            )}
                                        </td>

                                        <td className="p-3 text-slate-600 dark:text-slate-400 truncate max-w-[160px]">
                                            {item.resourceGroup}
                                        </td>

                                        <td className="p-3 text-slate-600 dark:text-slate-400 truncate max-w-[160px]">
                                            {item.subscriptionName}
                                        </td>

                                        <td className="p-3 text-slate-500 dark:text-slate-400">
                                            {item.costCenterOwner}
                                        </td>

                                        <td className="p-3 text-slate-500 dark:text-slate-400 text-[11px]">
                                            {item.creationDate ? item.creationDate.split("T")[0] : "-"}
                                        </td>

                                        <td className="p-3 font-bold text-slate-900 dark:text-slate-100">
                                            {format(item.monthlyCostUSD)}
                                        </td>

                                        <td className="p-3">
                                            <button
                                                onClick={() => setSelectedResource(item)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors"
                                            >
                                                <span>Detalles</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={9} className="p-8 text-center text-slate-400">
                                        {isLoading ? t("loading") : t("empty")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Paginación */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <span>{t("perPage")}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value) as 15 | 30 | 45 | 60);
                                setCurrentPage(1);
                            }}
                            className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                        >
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                        <span>
                            {t("paginationShowing", {
                                from: filteredResources.length === 0 ? 0 : (currentPage - 1) * pageSize + 1,
                                to: Math.min(currentPage * pageSize, filteredResources.length),
                                total: filteredResources.length,
                            })}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage <= 1}
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                        >
                            <IconChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-2 font-medium">
                            {t("page", { current: currentPage, total: totalPages })}
                        </span>
                        <button
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages}
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                        >
                            <IconChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* 4. SECCIÓN DE RECOMENDACIONES PRIORIZADAS DE RED */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                            {t("recommendationsTitle")}
                        </h3>
                        <InfoTooltip content={t("recommendationsTooltip")} position="bottom" align="left" />
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        Ahorro total estimado: {format(kpis?.potentialTotalSavingsUSD || 0)}/mes
                    </span>
                </div>

                {remediations.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {remediations.map((rec) => (
                            <div
                                key={rec.id}
                                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-700 transition-colors flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                            rec.category === "ORPHAN_IP"
                                                ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                                                : "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                                        }`}>
                                            {rec.category.replace("_", " ")}
                                        </span>
                                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                            +{format(rec.estimatedSavingsUSD)}/mes
                                        </span>
                                    </div>
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                        {rec.title}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                        {rec.description}
                                    </p>
                                </div>

                                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <span className="text-[11px] text-slate-400 font-mono truncate max-w-[120px]">
                                        {rec.resourceName}
                                    </span>
                                    <button
                                        onClick={() => setSelectedAction(rec)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors"
                                    >
                                        <IconSparkles className="w-3.5 h-3.5 text-[#0054A6]" stroke={1.5} />
                                        <span>Optimizar</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-6 text-center text-xs text-slate-400">
                        {t("recommendationsEmpty")}
                    </div>
                )}
            </div>

            {/* MODAL DE REMEDIACIÓN (Z-INDEX 50 Y BACKDROP) */}
            {selectedAction && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <IconSparkles className="w-5 h-5 text-[#0054A6]" stroke={1.5} />
                                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                                    {selectedAction.title}
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelectedAction(null)}
                                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 text-xs text-slate-700 dark:text-slate-300">
                            <p className="font-semibold text-blue-900 dark:text-blue-200">
                                {t("estSavingsValue", { amount: format(selectedAction.estimatedSavingsUSD) })}
                            </p>
                            <p className="mt-1">{selectedAction.description}</p>
                            <p className="mt-2 text-[11px] text-slate-500">
                                <span className="font-bold">Impacto operacional:</span> {selectedAction.commandPayload.impactSummary}
                            </p>
                        </div>

                        {/* Tabs de Script (CLI / PowerShell) */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setActiveScriptTab("cli")}
                                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                            activeScriptTab === "cli"
                                                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                        }`}
                                    >
                                        Azure CLI
                                    </button>
                                    <button
                                        onClick={() => setActiveScriptTab("ps")}
                                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                            activeScriptTab === "ps"
                                                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                        }`}
                                    >
                                        PowerShell
                                    </button>
                                </div>
                                <button
                                    onClick={() => handleCopy(
                                        activeScriptTab === "cli"
                                            ? selectedAction.commandPayload.cli
                                            : selectedAction.commandPayload.powershell
                                    )}
                                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#10B981] text-[#10B981] hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors"
                                >
                                    {copiedText ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
                                    <span>{copiedText ? "Copiado" : "Copiar Script"}</span>
                                </button>
                            </div>

                            <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 font-mono text-xs overflow-x-auto border border-slate-800">
                                <code>
                                    {activeScriptTab === "cli"
                                        ? selectedAction.commandPayload.cli
                                        : selectedAction.commandPayload.powershell}
                                </code>
                            </pre>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setSelectedAction(null)}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            >
                                {t("btnClose")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL DE DETALLE DEL RECURSO */}
            {selectedResource && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {getServiceIcon(selectedResource.serviceType)}
                                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate max-w-[340px]">
                                    {selectedResource.name}
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelectedResource(null)}
                                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-3 text-xs divide-y divide-slate-100 dark:divide-slate-800">
                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <span className="text-slate-500">Servicio:</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedResource.serviceLabel}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <span className="text-slate-500">{t("detailIp")}</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedResource.publicIpAddress}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <span className="text-slate-500">{t("detailRg")}</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedResource.resourceGroup}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <span className="text-slate-500">{t("detailSub")}</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedResource.subscriptionName}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <span className="text-slate-500">{t("detailLocation")}</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedResource.location || "-"}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <span className="text-slate-500">{t("detailCost")}</span>
                                <span className="font-bold text-slate-900 dark:text-slate-100">{format(selectedResource.monthlyCostUSD)}</span>
                            </div>
                            {selectedResource.details.sku && (
                                <div className="grid grid-cols-2 gap-2 pt-2">
                                    <span className="text-slate-500">SKU / Tier:</span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedResource.details.sku}</span>
                                </div>
                            )}
                            {selectedResource.orphanReason && (
                                <div className="pt-2 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800">
                                    <span className="font-bold block">{t("detailAlert")}</span>
                                    <span>{selectedResource.orphanReason}</span>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={() => setSelectedResource(null)}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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

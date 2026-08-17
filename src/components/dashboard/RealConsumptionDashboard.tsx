"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import FinOpsRemediationModal, { type OptimizationTarget } from "@/components/dashboard/FinOpsRemediationModal";
import type {
    RealConsumptionOverview,
    ServiceConsumptionSummary,
    ServiceResourceDetail,
} from "@/lib/realConsumptionTypes";

import {
    IconFlame,
    IconTrendingUp,
    IconTrendingDown,
    IconAlertTriangle,
    IconDatabase,
    IconBox,
    IconBrain,
    IconSearch,
    IconArchive,
    IconNetwork,
    IconServer,
    IconDeviceSdCard,
    IconLayersLinked,
    IconSparkles,
    IconX,
    IconRefresh,
    IconLayersIntersect,
    IconFilter,
    IconCheck,
    IconCoins,
    IconInfoCircle,
} from "@tabler/icons-react";

interface RealConsumptionDashboardProps {
    onOpenOptimizationModal?: (actionKey: string, serviceName: string) => void;
}

export default function RealConsumptionDashboard({
    onOpenOptimizationModal,
}: RealConsumptionDashboardProps) {
    const t = useProviderTranslations("RealConsumptionMonitor");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();

    // Drawer state
    const [selectedService, setSelectedService] = useState<ServiceConsumptionSummary | null>(null);
    const [drawerSearch, setDrawerSearch] = useState("");
    const [drawerRegionFilter, setDrawerRegionFilter] = useState("all");
    const [drawerGroupFilter, setDrawerGroupFilter] = useState("all");
    const [actionExecuted, setActionExecuted] = useState<string | null>(null);
    const [optimizationTarget, setOptimizationTarget] = useState<OptimizationTarget | null>(null);

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
            throw new Error(json.details || json.error || "Error");
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR<RealConsumptionOverview & { success?: boolean }>(
        selectedTenant?.id ? `/api/intelligence/billing?tenantId=${selectedTenant.id}` : null,
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 60000 }
    );

    const isMock = selectedTenant?.id ? isMockTenant(selectedTenant.id) : false;

    // Filtered resources for Drawer
    const filteredResources = useMemo(() => {
        if (!selectedService?.resources) return [];
        return selectedService.resources.filter((res) => {
            const matchSearch =
                !drawerSearch ||
                res.resourceName.toLowerCase().includes(drawerSearch.toLowerCase()) ||
                res.resourceGroup.toLowerCase().includes(drawerSearch.toLowerCase()) ||
                res.sku.toLowerCase().includes(drawerSearch.toLowerCase()) ||
                res.region.toLowerCase().includes(drawerSearch.toLowerCase());
            const matchRegion = drawerRegionFilter === "all" || res.region === drawerRegionFilter;
            const matchGroup = drawerGroupFilter === "all" || res.resourceGroup === drawerGroupFilter;
            return matchSearch && matchRegion && matchGroup;
        });
    }, [selectedService, drawerSearch, drawerRegionFilter, drawerGroupFilter]);

    // Distinct filter options for Drawer
    const availableRegions = useMemo(() => {
        if (!selectedService?.resources) return [];
        return Array.from(new Set(selectedService.resources.map((r) => r.region)));
    }, [selectedService]);

    const availableGroups = useMemo(() => {
        if (!selectedService?.resources) return [];
        return Array.from(new Set(selectedService.resources.map((r) => r.resourceGroup)));
    }, [selectedService]);

    const handleActionClick = (
        actionKey: string,
        serviceName: string,
        resourceDetail?: ServiceResourceDetail
    ) => {
        setActionExecuted(actionKey);
        if (resourceDetail) {
            setOptimizationTarget({
                resourceName: resourceDetail.resourceName,
                resourceGroup: resourceDetail.resourceGroup,
                service: selectedService?.serviceName || serviceName,
                region: resourceDetail.region,
                currentSku: resourceDetail.sku,
                remediationTitle:
                    resourceDetail.remediationSuggested || `Optimización de ${resourceDetail.resourceName}`,
                remediationDescription: `Remediación sugerida para ${resourceDetail.resourceName} (${resourceDetail.sku}): ${
                    resourceDetail.remediationSuggested || "Ajuste de capacidad / SKU"
                }`,
                actionKey: actionKey,
                monthlySavings: Math.max(resourceDetail.costMtd * 0.25, 20),
                riskLevel: "low",
            });
        } else {
            const svc = data?.services?.find((s: ServiceConsumptionSummary) => s.serviceName === serviceName);
            setOptimizationTarget({
                resourceName: serviceName,
                resourceGroup: svc?.resources?.[0]?.resourceGroup || "rg-production",
                service: serviceName,
                region: svc?.resources?.[0]?.region || "eastus",
                remediationTitle: svc?.remediationActionLabel || `Optimización de ${serviceName}`,
                remediationDescription:
                    svc?.recommendation || `Optimización y remediación FinOps para ${serviceName}`,
                actionKey: actionKey,
                monthlySavings: svc?.potentialSavings || 45,
                riskLevel: "low",
            });
        }

        if (onOpenOptimizationModal) {
            onOpenOptimizationModal(actionKey, serviceName);
        }
    };

    // Render icon helper
    const renderServiceIcon = (iconName: string, className: string = "w-5 h-5") => {
        switch (iconName) {
            case "database":
                return <IconDatabase className={className} />;
            case "box":
                return <IconBox className={className} />;
            case "brain":
                return <IconBrain className={className} />;
            case "search":
                return <IconSearch className={className} />;
            case "archive":
                return <IconArchive className={className} />;
            case "network":
                return <IconNetwork className={className} />;
            case "server":
                return <IconServer className={className} />;
            case "hard-drive":
                return <IconDeviceSdCard className={className} />;
            default:
                return <IconLayersLinked className={className} />;
        }
    };

    if (error) {
        const tierError = parseTierRequiredError(error.message);
        if (tierError) {
            return <TierLockedNotice requiredTier={tierError} />;
        }
        return (
            <div className="p-6 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3 text-red-700 dark:text-red-400">
                    <IconAlertTriangle className="w-6 h-6 flex-shrink-0" />
                    <div>
                        <div className="font-semibold">{t("error")}</div>
                        <div className="text-sm">{error.message}</div>
                    </div>
                </div>
                <button
                    onClick={() => mutate()}
                    className="px-4 py-2 bg-white dark:bg-slate-900 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-50 text-sm font-medium transition-colors"
                >
                    {t("retry")}
                </button>
            </div>
        );
    }

    if (isLoading || !data) {
        return (
            <div className="space-y-6 animate-pulse">
                {/* Skeleton Header */}
                <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded-lg w-1/3" />
                {/* Skeleton KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4" />
                    ))}
                </div>
                {/* Skeleton Stacked Bar */}
                <div className="h-20 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4" />
                {/* Skeleton Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="h-64 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5" />
                    ))}
                </div>
            </div>
        );
    }

    const services = data.services || [];
    const top5Share = data.top5ShareOfWallet || [];

    return (
        <div className="space-y-6">
            {/* Header & Title */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {t("title")}
                        </h2>
                        <InfoTooltip content={t("tooltip_page_header")} />
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {t("subtitle")}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {isMock && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            {t("mockBadge")}
                        </span>
                    )}
                    <button
                        onClick={() => mutate()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 text-xs font-medium transition-colors shadow-sm"
                    >
                        <IconRefresh className="w-3.5 h-3.5" />
                        {t("refresh")}
                    </button>
                </div>
            </div>

            {/* 4 KPI Cards: MTD, Projected, Daily Burn Rate, Anomalies */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Gasto Total Acumulado */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm relative overflow-hidden group">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {t("kpiTotalMtdTitle")}
                        </span>
                        <InfoTooltip content={t("tooltip_kpi_total")} />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {format(data.totalCost)}
                        </span>
                        {data.momVariation !== undefined && (
                            <span
                                className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md ${
                                    data.momVariation > 0
                                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                                        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                                }`}
                            >
                                {data.momVariation > 0 ? (
                                    <IconTrendingUp className="w-3 h-3 mr-0.5 inline" />
                                ) : (
                                    <IconTrendingDown className="w-3 h-3 mr-0.5 inline" />
                                )}
                                {data.momVariation > 0 ? `+${data.momVariation}%` : `${data.momVariation}%`} MoM
                            </span>
                        )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {t("kpiTotalMtdSubtitle", {
                            elapsed: data.daysElapsed || new Date().getDate(),
                            total: data.daysInMonth || 30,
                        })}
                    </div>
                </div>

                {/* 2. Run Rate Proyectado */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm relative overflow-hidden group">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {t("kpiProjectedTitle")}
                        </span>
                        <InfoTooltip content={t("tooltip_kpi_projected")} />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-[#0054A6] dark:text-blue-400" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {format(data.projectedCost)}
                        </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {t("kpiProjectedSubtitle")}
                    </div>
                </div>

                {/* 3. Daily Burn Rate */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm relative overflow-hidden group">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <IconFlame className="w-4 h-4 text-amber-500" />
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                {t("kpiBurnRateTitle")}
                            </span>
                        </div>
                        <InfoTooltip content={t("tooltip_kpi_burn_rate")} />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {format(data.dailyBurnRate)}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{t("burnRateSuffix")}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {t("kpiBurnRateSubtitle")}
                    </div>
                </div>

                {/* 4. Alertas de Anomalías */}
                <div className={`p-4 bg-white dark:bg-slate-900 border rounded-xl shadow-sm relative overflow-hidden group ${
                    data.hasAnomalies
                        ? "border-amber-300 dark:border-amber-800/80 bg-amber-50/30 dark:bg-amber-950/10"
                        : "border-slate-200 dark:border-slate-800"
                }`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <IconAlertTriangle className={`w-4 h-4 ${data.hasAnomalies ? "text-amber-500 animate-bounce" : "text-emerald-500"}`} />
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                {t("kpiAnomaliesTitle")}
                            </span>
                        </div>
                        <InfoTooltip content={t("tooltip_kpi_anomalies")} />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className={`text-xl font-bold ${data.hasAnomalies ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`} style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {data.hasAnomalies ? `${data.anomalyCount || 1} detectada(s)` : "0 activas"}
                        </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {data.hasAnomalies
                            ? t("kpiAnomaliesActive", { count: data.anomalyCount || 1 })
                            : t("kpiAnomaliesNone")}
                    </div>
                </div>
            </div>

            {/* Stacked Multi-Color Progress Bar (Top 5 Share of Wallet) */}
            <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <IconLayersIntersect className="w-4 h-4 text-[#0054A6]" />
                        <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {t("shareOfWalletTitle")}
                        </h3>
                        <InfoTooltip content={t("tooltip_share_of_wallet")} />
                    </div>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        100% = {format(data.totalCost)}
                    </span>
                </div>

                {/* Progress Stack Bar */}
                <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex p-0.5 gap-0.5">
                    {top5Share.map((item, idx) => (
                        <div
                            key={idx}
                            style={{
                                width: `${Math.max(item.percentage, 3)}%`,
                                backgroundColor: item.color,
                            }}
                            className="h-full rounded-sm transition-all duration-500 hover:opacity-90 cursor-pointer relative group"
                            title={`${item.name}: ${format(item.cost)} (${item.percentage}%)`}
                        />
                    ))}
                </div>

                {/* Legend badges */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                    {top5Share.map((item, idx) => (
                        <div
                            key={idx}
                            onClick={() => {
                                const svc = services.find((s) => s.serviceKey === item.serviceKey || s.serviceName === item.name);
                                if (svc) setSelectedService(svc);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-[#0054A6] cursor-pointer transition-colors"
                        >
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            <span>{item.name}</span>
                            <span className="font-semibold text-slate-900 dark:text-white">{item.percentage}%</span>
                            <span className="text-slate-400">({format(item.cost)})</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Smart Service Cards Grid */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <IconCoins className="w-5 h-5 text-[#0054A6]" />
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {t("servicesGridTitle")}
                        </h3>
                        <InfoTooltip content={t("tooltip_services_grid")} />
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        {services.length} {t("instancesCount", { count: services.length })}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {services.map((svc) => {
                        const isDominant = svc.percentageOfTotal > 15;
                        return (
                            <div
                                key={svc.serviceKey}
                                onClick={() => setSelectedService(svc)}
                                className={`p-5 bg-white dark:bg-slate-900 border rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between group relative ${
                                    svc.hasAnomaly
                                        ? "border-amber-300 dark:border-amber-700 hover:border-amber-400"
                                        : isDominant
                                        ? "border-blue-200 dark:border-blue-900/60 hover:border-[#0054A6]"
                                        : "border-slate-200 dark:border-slate-800 hover:border-[#00AEEF]"
                                }`}
                            >
                                {/* Top Header */}
                                <div>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-lg bg-[rgb(233,241,250)] dark:bg-slate-800 text-[#0054A6] dark:text-[#00AEEF] border border-blue-100/80 dark:border-slate-700/60 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform shadow-none">
                                                {renderServiceIcon(svc.iconName, "w-4 h-4 text-[#0054A6] dark:text-[#00AEEF]")}
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white group-hover:text-[#0054A6] dark:group-hover:text-[#00AEEF] transition-colors" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                                    {svc.serviceName}
                                                </h4>
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                                    {svc.category}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-end gap-1">
                                            {svc.momVariation !== undefined && (
                                                <span
                                                    className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                                                        svc.momVariation > 10
                                                            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                                            : svc.momVariation < 0
                                                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                                    }`}
                                                >
                                                    {svc.momVariation > 0 ? `+${svc.momVariation}%` : `${svc.momVariation}%`} MoM
                                                </span>
                                            )}
                                            {svc.hasAnomaly && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500 text-white animate-pulse shadow-sm">
                                                    <IconAlertTriangle className="w-3 h-3" />
                                                    {t("anomalyBadge")}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* MTD & Projected Amount */}
                                    <div className="mt-4 flex items-baseline justify-between">
                                        <div>
                                            <span className="text-2xl font-extrabold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                                {format(svc.totalCost)}
                                            </span>
                                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 ml-1.5">
                                                {t("mtdLabel")}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                                {t("projectedLabel")}
                                            </div>
                                            <div className="text-xs font-bold text-[#0054A6] dark:text-blue-400">
                                                {format(svc.projectedCost)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Share of total progress bar */}
                                    <div className="mt-3 space-y-1">
                                        <div className="flex justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                            <span>{t("shareOfTotal", { percent: svc.percentageOfTotal })}</span>
                                            <span>{format(svc.totalCost)}</span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div
                                                style={{ width: `${Math.min(svc.percentageOfTotal, 100)}%` }}
                                                className={`h-full rounded-full transition-all duration-500 ${
                                                    isDominant ? "bg-[#0054A6]" : "bg-[#00AEEF]"
                                                }`}
                                            />
                                        </div>
                                    </div>

                                    {/* Informative metadata row */}
                                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-400 gap-2">
                                        <div className="flex items-center gap-1 font-medium">
                                            <IconFlame className="w-3.5 h-3.5 text-amber-500" />
                                            <span>{t("burnRateLabel")}</span>
                                            <span className="font-semibold text-slate-900 dark:text-white">
                                                {format(svc.dailyBurnRate)}{t("burnRateSuffix")}
                                            </span>
                                        </div>
                                        <div className="text-slate-500 dark:text-slate-400 font-medium">
                                            {t("instancesCount", { count: svc.resourceCount })}
                                        </div>
                                    </div>

                                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate" title={svc.primarySku}>
                                        SKU: {svc.primarySku}
                                    </div>
                                </div>

                                {/* Bottom Recommendation Block */}
                                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                                    <div className="p-2.5 rounded-lg bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 text-[11px] text-slate-700 dark:text-slate-300">
                                        <div className="font-semibold text-[#0054A6] dark:text-[#00AEEF] flex items-center gap-1 mb-0.5">
                                            <IconSparkles className="w-3.5 h-3.5" />
                                            {t("recommendationLabel")}
                                        </div>
                                        <div className="line-clamp-2 leading-relaxed">
                                            {svc.recommendation}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-1">
                                        <span className="text-[11px] text-[#0054A6] dark:text-[#00AEEF] font-semibold group-hover:underline flex items-center gap-1">
                                            {t("clickToDrillDown")}
                                        </span>
                                        {svc.potentialSavings > 0 && (
                                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                                ~{format(svc.potentialSavings)}/mes
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Quick Optimization Actions Block - Derivado 100% dinámico de los servicios reales */}
            {services.length > 0 && (
                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <IconSparkles className="w-5 h-5 text-[#0054A6]" />
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                {t("quickActionsTitle")}
                            </h3>
                            <InfoTooltip content={t("tooltip_quick_actions")} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {(services.filter((s) => s.potentialSavings > 0).length >= 3
                            ? services.filter((s) => s.potentialSavings > 0).slice(0, 6)
                            : services.slice(0, 6)
                        ).map((svc) => (
                            <div
                                key={svc.serviceKey}
                                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                                    svc.hasAnomaly
                                        ? "border-amber-200 dark:border-amber-800/60 bg-amber-50/20 dark:bg-amber-950/10"
                                        : "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30"
                                }`}
                            >
                                <div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold text-[#1B2A41] dark:text-white flex items-center gap-1.5 truncate">
                                            {renderServiceIcon(svc.iconName, "w-4 h-4 text-[#0054A6] flex-shrink-0")}
                                            <span className="truncate">{svc.serviceName}</span>
                                            <span className="text-slate-500 font-normal">({format(svc.totalCost)})</span>
                                        </span>
                                        {svc.potentialSavings > 0 ? (
                                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                                Ahorro: ~{format(svc.potentialSavings)}/mes
                                            </span>
                                        ) : svc.hasAnomaly ? (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500 text-white whitespace-nowrap">
                                                Pico 48h
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed line-clamp-2">
                                        {svc.recommendation}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleActionClick(svc.remediationActionKey, svc.serviceName)}
                                    className="w-full py-2 px-3 rounded-xl border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                >
                                    {actionExecuted === svc.remediationActionKey ? (
                                        <>
                                            <IconCheck className="w-4 h-4 text-emerald-600" />
                                            <span>Remediación Simulada</span>
                                        </>
                                    ) : (
                                        <>
                                            <IconSparkles className="w-3.5 h-3.5" />
                                            <span>{svc.remediationActionLabel || t("btnSimulateAction")}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Drill-down Drawer / Slide-Over Modal */}
            {selectedService && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
                    <div
                        className="w-full max-w-4xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Drawer Header */}
                        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-[rgb(233,241,250)] dark:bg-slate-800 text-[#0054A6] dark:text-[#00AEEF] border border-blue-100/80 dark:border-slate-700/60 flex items-center justify-center flex-shrink-0 shadow-none">
                                    {renderServiceIcon(selectedService.iconName, "w-6 h-6 text-[#0054A6] dark:text-[#00AEEF]")}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-lg font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                            {selectedService.serviceName}
                                        </h3>
                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-[#0054A6] dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                                            {t("shareOfTotal", { percent: selectedService.percentageOfTotal })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        {t("drawerSubtitle", { service: selectedService.serviceName })}
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setSelectedService(null)}
                                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Drawer KPIs Bar */}
                        <div className="px-6 py-3 bg-blue-50/30 dark:bg-blue-950/10 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
                            <div className="flex items-center gap-4">
                                <span className="font-semibold text-slate-900 dark:text-white">
                                    {t("drawerTotalCost", { cost: format(selectedService.totalCost) })}
                                </span>
                                <span className="text-slate-400">|</span>
                                <span className="text-slate-600 dark:text-slate-400">
                                    {t("drawerResourceCount", { count: selectedService.resourceCount })}
                                </span>
                                <span className="text-slate-400">|</span>
                                <span className="text-slate-600 dark:text-slate-400 font-medium">
                                    Burn Rate: <strong className="text-slate-900 dark:text-white">{format(selectedService.dailyBurnRate)}/día</strong>
                                </span>
                            </div>
                            <div className="text-right">
                                <span className="text-slate-500 dark:text-slate-400">Proyección fin de mes: </span>
                                <strong className="text-[#0054A6] dark:text-blue-400">{format(selectedService.projectedCost)}</strong>
                            </div>
                        </div>

                        {/* Search & Filters */}
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
                            <div className="flex-1 min-w-[200px]">
                                <input
                                    type="text"
                                    placeholder={t("searchPlaceholder")}
                                    value={drawerSearch}
                                    onChange={(e) => setDrawerSearch(e.target.value)}
                                    className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#0054A6]"
                                />
                            </div>

                            {availableRegions.length > 1 && (
                                <select
                                    value={drawerRegionFilter}
                                    onChange={(e) => setDrawerRegionFilter(e.target.value)}
                                    className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-[#0054A6]"
                                >
                                    <option value="all">{t("allRegions")}</option>
                                    {availableRegions.map((reg) => (
                                        <option key={reg} value={reg}>
                                            {reg}
                                        </option>
                                    ))}
                                </select>
                            )}

                            {availableGroups.length > 1 && (
                                <select
                                    value={drawerGroupFilter}
                                    onChange={(e) => setDrawerGroupFilter(e.target.value)}
                                    className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-[#0054A6]"
                                >
                                    <option value="all">{t("allGroups")}</option>
                                    {availableGroups.map((grp) => (
                                        <option key={grp} value={grp}>
                                            {grp}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* Resources Table */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {filteredResources.length === 0 ? (
                                <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm">
                                    {t("noResourcesFound")}
                                </div>
                            ) : (
                                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                                                <th className="py-3 px-4">{t("colResource")}</th>
                                                <th className="py-3 px-3">{t("colGroup")}</th>
                                                <th className="py-3 px-3">{t("colRegion")}</th>
                                                <th className="py-3 px-3">{t("colSku")}</th>
                                                <th className="py-3 px-3 text-right font-bold text-[#0054A6] dark:text-blue-400">
                                                    <span className="flex items-center justify-end gap-1">
                                                        {t("colMtdCost")}
                                                        <InfoTooltip content={t("tooltip_col_billed")} />
                                                    </span>
                                                </th>
                                                <th className="py-3 px-4 text-center">{t("colAction")}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                                            {filteredResources.map((res) => (
                                                <tr
                                                    key={res.id}
                                                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                                                >
                                                    <td className="py-3 px-4">
                                                        <div className="font-semibold text-slate-900 dark:text-white">
                                                            {res.resourceName}
                                                        </div>
                                                        {res.isAnomaly && (
                                                            <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500 text-white">
                                                                Pico inusual
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                                                        {res.resourceGroup}
                                                    </td>
                                                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400 font-mono">
                                                        {res.region}
                                                    </td>
                                                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                                                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">
                                                            {res.sku}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-3 text-right font-bold text-[#0054A6] dark:text-blue-400 font-mono">
                                                        {format(res.costMtd)}
                                                    </td>
                                                    <td className="py-3 px-4 text-center">
                                                        {res.remediationSuggested ? (
                                                            <button
                                                                onClick={() =>
                                                                    handleActionClick(
                                                                        res.remediationActionKey || "opt",
                                                                        selectedService?.serviceName || res.resourceName,
                                                                        res
                                                                    )
                                                                }
                                                                title={res.remediationSuggested}
                                                                className="px-2.5 py-1 rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50 text-[11px] font-semibold transition-colors shadow-sm whitespace-nowrap"
                                                            >
                                                                Optimizar ✨
                                                            </button>
                                                        ) : (
                                                            <span className="text-slate-400 text-[11px]">-</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Drawer Footer */}
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                {filteredResources.length} {t("instancesCount", { count: filteredResources.length })}
                            </span>
                            <button
                                onClick={() => setSelectedService(null)}
                                className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 text-xs font-semibold transition-colors shadow-sm"
                            >
                                {t("btnClose")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Remediación y Optimización FinOps interactivo */}
            <FinOpsRemediationModal
                isOpen={!!optimizationTarget}
                onClose={() => setOptimizationTarget(null)}
                target={optimizationTarget}
            />
        </div>
    );
}

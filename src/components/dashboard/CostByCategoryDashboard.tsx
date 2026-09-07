"use client";
import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { isMockTenant } from "@/lib/mockData";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import InfoTooltip from "@/components/InfoTooltip";
import FinOpsRemediationModal, { type OptimizationTarget } from "@/components/dashboard/FinOpsRemediationModal";
import {
    IconDatabase,
    IconCpu,
    IconNetwork,
    IconBrain,
    IconServer2,
    IconShieldLock,
    IconChartDots,
    IconBrowser,
    IconSettings,
    IconLayersLinked,
    IconTrendingUp,
    IconTrendingDown,
    IconAlertTriangle,
    IconSparkles,
    IconCheck,
    IconX,
    IconSearch,
    IconDownload,
    IconChartBar,
    IconChartAreaLine,
    IconFlame,
    IconCoins,
    IconTarget,
    IconArrowUpRight,
} from "@tabler/icons-react";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip as RechartsTooltip,
    Legend,
    CartesianGrid,
} from "recharts";
import {
    CATEGORY_COLOR_MAP,
    type CategoryOverview,
    type FinOpsCategoryDetail,
    type CategoryResourceDetail,
    type CategoryOptimizationOpportunity,
} from "@/lib/categoryConsumptionTypes";

export default function CostByCategoryDashboard() {
    const t = useProviderTranslations("CostByCategory");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();

    const [viewMode, setViewMode] = useState<"stacked_bar" | "stacked_area">("stacked_bar");
    const [selectedCategory, setSelectedCategory] = useState<FinOpsCategoryDetail | null>(null);
    const [drawerSearch, setDrawerSearch] = useState("");
    const [drawerRegionFilter, setDrawerRegionFilter] = useState("all");
    const [drawerGroupFilter, setDrawerGroupFilter] = useState("all");
    const [actionExecuted, setActionExecuted] = useState<string | null>(null);
    const [optimizationTarget, setOptimizationTarget] = useState<OptimizationTarget | null>(null);

    const fetcher = async (url: string): Promise<CategoryOverview> => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${idToken}`,
                "x-tenant-id": selectedTenant?.id ?? "",
            },
        });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || t("error"));
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR<CategoryOverview>(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/cost-by-category?tenantId=${selectedTenant.id}&days=30`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    // Filtered resources for Drawer
    const filteredResources = useMemo(() => {
        if (!selectedCategory?.resources) return [];
        return selectedCategory.resources.filter((res: CategoryResourceDetail) => {
            const matchSearch =
                !drawerSearch ||
                res.name.toLowerCase().includes(drawerSearch.toLowerCase()) ||
                res.service.toLowerCase().includes(drawerSearch.toLowerCase()) ||
                res.resourceGroup.toLowerCase().includes(drawerSearch.toLowerCase()) ||
                res.sku.toLowerCase().includes(drawerSearch.toLowerCase()) ||
                res.region.toLowerCase().includes(drawerSearch.toLowerCase());
            const matchRegion = drawerRegionFilter === "all" || res.region === drawerRegionFilter;
            const matchGroup = drawerGroupFilter === "all" || res.resourceGroup === drawerGroupFilter;
            return matchSearch && matchRegion && matchGroup;
        });
    }, [selectedCategory, drawerSearch, drawerRegionFilter, drawerGroupFilter]);

    // Available filter dropdown options
    const availableRegions = useMemo(() => {
        if (!selectedCategory?.resources) return [];
        return Array.from(new Set(selectedCategory.resources.map((r) => r.region)));
    }, [selectedCategory]);

    const availableGroups = useMemo(() => {
        if (!selectedCategory?.resources) return [];
        return Array.from(new Set(selectedCategory.resources.map((r) => r.resourceGroup)));
    }, [selectedCategory]);

    const handleActionClick = (
        actionKey: string,
        resourceDetail?: CategoryResourceDetail,
        opportunity?: CategoryOptimizationOpportunity
    ) => {
        setActionExecuted(actionKey);
        if (resourceDetail) {
            setOptimizationTarget({
                resourceName: resourceDetail.name,
                resourceGroup: resourceDetail.resourceGroup,
                service: resourceDetail.service,
                category: selectedCategory?.category,
                region: resourceDetail.region,
                currentSku: resourceDetail.sku,
                remediationTitle: resourceDetail.optimizationActionKey
                    ? t(resourceDetail.optimizationActionKey)
                    : t("optOfResource", { name: resourceDetail.name }),
                remediationDescription: t("remedForResource", {
                    name: resourceDetail.name,
                    sku: resourceDetail.sku,
                    rg: resourceDetail.resourceGroup,
                    action: resourceDetail.optimizationActionKey
                        ? t(resourceDetail.optimizationActionKey)
                        : t("defaultAction"),
                }),
                actionKey: actionKey,
                monthlySavings: Math.max(resourceDetail.cost * 0.25, 20),
                riskLevel: "low",
            });
        } else if (opportunity) {
            setOptimizationTarget({
                resourceName: t(`cc_act_${opportunity.actionKey}`),
                category: opportunity.category,
                remediationTitle: t(`cc_act_${opportunity.actionKey}`),
                remediationDescription: t(`cc_rec_${opportunity.actionKey}`, opportunity.params),
                actionKey: actionKey,
                monthlySavings: opportunity.potentialSavings,
                riskLevel: opportunity.impactLevel || "low",
            });
        } else {
            setOptimizationTarget({
                resourceName: selectedCategory?.category || t("genericResource"),
                category: selectedCategory?.category,
                remediationTitle: t("optOfCategory"),
                remediationDescription: t("optOfCategoryDesc"),
                actionKey: actionKey,
                monthlySavings: selectedCategory?.potentialSavings || 50,
                riskLevel: "low",
            });
        }
    };

    // CSV Exporter for category resources
    const exportCategoryCsv = () => {
        if (!selectedCategory || !filteredResources.length) return;
        const headers = ["ResourceName", "Service", "ResourceGroup", "Region", "SKU", "CostMTD_USD"];
        const rows = filteredResources.map((r) => [
            `"${r.name}"`,
            `"${r.service}"`,
            `"${r.resourceGroup}"`,
            `"${r.region}"`,
            `"${r.sku}"`,
            r.cost.toFixed(2),
        ]);
        const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `focus_category_${selectedCategory.category.toLowerCase()}_resources.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Render Tabler Icon based on name
    const renderCategoryIcon = (iconName: string, className: string = "w-5 h-5") => {
        switch (iconName) {
            case "database":
                return <IconDatabase className={className} />;
            case "cpu":
                return <IconCpu className={className} />;
            case "network":
                return <IconNetwork className={className} />;
            case "brain":
                return <IconBrain className={className} />;
            case "hard-drive":
            case "storage":
                return <IconServer2 className={className} />;
            case "shield-lock":
                return <IconShieldLock className={className} />;
            case "chart-dots":
                return <IconChartDots className={className} />;
            case "browser":
                return <IconBrowser className={className} />;
            case "settings":
                return <IconSettings className={className} />;
            default:
                return <IconLayersLinked className={className} />;
        }
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-800" />
                    ))}
                </div>
                <div className="h-44 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-800" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="h-48 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-800" />
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return (
                <TierLockedNotice
                    requiredTier={requiredTier}
                    currentTier={(selectedTenant as any)?.tier}
                    featureName={t("featureName")}
                />
            );
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-100 dark:border-red-900/50 flex items-center gap-2">
                <IconAlertTriangle className="w-5 h-5" />
                <span className="text-sm font-semibold">{error.message}</span>
            </div>
        );
    }

    if (!data || data.empty || !data.categories || data.categories.length === 0) {
        return (
            <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 p-4 rounded-xl border border-blue-100 dark:border-blue-900/50">
                <IconChartBar className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{data?.message || t("empty")}</p>
            </div>
        );
    }

    const categories = data.categories || [];
    const historicalData = data.historical6Months || [];

    // Distinct category names present in history for Recharts Area keys
    const historicalCategories = Array.from(
        new Set(
            historicalData.flatMap((pt) =>
                Object.keys(pt).filter((k) => k !== "month")
            )
        )
    );

    return (
        <div className="space-y-6">
            {/* Header KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* KPI 1: Gasto Total MTD */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm relative overflow-hidden group">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <IconCoins className="w-4 h-4 text-[#0054A6]" />
                            {t("kpiTotalMtdTitle")}
                        </span>
                        <InfoTooltip content={t("tooltip_kpi_total")} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-2xl font-extrabold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {format(data.total)}
                        </span>
                        {data.overallMomVariation !== 0 && (
                            <span
                                className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md ${
                                    data.overallMomVariation > 0
                                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                                        : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                }`}
                            >
                                {data.overallMomVariation > 0 ? (
                                    <IconTrendingUp className="w-3 h-3 mr-0.5" />
                                ) : (
                                    <IconTrendingDown className="w-3 h-3 mr-0.5" />
                                )}
                                {data.overallMomVariation > 0 ? `+${data.overallMomVariation}%` : `${data.overallMomVariation}%`} MoM
                            </span>
                        )}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {data.mock ? t("mockBadge") : "Consumo consolidado MTD"}
                    </div>
                </div>

                {/* KPI 2: Categoría Dominante */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm relative overflow-hidden group">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <IconTarget className="w-4 h-4 text-[#0054A6]" />
                            {t("kpiDominantCategory")}
                        </span>
                        <InfoTooltip content={t("tooltip_kpi_dominant")} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-xl font-bold text-[#1B2A41] dark:text-white truncate" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {data.topCategory || "N/A"}
                        </span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-[#0054A6] dark:text-[#00AEEF] border border-blue-200 dark:border-blue-800">
                            {data.topCategoryPercentage}%
                        </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {t("topConcentration")}
                    </div>
                </div>

                {/* KPI 3: Run Rate Proyectado */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm relative overflow-hidden group">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <IconSparkles className="w-4 h-4 text-[#0054A6]" />
                            {t("kpiProjectedTitle")}
                        </span>
                        <InfoTooltip content={t("tooltip_kpi_projected")} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-2xl font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {format(data.projectedTotal)}
                        </span>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {t("monthEnd")}
                        </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {t("linearProjection")}
                    </div>
                </div>

                {/* KPI 4: Daily Burn Rate */}
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm relative overflow-hidden group">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <IconFlame className="w-4 h-4 text-amber-500" />
                            {t("kpiDailyBurnTitle")}
                        </span>
                        <InfoTooltip content={t("tooltip_kpi_burn")} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-2xl font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {t("perDay", { v: format(data.dailyBurnRate) })}
                        </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {t("averageBurnRate")}
                    </div>
                </div>
            </div>

            {/* Visualizations Switcher & Visual Display Block */}
            <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {viewMode === "stacked_bar" ? t("viewStackedBar") : t("viewStackedArea")}
                        </h3>
                        <InfoTooltip
                            content={
                                viewMode === "stacked_bar"
                                    ? t("tooltip_view_stacked_bar")
                                    : t("tooltip_view_stacked_area")
                            }
                        />
                    </div>

                    {/* Switcher Buttons */}
                    <div className="inline-flex rounded-xl p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => setViewMode("stacked_bar")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                viewMode === "stacked_bar"
                                    ? "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-[#00AEEF] shadow-sm border border-slate-200 dark:border-slate-700"
                                    : "text-slate-600 dark:text-slate-400 hover:text-[#0054A6]"
                            }`}
                        >
                            <IconChartBar className="w-3.5 h-3.5" />
                            {t("viewStackedBar")}
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("stacked_area")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                viewMode === "stacked_area"
                                    ? "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-[#00AEEF] shadow-sm border border-slate-200 dark:border-slate-700"
                                    : "text-slate-600 dark:text-slate-400 hover:text-[#0054A6]"
                            }`}
                        >
                            <IconChartAreaLine className="w-3.5 h-3.5" />
                            {t("viewStackedArea")}
                        </button>
                    </div>
                </div>

                {/* View 1: MTD Stacked Bar with interactive chips */}
                {viewMode === "stacked_bar" && (
                    <div className="space-y-4">
                        <div className="w-full h-5 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800 shadow-inner">
                            {categories.map((c) => (
                                <div
                                    key={c.category}
                                    style={{
                                        width: `${Math.max(c.percentage, 2)}%`,
                                        backgroundColor: c.color,
                                    }}
                                    className="h-full transition-all duration-300 hover:opacity-80 cursor-pointer"
                                    title={`${c.category}: ${format(c.totalCost)} (${c.percentage}%)`}
                                    onClick={() => setSelectedCategory(c)}
                                />
                            ))}
                        </div>

                        {/* Interactive Chips Legend */}
                        <div className="flex flex-wrap gap-2 pt-2">
                            {categories.map((c) => (
                                <button
                                    key={c.category}
                                    type="button"
                                    onClick={() => setSelectedCategory(c)}
                                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                    <span
                                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: c.color }}
                                    />
                                    <span className="font-semibold text-[#1B2A41] dark:text-white">{c.category}:</span>
                                    <span>{format(c.totalCost)}</span>
                                    <span className="text-slate-400 text-[11px]">({c.percentage}%)</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* View 2: Stacked Area Chart (6 Months) */}
                {viewMode === "stacked_area" && (
                    <div className="w-full h-72 pt-2">
                        {historicalData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={historicalData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.2} />
                                    <XAxis
                                        dataKey="month"
                                        stroke="#64748B"
                                        fontSize={11}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        stroke="#64748B"
                                        fontSize={11}
                                        tickFormatter={(v) => `$${v}`}
                                        tickLine={false}
                                    />
                                    <RechartsTooltip
                                        contentStyle={{
                                            backgroundColor: "#1B2A41",
                                            borderColor: "#475569",
                                            borderRadius: "12px",
                                            color: "#FFFFFF",
                                            fontSize: "12px",
                                            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
                                        }}
                                        formatter={(val: any, name: any) => [`$${Number(val).toFixed(2)}`, name]}
                                    />
                                    <Legend
                                        wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }}
                                    />
                                    {historicalCategories.map((catKey) => (
                                        <Area
                                            key={catKey}
                                            type="monotone"
                                            dataKey={catKey}
                                            stackId="1"
                                            stroke={CATEGORY_COLOR_MAP[catKey] || "#94A3B8"}
                                            fill={CATEGORY_COLOR_MAP[catKey] || "#94A3B8"}
                                            fillOpacity={0.7}
                                        />
                                    ))}
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                                {t("notEnoughHistory")}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Smart Category Cards Grid */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
                        <IconLayersLinked className="w-5 h-5 text-[#0054A6]" />
                        {t("focusCategoriesCount", { n: categories.length })}
                    </h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        {t("clickToDrillDown")}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {categories.map((cat) => {
                        const isExceeded = cat.budget.spentPercentage > 100;
                        return (
                            <div
                                key={cat.category}
                                onClick={() => setSelectedCategory(cat)}
                                className={`p-5 bg-white dark:bg-slate-900 border rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between group relative ${
                                    cat.hasSpike
                                        ? "border-amber-300 dark:border-amber-800"
                                        : "border-slate-200 dark:border-slate-800 hover:border-[#0054A6] dark:hover:border-blue-500"
                                }`}
                            >
                                <div>
                                    {/* Card Header */}
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[rgb(233,241,250)] dark:bg-slate-800 text-[#0054A6] dark:text-[#00AEEF] border border-blue-100/80 dark:border-slate-700/60 shadow-none">
                                                {renderCategoryIcon(cat.iconName, "w-5 h-5 text-[#0054A6] dark:text-[#00AEEF]")}
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white leading-tight flex items-center gap-1.5" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                                    {cat.category}
                                                    <IconArrowUpRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </h4>
                                                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                                    {t("percentOfTotal", { pct: cat.percentage })}
                                                </span>
                                            </div>
                                        </div>

                                        {/* MoM Badge */}
                                        {cat.momVariation !== 0 && (
                                            <span
                                                className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                                                    cat.momVariation > 0
                                                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                                                        : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                                }`}
                                            >
                                                {cat.momVariation > 0 ? (
                                                    <IconTrendingUp className="w-3 h-3 mr-0.5" />
                                                ) : (
                                                    <IconTrendingDown className="w-3 h-3 mr-0.5" />
                                                )}
                                                {cat.momVariation > 0 ? `+${cat.momVariation}%` : `${cat.momVariation}%`} MoM
                                            </span>
                                        )}
                                    </div>

                                    {/* Cost Amount & Projection */}
                                    <div className="mt-4 flex items-baseline justify-between">
                                        <div>
                                            <span className="text-2xl font-extrabold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                                {format(cat.totalCost)}
                                            </span>
                                            <span className="text-[11px] text-slate-500 font-medium ml-1">MTD</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                {t("projectionValue", { v: format(cat.projectedCost) })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Budget Execution Bar */}
                                    <div className="mt-3 space-y-1">
                                        <div className="flex justify-between text-[11px] text-slate-500">
                                            <span>
                                                {t("budgetLabel")} {format(cat.budget.monthlyBudget)}
                                            </span>
                                            <span className={`font-bold ${isExceeded ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                {cat.budget.spentPercentage}% ({isExceeded ? t("budgetExceeded") : t("budgetOnTrack")})
                                            </span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div
                                                style={{ width: `${Math.min(cat.budget.spentPercentage, 100)}%` }}
                                                className={`h-full rounded-full transition-all duration-500 ${
                                                    isExceeded
                                                        ? "bg-amber-500"
                                                        : "bg-emerald-500"
                                                }`}
                                            />
                                        </div>
                                    </div>

                                    {/* Top 2 Services Micro-List */}
                                    {cat.services && cat.services.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                {t("topServicesTitle")}
                                            </span>
                                            <div className="space-y-1">
                                                {cat.services.slice(0, 2).map((s) => (
                                                    <div key={s.name} className="flex items-center justify-between text-xs">
                                                        <span className="text-slate-600 dark:text-slate-400 truncate max-w-[170px]">
                                                            {s.name}
                                                        </span>
                                                        <span className="font-semibold text-[#1B2A41] dark:text-white">
                                                            {format(s.cost)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Card Footer: Commitment Mix & Action Hint */}
                                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
                                    <span className="text-slate-500">
                                        {t("burnShort")} <strong className="text-[#1B2A41] dark:text-white">{t("perDay", { v: format(cat.dailyBurnRate) })}</strong>
                                    </span>
                                    {cat.commitmentMix.commitmentPct > 0 ? (
                                        <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-[#0054A6] dark:text-[#00AEEF] font-semibold text-[10px] border border-blue-200 dark:border-blue-800">
                                            {t("commitmentPct", { pct: cat.commitmentMix.commitmentPct })}
                                        </span>
                                    ) : (
                                        <span className="text-slate-400 text-[10px]">
                                            {t("onDemandPct", { pct: 100 })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Opportunities Panel by Dominant Category */}
            {data.optimizationOpportunities && data.optimizationOpportunities.length > 0 && (
                <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <IconSparkles className="w-5 h-5 text-[#0054A6]" />
                            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                {t("optimizationTitle")}
                            </h3>
                            <InfoTooltip content={t("tooltip_optimization")} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {data.optimizationOpportunities.map((opp, idx) => (
                            <div
                                key={`${opp.actionKey}-${opp.category}-${idx}`}
                                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between gap-3"
                            >
                                <div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold text-[#1B2A41] dark:text-white flex items-center gap-1.5">
                                            <span
                                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                style={{ backgroundColor: CATEGORY_COLOR_MAP[opp.category] || "#0054A6" }}
                                            />
                                            {opp.category}
                                        </span>
                                        {opp.potentialSavings > 0 && (
                                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                                {t("savingsValue", { v: format(opp.potentialSavings) })}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
                                        {t(`cc_rec_${opp.actionKey}`, opp.params)}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleActionClick(opp.actionKey, undefined, opp)}
                                    className="w-full py-2 px-3 rounded-xl border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                >
                                    {actionExecuted === opp.actionKey ? (
                                        <>
                                            <IconCheck className="w-4 h-4 text-emerald-600" />
                                            <span>{t("simulatedRemediation")}</span>
                                        </>
                                    ) : (
                                        <>
                                            <IconSparkles className="w-3.5 h-3.5" />
                                            <span>{t(`cc_act_${opp.actionKey}`)}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Drill-down Drawer / Slide-Over Modal */}
            {selectedCategory && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
                    <div
                        className="w-full max-w-4xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Drawer Header */}
                        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-[rgb(233,241,250)] dark:bg-slate-800 text-[#0054A6] dark:text-[#00AEEF] border border-blue-100/80 dark:border-slate-700/60 flex items-center justify-center flex-shrink-0 shadow-none">
                                    {renderCategoryIcon(selectedCategory.iconName, "w-6 h-6 text-[#0054A6] dark:text-[#00AEEF]")}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-lg font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                            {t("drawerTitle", { category: selectedCategory.category })}
                                        </h3>
                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-[#0054A6] dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                                            {t("percentOfTotal", { pct: selectedCategory.percentage })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        {t("drawerSubtitle", { category: selectedCategory.category })}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedCategory(null)}
                                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Category Stats Header in Drawer */}
                        <div className="grid grid-cols-3 gap-4 p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
                            <div>
                                <span className="text-[11px] text-slate-500 uppercase tracking-wider block">{t("mtdSpend")}</span>
                                <span className="text-lg font-extrabold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                    {format(selectedCategory.totalCost)}
                                </span>
                            </div>
                            <div>
                                <span className="text-[11px] text-slate-500 uppercase tracking-wider block">{t("kpiDailyBurnTitle")}</span>
                                <span className="text-lg font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                    {t("perDay", { v: format(selectedCategory.dailyBurnRate) })}
                                </span>
                            </div>
                            <div>
                                <span className="text-[11px] text-slate-500 uppercase tracking-wider block">{t("eomProjection")}</span>
                                <span className="text-lg font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                                    {format(selectedCategory.projectedCost)}
                                </span>
                            </div>
                        </div>

                        {/* Search & Filters */}
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between flex-wrap gap-3">
                            <div className="relative flex-1 min-w-[200px]">
                                <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={drawerSearch}
                                    onChange={(e) => setDrawerSearch(e.target.value)}
                                    placeholder={t("searchPlaceholder")}
                                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
                                />
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                                {availableRegions.length > 1 && (
                                    <select
                                        value={drawerRegionFilter}
                                        onChange={(e) => setDrawerRegionFilter(e.target.value)}
                                        className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 focus:outline-none"
                                    >
                                        <option value="all">{t("allRegions")}</option>
                                        {availableRegions.map((r) => (
                                            <option key={r} value={r}>
                                                {r}
                                            </option>
                                        ))}
                                    </select>
                                )}

                                {availableGroups.length > 1 && (
                                    <select
                                        value={drawerGroupFilter}
                                        onChange={(e) => setDrawerGroupFilter(e.target.value)}
                                        className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-slate-300 focus:outline-none"
                                    >
                                        <option value="all">{t("allGroups")}</option>
                                        {availableGroups.map((g) => (
                                            <option key={g} value={g}>
                                                {g}
                                            </option>
                                        ))}
                                    </select>
                                )}

                                <button
                                    onClick={exportCategoryCsv}
                                    className="py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                                >
                                    <IconDownload className="w-3.5 h-3.5" />
                                    {t("exportCsv")}
                                </button>
                            </div>
                        </div>

                        {/* Resources Table */}
                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                                        <tr>
                                            <th className="py-3 px-4">{t("colResource")}</th>
                                            <th className="py-3 px-4">{t("colService")}</th>
                                            <th className="py-3 px-4">{t("colGroup")}</th>
                                            <th className="py-3 px-4">{t("colRegion")}</th>
                                            <th className="py-3 px-4">{t("colSku")}</th>
                                            <th className="py-3 px-4 text-right">{t("colCost")}</th>
                                            <th className="py-3 px-4 text-center">{t("colAction")}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                                        {filteredResources.map((res: CategoryResourceDetail) => (
                                            <tr key={res.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                                <td className="py-3 px-4 font-semibold text-[#1B2A41] dark:text-white">
                                                    {res.name}
                                                </td>
                                                <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                                                    {res.service}
                                                </td>
                                                <td className="py-3 px-4 text-slate-500">
                                                    {res.resourceGroup}
                                                </td>
                                                <td className="py-3 px-4 text-slate-500">
                                                    {res.region}
                                                </td>
                                                <td className="py-3 px-4 text-slate-500">
                                                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-mono">
                                                        {res.sku}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-right font-bold text-[#1B2A41] dark:text-white">
                                                    {format(res.cost)}
                                                </td>
                                                <td className="py-3 px-4 text-center">
                                                    {res.optimizationKey ? (
                                                        <button
                                                            onClick={() => handleActionClick(res.optimizationKey!, res)}
                                                            className="py-1 px-2.5 rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 mx-auto"
                                                        >
                                                            <IconSparkles className="w-3 h-3" />
                                                            <span>{t("optimize")}</span>
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-400 text-[11px]">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Drawer Footer */}
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                            <span className="text-xs text-slate-500">
                                {t("showingResourcesOf", { n: filteredResources.length, cat: selectedCategory.category })}
                            </span>
                            <button
                                onClick={() => setSelectedCategory(null)}
                                className="py-2 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 text-xs font-semibold transition-colors shadow-sm"
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

            {/* Source Footer */}
            <p className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                <IconChartBar className="w-3.5 h-3.5" /> {t("source")}
            </p>
        </div>
    );
}

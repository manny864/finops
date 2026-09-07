"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import {
    IconFolders,
    IconKey,
    IconLayersLinked,
    IconCpu,
    IconRefresh,
    IconCalendar,
    IconFilter,
    IconInfoCircle,
    IconAlertCircle,
    IconLoader2,
} from "@tabler/icons-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList } from "recharts";
import { isMockTenant } from "@/lib/mockData";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import InfoTooltip from "@/components/InfoTooltip";
import { useChartTheme } from "@/lib/chartTheme";
import type { TopSpendItem, TopSpendSummary } from "@/types/topSpend.types";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n || 0);

interface PanelCardProps {
    title: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    items: TopSpendItem[];
    emptyHint: string;
    totalCostUSD: number;
    extraNote?: React.ReactNode;
}

function PanelCard({
    title,
    description,
    icon,
    color,
    items,
    emptyHint,
    totalCostUSD,
    extraNote,
}: PanelCardProps) {
    const chart = useChartTheme();
    const t = useProviderTranslations("TopExpenses");
    const cardTotal = items.reduce((sum, it) => sum + (it.costUSD || 0), 0);
    const cardShare = totalCostUSD > 0 ? ((cardTotal / totalCostUSD) * 100).toFixed(1) : "0.0";

    const chartHeight = Math.max(220, items.length * 64);

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 flex flex-col justify-between transition-all hover:shadow-md">
            {/* Header */}
            <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2.5">
                        <span className="text-[#0078D4] dark:text-white bg-transparent p-0 shrink-0">
                            {icon}
                        </span>
                        <h3 className="text-base font-bold text-[#1B2A41] dark:text-white font-heading">
                            {title}
                        </h3>
                        <InfoTooltip content={description} />
                    </div>
                    <div className="text-right shrink-0">
                        <div className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">
                            {fmtUsd(cardTotal)}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t("pctOfTotal", { pct: cardShare })}
                        </div>
                    </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
                    {description}
                </p>

                {/* Chart or Empty */}
                {!items || items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-56 px-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/20">
                        <IconInfoCircle className="w-8 h-8 text-slate-400 dark:text-slate-300 mb-2" stroke={1.5} />
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            {emptyHint}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            {t("empty_detail")}
                        </p>
                    </div>
                ) : (
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={chartHeight}>
                            <BarChart
                                data={items}
                                layout="vertical"
                                margin={{ top: 8, right: 70, left: 10, bottom: 8 }}
                            >
                                <XAxis
                                    type="number"
                                    tick={{ fontSize: 11, fill: chart.tick }}
                                    domain={[0, "auto"]}
                                    tickFormatter={(val) => `$${Math.round(val)}`}
                                    axisLine={{ stroke: chart.axis }}
                                    tickLine={false}
                                />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    tick={{ fontSize: 12, fill: chart.tick, fontWeight: 500 }}
                                    width={180}
                                    axisLine={{ stroke: chart.axis }}
                                    tickLine={false}
                                    tickFormatter={(val) => {
                                        if (val && val.length > 24) {
                                            return `${val.substring(0, 22)}...`;
                                        }
                                        return val;
                                    }}
                                />
                                <Tooltip
                                    cursor={{ fill: "rgba(0, 84, 166, 0.05)" }}
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const item = payload[0].payload as TopSpendItem;
                                            return (
                                                <div className="bg-[#1B2A41] text-white p-3 rounded-xl shadow-2xl border border-slate-700 text-xs z-[99999] max-w-xs">
                                                    <p className="font-bold text-white mb-1">
                                                        {item.name}
                                                    </p>
                                                    {item.subText && (
                                                        <p className="text-[11px] text-slate-300 mb-2">
                                                            {item.subText}
                                                        </p>
                                                    )}
                                                    <div className="flex items-center justify-between gap-4 pt-1.5 border-t border-slate-600/60 font-mono">
                                                        <span className="text-slate-300">{t("cost_axis")}:</span>
                                                        <span className="font-bold text-[#00AEEF]">
                                                            {fmtUsd(item.costUSD)}
                                                        </span>
                                                    </div>
                                                    {item.sharePercentage !== undefined && (
                                                        <div className="flex items-center justify-between gap-4 pt-1 text-[11px]">
                                                            <span className="text-slate-300">{t("share_label")}</span>
                                                            <span className="font-semibold text-emerald-400">
                                                                {item.sharePercentage}%
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Bar
                                    dataKey="costUSD"
                                    fill={color}
                                    radius={[0, 6, 6, 0]}
                                    barSize={28}
                                    // MEJ-02: antes deshabilitada siempre (ver
                                    // useChartTheme para el porqué); ahora reactiva
                                    // -- se pierde la animación sólo cuando la
                                    // pestaña carga oculta o el usuario pidió
                                    // reducir movimiento, no siempre.
                                    isAnimationActive={chart.animate}
                                >
                                    <LabelList
                                        dataKey="costUSD"
                                        position="right"
                                        formatter={(v: any) => fmtUsd(Number(v))}
                                        style={{ fontSize: 11.5, fontWeight: 700, fill: chart.tick }}
                                    />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* Extra note footer */}
            {extraNote && <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">{extraNote}</div>}
        </div>
    );
}

export default function TopSpendBoard() {
    const t = useProviderTranslations("TopExpenses");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [limit, setLimit] = useState<number>(5);
    const [timeframe, setTimeframe] = useState<"mtd" | "30d">("30d");

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${idToken}`,
                "x-tenant-id": selectedTenant?.id ?? "",
            },
        });
        if (!res.ok) {
            const j = await res.json();
            throw new Error(j.details || j.error || t("load_error"));
        }
        return res.json();
    };

    const isMock = selectedTenant?.id ? isMockTenant(selectedTenant.id) : false;
    const shouldFetch = selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMock);

    const { data, error, isLoading, mutate } = useSWR<TopSpendSummary>(
        shouldFetch
            ? `/api/intelligence/top-expenses?tenantId=${selectedTenant.id}&timeframe=${timeframe}&limit=${limit}`
            : null,
        fetcher,
        { revalidateOnFocus: false, revalidateOnReconnect: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    const totalAnalyzed = data?.totalAnalyzedCostUSD ?? 0;
    const unattributed = data?.unattributedSubscriptionCost ?? 0;

    return (
        <div className="space-y-6">
            {/* Top Toolbar / Filters */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1B2A41] dark:text-slate-200">
                        <IconCalendar className="w-4 h-4 text-[#0078D4] dark:text-white" stroke={1.5} />
                        <span>{t("window_label")}</span>
                    </div>
                    {/* Timeframe selector buttons */}
                    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800">
                        <button
                            type="button"
                            onClick={() => setTimeframe("30d")}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                timeframe === "30d"
                                    ? "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 shadow-sm border border-[#0054A6]"
                                    : "text-slate-600 dark:text-slate-400 hover:text-[#1B2A41]"
                            }`}
                        >
                            {t("timeframe_30d")}
                        </button>
                        <button
                            type="button"
                            onClick={() => setTimeframe("mtd")}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                timeframe === "mtd"
                                    ? "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 shadow-sm border border-[#0054A6]"
                                    : "text-slate-600 dark:text-slate-400 hover:text-[#1B2A41]"
                            }`}
                        >
                            {t("timeframe_mtd")}
                        </button>
                    </div>

                    <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block" />

                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1B2A41] dark:text-slate-200">
                        <IconFilter className="w-4 h-4 text-[#0078D4] dark:text-white" stroke={1.5} />
                        <span>{t("count_label")}</span>
                    </div>
                    {/* Top count selector buttons */}
                    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800">
                        {[3, 5, 10].map((n) => (
                            <button
                                key={n}
                                type="button"
                                onClick={() => setLimit(n)}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                    limit === n
                                        ? "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 shadow-sm border border-[#0054A6]"
                                        : "text-slate-600 dark:text-slate-400 hover:text-[#1B2A41]"
                                }`}
                            >
                                Top {n}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {data && (
                        <div className="text-right">
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                                {t("total_analyzed")}:
                            </span>
                            <span className="text-sm font-bold text-[#0054A6] dark:text-blue-400 font-mono">
                                {fmtUsd(totalAnalyzed)}
                            </span>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => mutate()}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 border border-[#0054A6] rounded-xl hover:bg-blue-50/50 dark:hover:bg-slate-800 shadow-sm transition-all disabled:opacity-50"
                    >
                        <IconRefresh
                            className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
                            stroke={1.5}
                        />
                        <span>{t("refresh")}</span>
                    </button>
                </div>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
                    <IconLoader2 className="w-8 h-8 animate-spin text-[#0078D4] dark:text-white mb-3" stroke={1.5} />
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        {t("loading")}
                    </p>
                </div>
            )}

            {/* Error */}
            {error && (
                parseTierRequiredError(error.message) ? (
                    <TierLockedNotice
                        requiredTier={parseTierRequiredError(error.message)!}
                        currentTier={(selectedTenant as any)?.tier}
                        featureName={t("title")}
                    />
                ) : (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-5 rounded-2xl border border-red-200 dark:border-red-900/50">
                        <div className="flex items-center gap-2 font-bold mb-1">
                            <IconAlertCircle className="w-5 h-5" stroke={1.5} />
                            <span>{t("fetch_error")}</span>
                        </div>
                        <p className="text-sm">{error.message}</p>
                    </div>
                )
            )}

            {/* 4 Dimension Panels Grid (2x2) */}
            {!isLoading && !error && data && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Panel 1: Top Cost Groups (#0078D4) */}
                    <PanelCard
                        title={t("top_cost_groups_title", { limit })}
                        description={t("cost_groups_desc")}
                        icon={<IconFolders className="w-5 h-5" stroke={1.5} />}
                        color="#0078D4"
                        items={data.topCostGroups || []}
                        emptyHint={t("empty_no_recent_sync")}
                        totalCostUSD={totalAnalyzed}
                    />

                    {/* Panel 2: Top Subscriptions (#2563EB) */}
                    <PanelCard
                        title={t("top_subscriptions_title", { limit })}
                        description={t("subscriptions_desc")}
                        icon={<IconKey className="w-5 h-5" stroke={1.5} />}
                        color="#2563EB"
                        items={data.topSubscriptions || []}
                        emptyHint={t("empty_no_recent_sync")}
                        totalCostUSD={totalAnalyzed}
                        extraNote={
                            unattributed > 0 ? (
                                <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                                    <IconInfoCircle className="w-4 h-4 shrink-0 mt-0.5" stroke={1.5} />
                                    <span>
                                        {t("unattributed_subscription_cost", {
                                            amount: fmtUsd(unattributed),
                                        })}
                                    </span>
                                </p>
                            ) : undefined
                        }
                    />

                    {/* Panel 3: Top Resource Groups (#0284C7) */}
                    <PanelCard
                        title={t("top_resource_groups_title", { limit })}
                        description={t("resource_groups_desc")}
                        icon={<IconLayersLinked className="w-5 h-5" stroke={1.5} />}
                        color="#0284C7"
                        items={data.topResourceGroups || []}
                        emptyHint={t("empty_no_recent_sync")}
                        totalCostUSD={totalAnalyzed}
                    />

                    {/* Panel 4: Top Resources (#38BDF8) */}
                    <PanelCard
                        title={t("top_resources_title", { limit })}
                        description={t("resources_desc")}
                        icon={<IconCpu className="w-5 h-5" stroke={1.5} />}
                        color="#38BDF8"
                        items={data.topResources || []}
                        emptyHint={t("empty_no_recent_sync")}
                        totalCostUSD={totalAnalyzed}
                    />
                </div>
            )}
        </div>
    );
}

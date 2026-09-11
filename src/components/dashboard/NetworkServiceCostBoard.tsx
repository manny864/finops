"use client";

import React, { useEffect, useMemo, useState } from "react";
import MockBanner from "@/components/MockBanner";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, DollarSign, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { Pie, PieChart, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import InfoTooltip from "@/components/InfoTooltip";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";

const PIE_COLORS = ["#0054A6", "#00AEEF", "#F2A900", "#10B981", "#EF4444", "#8B5CF6", "#F43F5E", "#0EA5E9", "#F59E0B", "#64748B"];

export default function NetworkServiceCostBoard({
    family,
    title,
    subtitle,
    icon,
    apiPath = "/api/intelligence/network/service-cost",
}: {
    family: "analysis" | "basic" | "hybrid" | "balancing" | "internet";
    title: string;
    subtitle: string;
    icon?: React.ReactNode;
    apiPath?: string;
}) {
    const t = useTranslations("NetworkFamilies");
    const { selectedTenant } = useTenant();
    const { format, currency } = useCurrency();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [sortField, setSortField] = useState<"serviceLabel" | "resourceName" | "publicIp" | "resourceGroup" | "subscriptionName" | "costGroupOwner" | "createdAt" | "monthlyCost">("monthlyCost");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [serviceFilter, setServiceFilter] = useState<string>("all");
    const [resourceGroupFilter, setResourceGroupFilter] = useState<string>("all");
    const [subscriptionFilter, setSubscriptionFilter] = useState<string>("all");

    useEffect(() => {
        if (selectedTenant.id === "default" || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const url = new URL(apiPath, window.location.origin);
                url.searchParams.set("tenantId", selectedTenant.id);
                url.searchParams.set("family", family);
                const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
                const json = await res.json();
                if (cancelled) return;
                if (!res.ok) {
                    toast.error(json.error || t("toastLoadError"));
                    return;
                }
                setData(json);
            } catch (e) {
                if (!cancelled) {
                    console.error(e);
                    toast.error(t("toastNetworkError"));
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedTenant.id, accounts.length, instance, family, t, apiPath]);

    const serviceOptions = useMemo<string[]>(
        () => ["all", ...Array.from(new Set<string>((data?.rows || []).map((item: any) => String(item.serviceLabel || "-")))).sort()],
        [data?.rows]
    );

    const resourceGroupOptions = useMemo<string[]>(
        () => ["all", ...Array.from(new Set<string>((data?.rows || []).map((item: any) => String(item.resourceGroup || "-")))).sort()],
        [data?.rows]
    );

    const subscriptionOptions = useMemo<string[]>(
        () => ["all", ...Array.from(new Set<string>((data?.rows || []).map((item: any) => String(item.subscriptionName || item.subscriptionId || "-")))).sort()],
        [data?.rows]
    );

    const filteredRows = useMemo(() => {
        const rows = data?.rows || [];
        return rows.filter((item: any) => {
            const serviceOk = serviceFilter === "all" || String(item.serviceLabel || "-") === serviceFilter;
            const rgOk = resourceGroupFilter === "all" || String(item.resourceGroup || "-") === resourceGroupFilter;
            const subscriptionName = String(item.subscriptionName || item.subscriptionId || "-");
            const subOk = subscriptionFilter === "all" || subscriptionName === subscriptionFilter;
            return serviceOk && rgOk && subOk;
        });
    }, [data?.rows, serviceFilter, resourceGroupFilter, subscriptionFilter]);

    const sortedItems = useMemo(() => {
        const items = [...filteredRows];
        items.sort((a: any, b: any) => {
            const valueA = a?.[sortField];
            const valueB = b?.[sortField];
            if (sortField === "monthlyCost") {
                const numA = Number(valueA || 0);
                const numB = Number(valueB || 0);
                return sortOrder === "asc" ? numA - numB : numB - numA;
            }
            if (sortField === "createdAt") {
                const dateA = valueA ? new Date(valueA).getTime() : 0;
                const dateB = valueB ? new Date(valueB).getTime() : 0;
                return sortOrder === "asc" ? dateA - dateB : dateB - dateA;
            }
            const strA = String(valueA || "").toLowerCase();
            const strB = String(valueB || "").toLowerCase();
            if (strA < strB) return sortOrder === "asc" ? -1 : 1;
            if (strA > strB) return sortOrder === "asc" ? 1 : -1;
            return 0;
        });
        return items;
    }, [filteredRows, sortField, sortOrder]);

    const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
    const pagedItems = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return sortedItems.slice(start, start + pageSize);
    }, [sortedItems, currentPage, pageSize]);

    const onSort = (field: typeof sortField) => {
        if (field === sortField) {
            setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortField(field);
            setSortOrder("asc");
        }
        setCurrentPage(1);
    };

    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [currentPage, totalPages]);

    useEffect(() => {
        setServiceFilter("all");
        setResourceGroupFilter("all");
        setSubscriptionFilter("all");
        setCurrentPage(1);
    }, [family, data?.rows?.length]);

    const formatDate = (value: string) => {
        if (!value) return "-";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "-";
        return d.toLocaleDateString();
    };

    const pieData = useMemo(() => {
        const byService = new Map<string, number>();
        const byServiceCount = new Map<string, number>();
        for (const row of sortedItems) {
            const key = String(row.serviceLabel || "-");
            byService.set(key, (byService.get(key) || 0) + Number(row.monthlyCost || 0));
            byServiceCount.set(key, (byServiceCount.get(key) || 0) + 1);
        }
        const byCost = Array.from(byService.entries())
            .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
            .filter((item) => item.value > 0);
        if (byCost.length > 0) return { mode: "cost" as const, data: byCost };
        return Array.from(byServiceCount.entries())
            .map(([name, value]) => ({ name, value }))
            .filter((item) => item.value > 0)
            .reduce(
                (acc, item) => ({ mode: "count" as const, data: [...acc.data, item] }),
                { mode: "count" as const, data: [] as Array<{ name: string; value: number }> }
            );
    }, [sortedItems]);

    const formatPieValue = (value: number, mode: "cost" | "count") => {
        if (mode === "cost") return `${format(value)} ${currency}`;
        return `${value}`;
    };

    if (selectedTenant.id === "default") return null;

    if (loading) {
        return (
            <div className="p-6 w-full flex items-center justify-center min-h-[320px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t("loading")}</p>
                </div>
            </div>
        );
    }

    if (!data || (data.rows || []).length === 0) {
        return (
            <div className="p-6 w-full">
                <MockBanner />
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-8 text-center">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{title}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{subtitle}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">{t("empty")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 w-full animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                    {icon}
                    <span>{title}</span>
                    <InfoTooltip content={subtitle} position="bottom" align="left" />
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{subtitle}</p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 mb-8 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">{t("filterService")}</label>
                    <select
                        value={serviceFilter}
                        onChange={(e) => {
                            setServiceFilter(e.target.value);
                            setCurrentPage(1);
                        }}
                        className="mt-1 w-full py-2 px-3 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                    >
                        <option value="all">{t("allOption")}</option>
                        {serviceOptions.filter((option) => option !== "all").map((option) => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">{t("filterResourceGroup")}</label>
                    <select
                        value={resourceGroupFilter}
                        onChange={(e) => {
                            setResourceGroupFilter(e.target.value);
                            setCurrentPage(1);
                        }}
                        className="mt-1 w-full py-2 px-3 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                    >
                        <option value="all">{t("allOption")}</option>
                        {resourceGroupOptions.filter((option) => option !== "all").map((option) => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">{t("filterSubscription")}</label>
                    <select
                        value={subscriptionFilter}
                        onChange={(e) => {
                            setSubscriptionFilter(e.target.value);
                            setCurrentPage(1);
                        }}
                        className="mt-1 w-full py-2 px-3 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                    >
                        <option value="all">{t("allOption")}</option>
                        {subscriptionOptions.filter((option) => option !== "all").map((option) => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                            <DollarSign className="w-4 h-4" />
                            {t("kpiTotalCost")}
                        </span>
                        <InfoTooltip content={t("kpiTotalCost")} position="bottom" align="right" />
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{format(sortedItems.reduce((sum: number, item: any) => sum + Number(item.monthlyCost || 0), 0))}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                            <Layers className="w-4 h-4" />
                            {t("kpiResourceCount")}
                        </span>
                        <InfoTooltip content={t("kpiResourceCount")} position="bottom" align="right" />
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">
                        {sortedItems.length}
                    </p>
                </div>
            </div>

            {pieData.data.length > 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-8">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4 flex items-center gap-2">
                        <span>{t("resourcesPieTitle")}</span>
                        <InfoTooltip content={t("resourcesPieTitle")} position="bottom" align="left" />
                    </h3>
                    <div className="h-[360px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData.data}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={120}
                                    label={({ name, value }) => `${name}: ${formatPieValue(Number(value || 0), pieData.mode)}`}
                                >
                                    {pieData.data.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                    ))}
                                </Pie>
                                <RechartsTooltip formatter={(value) => formatPieValue(Number(value || 0), pieData.mode)} {...TOOLTIP_TEMA} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            ) : null}

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4 flex items-center gap-2">
                    <span>{t("tableTitle")}</span>
                    <InfoTooltip content={t("tableTitle")} position="bottom" align="left" />
                </h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th onClick={() => onSort("serviceLabel")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colService")}</span>
                                        <InfoTooltip content={t("colService")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => onSort("resourceName")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colResourceName")}</span>
                                        <InfoTooltip content={t("colResourceName")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => onSort("publicIp")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colPublicIp")}</span>
                                        <InfoTooltip content={t("colPublicIp")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => onSort("resourceGroup")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colResourceGroup")}</span>
                                        <InfoTooltip content={t("colResourceGroup")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => onSort("subscriptionName")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colSubscription")}</span>
                                        <InfoTooltip content={t("colSubscription")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => onSort("costGroupOwner")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colCostGroupOwner")}</span>
                                        <InfoTooltip content={t("colCostGroupOwner")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => onSort("createdAt")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">
                                    <div className="inline-flex items-center gap-1">
                                        <span>{t("colCreatedAt")}</span>
                                        <InfoTooltip content={t("colCreatedAt")} position="bottom" align="left" />
                                    </div>
                                </th>
                                <th onClick={() => onSort("monthlyCost")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right cursor-pointer">
                                    <div className="inline-flex items-center justify-end gap-1 w-full">
                                        <span>{t("colMonthlyCost")}</span>
                                        <InfoTooltip content={t("colMonthlyCost")} position="bottom" align="right" />
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedItems.map((item: any, idx: number) => (
                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{item.serviceLabel}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.resourceName || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.publicIp || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.resourceGroup || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.subscriptionName || item.subscriptionId || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.costGroupOwner || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{formatDate(item.createdAt)}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{format(item.monthlyCost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <span>{t("perPage")}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setCurrentPage(1);
                            }}
                            className="py-1 px-2 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                        >
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={60}>60</option>
                            <option value={100}>100</option>
                        </select>
                        <span>{t("paginationShowing", {
                            from: sortedItems.length === 0 ? 0 : (currentPage - 1) * pageSize + 1,
                            to: Math.min(currentPage * pageSize, sortedItems.length),
                            total: sortedItems.length,
                        })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 rounded-md border border-gray-200 dark:border-slate-700 disabled:opacity-40"
                            title={t("previous")}
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span>{t("page", { current: currentPage, total: totalPages })}</span>
                        <button
                            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 rounded-md border border-gray-200 dark:border-slate-700 disabled:opacity-40"
                            title={t("next")}
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

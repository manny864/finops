"use client";

import React, { useEffect, useMemo, useState } from "react";
import MockBanner from "@/components/MockBanner";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, DollarSign, Layers, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function NetworkServiceCostBoard({
    family,
    title,
    subtitle,
    icon,
}: {
    family: "analysis" | "basic" | "hybrid" | "balancing" | "internet";
    title: string;
    subtitle: string;
    icon?: React.ReactNode;
}) {
    const t = useTranslations("NetworkFamilies");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const searchParams = useSearchParams();
    const filter = (searchParams.get("q") || "").toLowerCase();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [sortField, setSortField] = useState<"serviceLabel" | "resourceName" | "resourceGroup" | "subscriptionId" | "costGroupOwner" | "createdAt" | "monthlyCost">("monthlyCost");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [pageSize, setPageSize] = useState<number>(15);
    const [currentPage, setCurrentPage] = useState<number>(1);

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
                const url = new URL("/api/intelligence/network/service-cost", window.location.origin);
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
    }, [selectedTenant.id, accounts.length, instance, family, t]);

    const filteredItems = useMemo(() => {
        const items = data?.rows || [];
        if (!filter) return items;
        return items.filter((item: any) =>
            [
                item.serviceLabel,
                item.resourceName,
                item.resourceGroup,
                item.subscriptionId,
                item.costGroupOwner,
            ]
                .join(" ")
                .toLowerCase()
                .includes(filter)
        );
    }, [data?.rows, filter]);

    const sortedItems = useMemo(() => {
        const items = [...filteredItems];
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
    }, [filteredItems, sortField, sortOrder]);

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

    const formatDate = (value: string) => {
        if (!value) return "-";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "-";
        return d.toLocaleDateString();
    };

    if (selectedTenant.id === "default") return null;

    if (loading) {
        return (
            <div className="p-6 max-w-5xl mx-auto flex items-center justify-center min-h-[320px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t("loading")}</p>
                </div>
            </div>
        );
    }

    if (!data || (data.rows || []).length === 0) {
        return (
            <div className="p-6 max-w-5xl mx-auto">
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
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                    {icon}
                    {title}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{subtitle}</p>
                {filter ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 inline-flex items-center gap-1">
                        <Search className="w-3.5 h-3.5" /> {t("activeFilter", { value: searchParams.get("q") || "" })}
                    </p>
                ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {t("kpiTotalCost")}
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(sortedItems.reduce((sum: number, item: any) => sum + Number(item.monthlyCost || 0), 0))}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Layers className="w-4 h-4" />
                        {t("kpiResourceCount")}
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">
                        {sortedItems.length}
                    </p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t("tableTitle")}</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th onClick={() => onSort("serviceLabel")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">{t("colService")}</th>
                                <th onClick={() => onSort("resourceName")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">{t("colResourceName")}</th>
                                <th onClick={() => onSort("resourceGroup")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">{t("colResourceGroup")}</th>
                                <th onClick={() => onSort("subscriptionId")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">{t("colSubscription")}</th>
                                <th onClick={() => onSort("costGroupOwner")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">{t("colCostGroupOwner")}</th>
                                <th onClick={() => onSort("createdAt")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase cursor-pointer">{t("colCreatedAt")}</th>
                                <th onClick={() => onSort("monthlyCost")} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right cursor-pointer">{t("colMonthlyCost")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedItems.map((item: any, idx: number) => (
                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{item.serviceLabel}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.resourceName || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.resourceGroup || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.subscriptionId || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{item.costGroupOwner || "-"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-700 dark:text-gray-300">{formatDate(item.createdAt)}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(item.monthlyCost)}</td>
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

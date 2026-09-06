"use client";
import React, { useState, useEffect } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { useLocale } from "next-intl";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import { useChartTheme } from "@/lib/chartTheme";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import { isMockTenant } from "@/lib/mockData";
import {
    IconSearch,
    IconBox,
    IconUsers,
    IconTags,
    IconKey,
    IconFolders,
    IconLayersLinked,
    IconWorld,
    IconCode,
    IconX,
    IconChevronDown,
    IconChevronRight,
    IconCopy,
    IconCheck,
    IconSparkles,
    IconAlertCircle,
    IconLoader2,
    IconFilterOff,
    IconChartBar,
} from "@tabler/icons-react";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    Cell,
} from "recharts";
import type {
    CloudResourceItem,
    TagCostSummary,
    CreatorSummary,
    ResourcesSearchResponse,
    ResourcesInventoryResponse,
    CreatedByResponse,
    CostsByTagResponse,
} from "@/types/azureResources.types";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

function fmtDate(iso: string | null | undefined, locale: string) {
    if (!iso) return "—";
    try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)); } catch { return "—"; }
}

function KpiCard({
    icon,
    label,
    value,
    tooltip,
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    tooltip?: string;
}) {
    return (
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 shadow-xs transition-all hover:border-blue-300 dark:hover:border-slate-700">
            <div className="flex items-center gap-3 min-w-0">
                <div className="p-1.5 rounded-lg bg-transparent shrink-0 text-[#0078D4] dark:text-blue-400">
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-1">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold truncate">
                            {label}
                        </p>
                        {tooltip && <InfoTooltip content={tooltip} iconClassName="w-3.5 h-3.5 text-slate-400 hover:text-[#0054A6]" />}
                    </div>
                    <p className="text-xl font-extrabold text-[#1B2A41] dark:text-white mt-0.5">
                        {value}
                    </p>
                </div>
            </div>
        </div>
    );
}

function useAuthedSWR<T = any>(key: string | null) {
    const t = useProviderTranslations("Resources");
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const fetcher = async (url: string) => {
        const headers: Record<string, string> = { "x-tenant-id": selectedTenant?.id ?? "" };
        if (accounts.length > 0 && !isMockTenant(selectedTenant?.id || "")) {
            try {
                const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
                if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
            } catch {
                // Ignore token error for mock fallback
            }
        }
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.details || j.error || t("network_error"));
        }
        return res.json();
    };
    return useSWR<T>(key, fetcher, { revalidateOnFocus: false, dedupingInterval: 60000 });
}

function useReadyKey(path: string) {
    const { selectedTenant } = useTenant();
    const { accounts } = useMsal();
    if (!selectedTenant || selectedTenant.id === "default") return null;
    if (!(accounts.length > 0 || isMockTenant(selectedTenant.id))) return null;
    return `${path}?tenantId=${selectedTenant.id}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ARM JSON Properties Drawer (Layering Z-Index: z-[100])
// ─────────────────────────────────────────────────────────────────────────────
function JsonPropertiesModal({
    resource,
    onClose,
}: {
    resource: CloudResourceItem | null;
    onClose: () => void;
}) {
    const t = useProviderTranslations("Resources");
    const [copied, setCopied] = useState(false);

    if (!resource) return null;

    const jsonString = JSON.stringify(resource, null, 2);

    const handleCopy = () => {
        navigator.clipboard.writeText(jsonString);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
            <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
                role="dialog"
                aria-modal="true"
            >
                {/* Header */}
                <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-transparent text-[#0078D4] dark:text-blue-400">
                            <IconCode className="w-5 h-5 stroke-[1.5]" />
                        </div>
                        <div>
                            <h3 className="font-montserrat text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                                {resource.name}
                                <span className="text-xs px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 font-mono">
                                    {resource.typeDisplayName || resource.type}
                                </span>
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {resource.id}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
                        aria-label={t("drawer_close")}
                    >
                        <IconX className="w-5 h-5 stroke-[1.5]" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 overflow-y-auto flex-1 bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed">
                    <pre className="whitespace-pre-wrap break-all">{jsonString}</pre>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/50">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        {fmtUsd(resource.monthlyCostUSD)} / mes MTD
                    </span>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-[#10B981] text-[#10B981] bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-all shadow-xs"
                        >
                            {copied ? <IconCheck className="w-4 h-4 stroke-[2]" /> : <IconCopy className="w-4 h-4 stroke-[1.5]" />}
                            {copied ? t("drawer_copied") : t("drawer_copy_json")}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-xs"
                        >
                            {t("drawer_close")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Search Resources
// ─────────────────────────────────────────────────────────────────────────────
function SearchResourcesTab() {
    const t = useProviderTranslations("Resources");
    const locale = useLocale();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(15);
    const { subscriptions } = useSubscription();

    const [search, setSearch] = useState("");
    const [subscriptionId, setSubscriptionId] = useState("");
    const [resourceGroup, setResourceGroup] = useState("");
    const [tagKey, setTagKey] = useState("");
    const [selectedResource, setSelectedResource] = useState<CloudResourceItem | null>(null);

    // Debounce text inputs
    const [debounced, setDebounced] = useState({ search: "", resourceGroup: "", tagKey: "" });
    useEffect(() => {
        const id = setTimeout(() => setDebounced({ search, resourceGroup, tagKey }), 350);
        return () => clearTimeout(id);
    }, [search, resourceGroup, tagKey]);

    useEffect(() => {
        setPage(1);
    }, [debounced.search, debounced.resourceGroup, debounced.tagKey, subscriptionId]);

    const base = useReadyKey("/api/resources/search");
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debounced.search) qs.set("search", debounced.search);
    if (subscriptionId) qs.set("subscriptionId", subscriptionId);
    if (debounced.resourceGroup) qs.set("resourceGroup", debounced.resourceGroup);
    if (debounced.tagKey) qs.set("tagKey", debounced.tagKey);

    const { data, error, isLoading } = useAuthedSWR<ResourcesSearchResponse>(base ? `${base}&${qs.toString()}` : null);

    const hasFilters = Boolean(search || subscriptionId || resourceGroup || tagKey);
    const clearFilters = () => {
        setSearch("");
        setSubscriptionId("");
        setResourceGroup("");
        setTagKey("");
    };

    const filterBar = (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-4 flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[220px] flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t("filter_search")}
                </span>
                <div className="relative">
                    <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 stroke-[1.5]" />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("filter_search_placeholder")}
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#0054A6]"
                    />
                </div>
            </label>

            <label className="min-w-[190px] flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t("filter_subscription")}
                </span>
                <select
                    value={subscriptionId}
                    onChange={(e) => setSubscriptionId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                >
                    <option value="">{t("filter_all")}</option>
                    {(subscriptions || []).map((sub) => (
                        <option key={sub.id} value={sub.id}>
                            {sub.name || sub.id}
                        </option>
                    ))}
                </select>
            </label>

            <label className="min-w-[170px] flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t("filter_resource_group")}
                </span>
                <input
                    type="text"
                    value={resourceGroup}
                    onChange={(e) => setResourceGroup(e.target.value)}
                    placeholder={t("filter_all")}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#0054A6]"
                />
            </label>

            <label className="min-w-[160px] flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t("filter_tag_key")}
                </span>
                <input
                    type="text"
                    value={tagKey}
                    onChange={(e) => setTagKey(e.target.value)}
                    placeholder={t("filter_tag_key_placeholder")}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#0054A6]"
                />
            </label>

            {hasFilters && (
                <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-xs"
                >
                    <IconFilterOff className="w-4 h-4 stroke-[1.5]" />
                    {t("filter_clear")}
                </button>
            )}
        </div>
    );

    if (isLoading) return <div className="space-y-4">{filterBar}<LoadingBlock /></div>;
    if (error) return <div className="space-y-4">{filterBar}<ErrorBlock message={error.message} /></div>;
    if (!data) return <div className="space-y-4">{filterBar}</div>;

    const totalPages = Math.max(1, Math.ceil((data.total || 0) / pageSize));

    return (
        <div className="space-y-5">
            {filterBar}

            {data.sortedByCost === false && (
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs font-medium border border-amber-200 dark:border-amber-800/40">
                    <IconAlertCircle className="w-4 h-4 shrink-0 stroke-[1.5]" />
                    {t("cost_sort_unavailable")}
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard
                    icon={<IconFolders className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_cost_groups")}
                    value={data.kpis?.costGroups ?? 0}
                    tooltip={t("tooltip_cost_groups")}
                />
                <KpiCard
                    icon={<IconKey className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_subscriptions")}
                    value={data.kpis?.subscriptions ?? 0}
                    tooltip={t("tooltip_subscriptions")}
                />
                <KpiCard
                    icon={<IconBox className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resource_groups")}
                    value={data.kpis?.resourceGroups ?? 0}
                    tooltip={t("tooltip_resource_groups")}
                />
                <KpiCard
                    icon={<IconLayersLinked className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resources")}
                    value={data.kpis?.resources ?? 0}
                    tooltip={t("tooltip_resources")}
                />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs table-fixed min-w-[960px]">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                            <tr>
                                <ResizableTh className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[20%]">
                                    {t("col_resource")}
                                </ResizableTh>
                                <ResizableTh className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[14%]">
                                    {t("col_type")}
                                </ResizableTh>
                                <ResizableTh className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[14%]">
                                    {t("col_resource_group")}
                                </ResizableTh>
                                <ResizableTh className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[14%]">
                                    {t("col_subscription")}
                                </ResizableTh>
                                <ResizableTh className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[12%]">
                                    {t("col_owner")}
                                </ResizableTh>
                                <ResizableTh className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[10%]">
                                    {t("col_created")}
                                </ResizableTh>
                                <ResizableTh className="text-right text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[10%]">
                                    {t("col_period_cost")}
                                </ResizableTh>
                                <th className="text-center text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[6%]">
                                    {t("col_actions")}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {(data.rows || []).map((r: CloudResourceItem, i: number) => (
                                <tr
                                    key={r.id || i}
                                    onClick={() => setSelectedResource(r)}
                                    className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 cursor-pointer transition-colors align-middle"
                                >
                                    <td className="p-3.5 font-semibold text-[#1B2A41] dark:text-white truncate" title={r.name}>
                                        <div className="flex flex-col">
                                            <span className="truncate">{r.name}</span>
                                            {r.location && (
                                                <span className="text-[10px] text-slate-400 font-normal truncate">
                                                    {r.location}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3.5 text-slate-600 dark:text-slate-300 truncate" title={r.typeDisplayName || r.type}>
                                        <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-mono">
                                            {r.typeDisplayName || r.type}
                                        </span>
                                    </td>
                                    <td className="p-3.5 text-slate-600 dark:text-slate-300 truncate" title={r.resourceGroup}>
                                        {r.resourceGroup}
                                    </td>
                                    <td className="p-3.5 text-slate-600 dark:text-slate-300 truncate" title={r.subscriptionName || r.subscriptionId}>
                                        {r.subscriptionName || r.subscriptionId}
                                    </td>
                                    <td className="p-3.5 text-slate-600 dark:text-slate-300 truncate" title={r.owner || r.tags?.Owner || "—"}>
                                        {r.owner || r.tags?.Owner || "—"}
                                    </td>
                                    <td className="p-3.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                        {fmtDate(r.createdDate || (r as any).createdTime, locale)}
                                    </td>
                                    <td className="p-3.5 text-right font-bold text-[#0054A6] dark:text-blue-400 whitespace-nowrap">
                                        {r.costSource === "unmeasured" && !(r.monthlyCostUSD > 0) ? (
                                            <span
                                                className="text-slate-400 dark:text-slate-500"
                                                title={t("tooltip_no_direct_cost")}
                                            >
                                                —
                                            </span>
                                        ) : (
                                            fmtUsd(r.monthlyCostUSD ?? (r as any).periodCost ?? 0)
                                        )}
                                    </td>
                                    <td className="p-3.5 text-center">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedResource(r);
                                            }}
                                            className="p-1 rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-slate-800 transition-all shadow-2xs"
                                            title={t("btn_view_properties")}
                                        >
                                            <IconSparkles className="w-3.5 h-3.5 stroke-[1.5]" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {(!data.rows || data.rows.length === 0) && (
                                <tr>
                                    <td colSpan={8} className="p-10 text-center text-slate-400">
                                        {t("no_resources")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                    <Pagination
                        page={page}
                        setPage={(p: any) => setPage(typeof p === "function" ? p(page) : p)}
                        pageSize={pageSize}
                        setPageSize={setPageSize}
                        total={data.total || 0}
                        totalPages={totalPages}
                        pageSizes={[15, 30, 45, 60]}
                    />
                </div>
            </div>

            {selectedResource && (
                <JsonPropertiesModal
                    resource={selectedResource}
                    onClose={() => setSelectedResource(null)}
                />
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: Resource Inventory Type
// ─────────────────────────────────────────────────────────────────────────────
function InventoryTab() {
    const t = useProviderTranslations("Resources");
    const chart = useChartTheme();
    const key = useReadyKey("/api/resources/inventory");
    const { data, error, isLoading } = useAuthedSWR<ResourcesInventoryResponse>(key);

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;

    const chartData = (data.byType || []).slice(0, 10).map((item) => ({
        name: item.typeDisplayName || item.friendlyName || item.type,
        count: item.count,
    }));

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <KpiCard
                    icon={<IconFolders className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_cost_groups")}
                    value={data.kpis?.costGroups ?? 0}
                />
                <KpiCard
                    icon={<IconKey className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_subscriptions")}
                    value={data.kpis?.subscriptions ?? 0}
                />
                <KpiCard
                    icon={<IconBox className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resource_groups")}
                    value={data.kpis?.resourceGroups ?? 0}
                />
                <KpiCard
                    icon={<IconLayersLinked className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resources")}
                    value={data.kpis?.resources ?? 0}
                />
                <KpiCard
                    icon={<IconUsers className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_owners")}
                    value={data.kpis?.owners ?? 0}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Horizontal Bar Chart: Distribution by Type */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-montserrat text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                                <IconChartBar className="w-4 h-4 text-[#0078D4] stroke-[1.5]" />
                                {t("distribution_by_type")}
                            </h3>
                            <span className="text-[11px] text-slate-400 font-medium">{t("top10_arm_types")}</span>
                        </div>
                        <div className="h-[320px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={chartData}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={chart.grid} />
                                    <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        width={140}
                                        tick={{ fill: chart.tick, fontSize: 11 }}
                                        tickLine={false}
                                    />
                                    <Tooltip
                                        formatter={(val: any) => [`${val ?? 0} ${t("chartResources")}`, t("chartCount")]}
                                        contentStyle={{
                                            backgroundColor: chart.tooltip.backgroundColor,
                                            borderColor: chart.tooltip.borderColor,
                                            borderRadius: "10px",
                                            color: chart.tooltip.color,
                                            fontSize: "12px",
                                        }}
                                    />
                                    {/* MEJ-02: antes deshabilitada siempre (ver useChartTheme). */}
                                    <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={chart.animate}>
                                        {chartData.map((_, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={index === 0 ? chart.accent : index < 4 ? chart.accentSoft : (chart.isDark ? "#0EA5E9" : "#0284C7")}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Right Panel: Subscription & Region distribution */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-montserrat text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                                <IconKey className="w-4 h-4 text-[#0078D4] stroke-[1.5]" />
                                {t("resource_count_by_subscription")}
                            </h3>
                        </div>
                        <div className="space-y-3 max-h-[160px] overflow-y-auto pr-1">
                            {(data.bySubscription || []).map((r) => (
                                <div
                                    key={r.subscriptionId}
                                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50"
                                >
                                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate" title={r.subscriptionId}>
                                        {r.subscriptionName || r.subscriptionId}
                                    </span>
                                    <span className="text-xs font-extrabold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
                                        {t("resourceCount", { count: r.count })}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Region breakdown */}
                        <div className="mt-5">
                            <h4 className="font-montserrat text-xs font-bold text-[#1B2A41] dark:text-white flex items-center gap-1.5 mb-2.5">
                                <IconWorld className="w-4 h-4 text-[#0078D4] stroke-[1.5]" />
                                {t("resources_by_region")}
                            </h4>
                            <div className="grid grid-cols-2 gap-2.5 max-h-[120px] overflow-y-auto">
                                {(data.byRegion || []).map((reg: { location: string; count: number }) => (
                                    <div
                                        key={reg.location}
                                        className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 flex items-center justify-between"
                                    >
                                        <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{reg.location}</span>
                                        <span className="text-xs font-bold text-slate-800 dark:text-white">{reg.count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3: Created By
// ─────────────────────────────────────────────────────────────────────────────
function CreatedByTab() {
    const t = useProviderTranslations("Resources");
    const key = useReadyKey("/api/resources/created-by");
    const { data, error, isLoading } = useAuthedSWR<CreatedByResponse>(key);
    const pg = usePagination<CreatorSummary>(data?.rows, 15);

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <KpiCard
                    icon={<IconUsers className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_created_by")}
                    value={data.kpis?.createdBy ?? 0}
                    tooltip={t("tooltip_owners")}
                />
                <KpiCard
                    icon={<IconFolders className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_cost_groups")}
                    value={data.kpis?.costGroups ?? 0}
                />
                <KpiCard
                    icon={<IconKey className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_subscriptions")}
                    value={data.kpis?.subscriptions ?? 0}
                />
                <KpiCard
                    icon={<IconBox className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resource_groups")}
                    value={data.kpis?.resourceGroups ?? 0}
                />
                <KpiCard
                    icon={<IconLayersLinked className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resources")}
                    value={data.kpis?.resources ?? 0}
                />
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                <IconAlertCircle className="w-4 h-4 text-[#0078D4] shrink-0 stroke-[1.5]" />
                {t("created_by_caveat")}
            </p>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs table-fixed min-w-[620px]">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                            <tr>
                                <ResizableTh className="text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[40%]">
                                    {t("col_user_name")}
                                </ResizableTh>
                                <ResizableTh className="text-right text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[20%]">
                                    {t("col_resources")}
                                </ResizableTh>
                                <ResizableTh className="text-right text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[20%]">
                                    {t("col_resource_groups")}
                                </ResizableTh>
                                <ResizableTh className="text-right text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold p-3.5 w-[20%]">
                                    {t("col_subscriptions")}
                                </ResizableTh>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {pg.paged.map((r: CreatorSummary, i: number) => (
                                <tr key={r.creatorName || (r as any).userName || i} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                    <td className="p-3.5 font-semibold text-[#1B2A41] dark:text-white truncate">
                                        {r.creatorName || (r as any).userName}
                                    </td>
                                    <td className="p-3.5 text-right font-bold text-[#0054A6] dark:text-blue-400">
                                        {r.resourcesCount ?? (r as any).resources ?? 0}
                                    </td>
                                    <td className="p-3.5 text-right text-slate-600 dark:text-slate-300">
                                        {r.resourceGroupsCount ?? (r as any).resourceGroups ?? 0}
                                    </td>
                                    <td className="p-3.5 text-right text-slate-600 dark:text-slate-300">
                                        {r.subscriptionsCount ?? (r as any).subscriptions ?? 0}
                                    </td>
                                </tr>
                            ))}
                            {(!data.rows || data.rows.length === 0) && (
                                <tr>
                                    <td colSpan={4} className="p-10 text-center text-slate-400">
                                        {t("no_data")}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                    <Pagination
                        page={pg.page}
                        setPage={pg.setPage}
                        pageSize={pg.pageSize}
                        setPageSize={pg.setPageSize}
                        total={pg.total}
                        totalPages={pg.totalPages}
                        pageSizes={[15, 30, 45, 60]}
                    />
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 4: Costs by Tag (Hierarchical Accordion Tree View)
// ─────────────────────────────────────────────────────────────────────────────
function CostsByTagTab() {
    const t = useProviderTranslations("Resources");
    const key = useReadyKey("/api/resources/costs-by-tag");
    const { data, error, isLoading } = useAuthedSWR<CostsByTagResponse>(key);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const pg = usePagination<TagCostSummary>(data?.tags, 15);

    if (isLoading) return <LoadingBlock />;
    if (error) return <ErrorBlock message={error.message} />;
    if (!data) return null;

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <KpiCard
                    icon={<IconLayersLinked className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resources")}
                    value={data.kpis?.resources ?? 0}
                />
                <KpiCard
                    icon={<IconTags className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resources_with_tags")}
                    value={data.kpis?.resourcesWithTags ?? 0}
                    tooltip={t("tooltip_tagged")}
                />
                <KpiCard
                    icon={<IconTags className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_resources_without_tags")}
                    value={data.kpis?.resourcesWithoutTags ?? 0}
                    tooltip={t("tooltip_untagged")}
                />
                <KpiCard
                    icon={<IconKey className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_tag_names")}
                    value={data.kpis?.tagNames ?? 0}
                />
                <KpiCard
                    icon={<IconKey className="w-6 h-6 stroke-[1.5]" />}
                    label={t("kpi_tag_values")}
                    value={data.kpis?.tagValues ?? 0}
                />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
                <div className="grid grid-cols-[1fr_140px_140px_140px] gap-2 px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold">
                    <span>{t("col_tag_name_value")}</span>
                    <span className="text-right">{t("col_tagged_resources")}</span>
                    <span className="text-right">{t("col_avg_daily_cost")}</span>
                    <span className="text-right">{t("col_monthly_cost")}</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {pg.paged.map((tag: TagCostSummary | any) => {
                        const tagKeyName = tag.tagKey || tag.key;
                        const isOpen = !!expanded[tagKeyName];
                        const totalSpend = tag.monthlySpendUSD ?? tag.totalCost ?? 0;
                        // Días transcurridos del MTD que informa el backend: dividir
                        // por 30 fijo subestimaba el promedio a principio de mes y no
                        // correspondía al período rotulado en la columna.
                        const daysInPeriod = Math.max(1, data.daysInPeriod ?? new Date().getUTCDate());
                        const resourceCount = tag.taggedResourcesCount ?? (tag.values ? tag.values.reduce((s: number, v: any) => s + (v.resourcesCount || 1), 0) : 0);

                        return (
                            <div key={tagKeyName} className="transition-colors">
                                <button
                                    onClick={() => setExpanded(p => ({ ...p, [tagKeyName]: !p[tagKeyName] }))}
                                    className="w-full grid grid-cols-[1fr_140px_140px_140px] gap-2 px-5 py-3.5 items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-left transition-colors"
                                >
                                    <span className="flex items-center gap-2 font-bold text-[#1B2A41] dark:text-white text-xs">
                                        {isOpen ? (
                                            <IconChevronDown className="w-4 h-4 text-[#0078D4] stroke-[2]" />
                                        ) : (
                                            <IconChevronRight className="w-4 h-4 text-slate-400 stroke-[2]" />
                                        )}
                                        <span className="font-mono text-[#0054A6] dark:text-blue-400">{tagKeyName}</span>
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-[#0054A6] dark:text-blue-300 font-normal">
                                            {tag.values?.length || 0} valores
                                        </span>
                                    </span>
                                    <span className="text-right text-slate-600 dark:text-slate-300 text-xs">
                                        {resourceCount}
                                    </span>
                                    <span className="text-right text-slate-600 dark:text-slate-300 tabular-nums text-xs">
                                        {fmtUsd(totalSpend / daysInPeriod)}
                                    </span>
                                    <span className="text-right font-extrabold text-[#0054A6] dark:text-blue-400 tabular-nums text-xs">
                                        {fmtUsd(totalSpend)}
                                    </span>
                                </button>

                                {isOpen && (tag.values || []).map((v: any) => {
                                    const valName = v.tagValue || v.value;
                                    const valCost = v.costUSD ?? v.cost ?? 0;
                                    const valRes = v.resourcesCount ?? 1;

                                    return (
                                        <div
                                            key={valName}
                                            className="grid grid-cols-[1fr_140px_140px_140px] gap-2 px-5 py-2.5 pl-12 items-center bg-slate-50/40 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 text-xs"
                                        >
                                            <span className="text-slate-600 dark:text-slate-400 font-mono truncate">
                                                {valName}
                                            </span>
                                            <span className="text-right text-slate-500 dark:text-slate-400">
                                                {valRes}
                                            </span>
                                            <span className="text-right text-slate-500 dark:text-slate-400 tabular-nums">
                                                {fmtUsd(valCost / daysInPeriod)}
                                            </span>
                                            <span className="text-right font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                                                {fmtUsd(valCost)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                    {(!data.tags || data.tags.length === 0) && (
                        <p className="p-10 text-center text-slate-400">{t("no_data")}</p>
                    )}
                </div>
                {data.tags && data.tags.length > 0 && (
                    <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                        <Pagination
                            page={pg.page}
                            setPage={pg.setPage}
                            pageSize={pg.pageSize}
                            setPageSize={pg.setPageSize}
                            total={pg.total}
                            totalPages={pg.totalPages}
                            pageSizes={[15, 30, 45, 60]}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function LoadingBlock() {
    const t = useProviderTranslations("Resources");
    return (
        <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            <IconLoader2 className="w-8 h-8 animate-spin text-[#0078D4] mb-3 stroke-[1.5]" />
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t("loading")}</p>
        </div>
    );
}

function ErrorBlock({ message }: { message: string }) {
    const t = useProviderTranslations("Resources");
    const { selectedTenant } = useTenant();
    const requiredTier = parseTierRequiredError(message);
    if (requiredTier) {
        return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t("feature_name")} compact />;
    }
    return (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-200 dark:border-red-900/50 flex items-start gap-3">
            <IconAlertCircle className="w-5 h-5 shrink-0 stroke-[1.5] mt-0.5" />
            <div>
                <h3 className="font-bold text-xs uppercase tracking-wide">{t("inventory_error")}</h3>
                <p className="text-xs mt-0.5">{message}</p>
            </div>
        </div>
    );
}

export default function ResourcesBoard() {
    const t = useProviderTranslations("Resources");
    const { selectedTenant } = useTenant();
    const [tab, setTab] = useState<"search" | "inventory" | "created_by" | "tags">("search");

    if (!selectedTenant || selectedTenant.id === "default") return null;

    const tabs = [
        { id: "search" as const, label: t("tab_search"), icon: <IconSearch className="w-4 h-4 stroke-[1.5]" /> },
        { id: "inventory" as const, label: t("tab_inventory"), icon: <IconBox className="w-4 h-4 stroke-[1.5]" /> },
        { id: "created_by" as const, label: t("tab_created_by"), icon: <IconUsers className="w-4 h-4 stroke-[1.5]" /> },
        { id: "tags" as const, label: t("tab_costs_by_tag"), icon: <IconTags className="w-4 h-4 stroke-[1.5]" /> },
    ];

    return (
        <div className="space-y-6 w-full">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-montserrat text-2xl font-bold text-[#1B2A41] dark:text-white flex items-center gap-2.5">
                        <IconBox className="w-7 h-7 text-[#0078D4] stroke-[1.5]" />
                        {t("title")}
                        <InfoTooltip
                            content={t("page_tooltip")}
                            iconClassName="w-4 h-4 text-slate-400 hover:text-[#0054A6]"
                        />
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("subtitle")}
                    </p>
                </div>
            </div>

            {/* Sub-tabs Navigation */}
            <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-0.5 overflow-x-auto">
                {tabs.map((tb) => {
                    const isActive = tab === tb.id;
                    return (
                        <button
                            key={tb.id}
                            onClick={() => setTab(tb.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-b-2 ${
                                isActive
                                    ? "border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-blue-50/50 dark:bg-slate-800"
                                    : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                            }`}
                            aria-pressed={isActive}
                        >
                            <span className={isActive ? "text-[#0054A6] dark:text-blue-400" : "text-slate-400"}>
                                {tb.icon}
                            </span>
                            {tb.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Contents */}
            {tab === "search" && <SearchResourcesTab />}
            {tab === "inventory" && <InventoryTab />}
            {tab === "created_by" && <CreatedByTab />}
            {tab === "tags" && <CostsByTagTab />}
        </div>
    );
}

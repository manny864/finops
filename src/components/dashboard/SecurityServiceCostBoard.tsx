"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import MockBanner from "@/components/MockBanner";
import { DollarSign, Layers } from "lucide-react";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import InfoTooltip from "@/components/InfoTooltip";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Family = "sentinel" | "key-vault" | "entra-id" | "waf" | "ddos";
const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

export default function SecurityServiceCostBoard({
    family,
    title,
    subtitle,
    icon,
}: {
    family: Family;
    title: string;
    subtitle: string;
    icon?: React.ReactNode;
}) {
    const t = useTranslations("SecurityFamilies");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [resourceFilter, setResourceFilter] = useState<string>(FILTER_ALL);
    const [regionFilter, setRegionFilter] = useState<string>(FILTER_ALL);
    const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);
    const [resourceGroupFilter, setResourceGroupFilter] = useState<string>(FILTER_ALL);
    const [sortMode, setSortMode] = useState<SortMode>("cost-desc");

    const hasResources = Array.isArray(data?.resources) && data.resources.length > 0;
    const resources = useMemo(() => (Array.isArray(data?.resources) ? data.resources : []), [data?.resources]);
    const resourceOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(resources.map((resource: any) => String(resource.name || "-")))).sort().map((value) => ({ value, label: value }))],
        [resources, t]
    );
    const regionOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(resources.map((resource: any) => String(resource.region || "unknown")))).sort().map((value) => ({ value, label: value }))],
        [resources, t]
    );
    const typeOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(resources.map((resource: any) => String(resource.type || "-")))).sort().map((value) => ({ value, label: value }))],
        [resources, t]
    );
    const resourceGroupOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(resources.map((resource: any) => String(resource.resourceGroup || "-")))).sort().map((value) => ({ value, label: value }))],
        [resources, t]
    );
    const sortOptions = useMemo<FinopsTableOption[]>(
        () => [
            { value: "name-asc", label: t("sortAz") },
            { value: "name-desc", label: t("sortZa") },
            { value: "cost-desc", label: t("sortCostDesc") },
            { value: "cost-asc", label: t("sortCostAsc") },
        ],
        [t]
    );
    const filteredResources = useMemo(() => {
        const filtered = resources.filter((resource: any) => {
            if (resourceFilter !== FILTER_ALL && String(resource.name || "-") !== resourceFilter) return false;
            if (regionFilter !== FILTER_ALL && String(resource.region || "unknown") !== regionFilter) return false;
            if (typeFilter !== FILTER_ALL && String(resource.type || "-") !== typeFilter) return false;
            if (resourceGroupFilter !== FILTER_ALL && String(resource.resourceGroup || "-") !== resourceGroupFilter) return false;
            return true;
        });
        const sorted = [...filtered];
        if (sortMode === "name-asc") sorted.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        if (sortMode === "name-desc") sorted.sort((a, b) => String(b.name || "").localeCompare(String(a.name || "")));
        if (sortMode === "cost-desc") sorted.sort((a, b) => Number(b.monthlyCost || 0) - Number(a.monthlyCost || 0));
        if (sortMode === "cost-asc") sorted.sort((a, b) => Number(a.monthlyCost || 0) - Number(b.monthlyCost || 0));
        return sorted;
    }, [resources, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);
    const totalFilteredMonthlyCost = useMemo(
        () => filteredResources.reduce((acc: number, item: any) => acc + Number(item.monthlyCost || 0), 0),
        [filteredResources]
    );
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filteredResources, 15);

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
                const url = new URL("/api/intelligence/security/service-cost", window.location.origin);
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

    if (selectedTenant.id === "default") return null;
    if (loading) return <div className="p-6 w-full text-gray-500">{t("loading")}</div>;

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
            {hasResources ? (
                <FinopsTableControls
                    resourceOptions={resourceOptions}
                    regionOptions={regionOptions}
                    typeOptions={typeOptions}
                    resourceGroupOptions={resourceGroupOptions}
                    sortOptions={sortOptions}
                    selectedResource={resourceFilter}
                    selectedRegion={regionFilter}
                    selectedType={typeFilter}
                    selectedResourceGroup={resourceGroupFilter}
                    selectedSort={sortMode}
                    onResourceChange={setResourceFilter}
                    onRegionChange={setRegionFilter}
                    onTypeChange={setTypeFilter}
                    onResourceGroupChange={setResourceGroupFilter}
                    onSortChange={(value) => setSortMode(value as SortMode)}
                    labels={{
                        resource: t("filterResource"),
                        region: t("filterRegion"),
                        type: t("filterType"),
                        resourceGroup: t("filterResourceGroup"),
                        sort: t("sortBy"),
                    }}
                />
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                            <DollarSign className="w-4 h-4" />
                            {t("kpiTotalCost")}
                        </span>
                        <InfoTooltip content={t("kpiTotalCost")} position="bottom" align="right" />
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(hasResources ? totalFilteredMonthlyCost : Number(data?.monthlyCost || 0))}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                            <Layers className="w-4 h-4" />
                            {t("kpiResourceCount")}
                        </span>
                        <InfoTooltip content={t("kpiResourceCount")} position="bottom" align="right" />
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{hasResources ? filteredResources.length : Number(data?.resourceCount || 0)}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4 flex items-center gap-2">
                    <span>{t("tableTitle")}</span>
                    <InfoTooltip content={t("tableTitle")} position="bottom" align="left" />
                </h3>
                {hasResources ? (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-full table-fixed text-left border-collapse">
                                <thead>
                                    <tr>
                                        <ResizableTh minWidth={220} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">
                                            <div className="inline-flex items-center gap-1">
                                                <span>{t("colResourceName")}</span>
                                                <InfoTooltip content={t("colResourceName")} position="bottom" align="left" />
                                            </div>
                                        </ResizableTh>
                                        <ResizableTh minWidth={130} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">
                                            <div className="inline-flex items-center gap-1">
                                                <span>{t("colRegion")}</span>
                                                <InfoTooltip content={t("colRegion")} position="bottom" align="left" />
                                            </div>
                                        </ResizableTh>
                                        <ResizableTh minWidth={190} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">
                                            <div className="inline-flex items-center gap-1">
                                                <span>{t("colResourceType")}</span>
                                                <InfoTooltip content={t("colResourceType")} position="bottom" align="left" />
                                            </div>
                                        </ResizableTh>
                                        <ResizableTh minWidth={190} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">
                                            <div className="inline-flex items-center gap-1">
                                                <span>{t("colResourceGroup")}</span>
                                                <InfoTooltip content={t("colResourceGroup")} position="bottom" align="left" />
                                            </div>
                                        </ResizableTh>
                                        <ResizableTh minWidth={200} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">
                                            <div className="inline-flex items-center gap-1">
                                                <span>{t("colSubscription")}</span>
                                                <InfoTooltip content={t("colSubscription")} position="bottom" align="left" />
                                            </div>
                                        </ResizableTh>
                                        <ResizableTh minWidth={130} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">
                                            <div className="inline-flex items-center justify-end gap-1 w-full">
                                                <span>{t("colMonthlyCost")}</span>
                                                <InfoTooltip content={t("colMonthlyCost")} position="bottom" align="right" />
                                            </div>
                                        </ResizableTh>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paged.map((resource: any, index: number) => (
                                        <tr key={`${resource.subscriptionId || "sub"}-${resource.name || "resource"}-${index}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200 whitespace-normal break-words">{resource.name || "-"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{resource.region || "unknown"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{resource.type || "-"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{resource.resourceGroup || "-"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{resource.subscriptionName || resource.subscriptionId || "-"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(Number(resource.monthlyCost || 0))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} pageSizes={[15, 30, 45, 60]} />
                    </>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colService")}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colResources")}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colMonthlyCost")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{data?.serviceLabel || title}</td>
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-right">{Number(data?.resourceCount || 0)}</td>
                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(data?.monthlyCost || 0)}</td>
                            </tr>
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

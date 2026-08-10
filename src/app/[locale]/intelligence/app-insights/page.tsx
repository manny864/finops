"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect, useMemo } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Activity, DollarSign, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import Pagination, { usePagination } from "@/components/Pagination";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import ResizableTh from "@/components/ResizableTh";

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AppInsightsPage() {
    const t = useTranslations('AppInsights');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [resourceFilter, setResourceFilter] = useState<string>("__all__");
    const [regionFilter, setRegionFilter] = useState<string>("__all__");
    const [typeFilter, setTypeFilter] = useState<string>("__all__");
    const [resourceGroupFilter, setResourceGroupFilter] = useState<string>("__all__");
    const [sortMode, setSortMode] = useState<"name-asc" | "name-desc" | "cost-desc" | "cost-asc">("cost-desc");

    useEffect(() => {
        if (selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const url = new URL(`/api/intelligence/app-insights`, window.location.origin);
                url.searchParams.set('tenantId', selectedTenant.id);
                const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
                const json = await res.json();
                if (cancelled) return;
                if (res.ok) setData(json);
                else toast.error(json.error || t('toast_load_error'));
            } catch (e: any) {
                if (cancelled) return;
                console.error(e);
                toast.error(t('toast_network_error'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTenant.id, accounts.length, instance, t]);

    const items = data?.items || [];
    const resourceOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: "__all__", label: t("allOption") }, ...Array.from(new Set<string>(items.map((item: any) => String(item.name || "-")))).sort().map((value) => ({ value, label: value }))],
        [items, t]
    );
    const regionOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: "__all__", label: t("allOption") }, ...Array.from(new Set<string>(items.map((item: any) => String(item.region || "unknown")))).sort().map((value) => ({ value, label: value }))],
        [items, t]
    );
    const typeOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: "__all__", label: t("allOption") }, ...Array.from(new Set<string>(items.map((item: any) => String(item.type || "microsoft.insights/components")))).sort().map((value) => ({ value, label: value }))],
        [items, t]
    );
    const resourceGroupOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: "__all__", label: t("allOption") }, ...Array.from(new Set<string>(items.map((item: any) => String(item.resourceGroup || "unknown")))).sort().map((value) => ({ value, label: value }))],
        [items, t]
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
    const filteredItems = useMemo(() => {
        const filtered = items.filter((item: any) => {
            if (resourceFilter !== "__all__" && String(item.name || "-") !== resourceFilter) return false;
            if (regionFilter !== "__all__" && String(item.region || "unknown") !== regionFilter) return false;
            if (typeFilter !== "__all__" && String(item.type || "microsoft.insights/components") !== typeFilter) return false;
            if (resourceGroupFilter !== "__all__" && String(item.resourceGroup || "unknown") !== resourceGroupFilter) return false;
            return true;
        });
        const sorted = [...filtered];
        if (sortMode === "name-asc") sorted.sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));
        if (sortMode === "name-desc") sorted.sort((a: any, b: any) => String(b.name || "").localeCompare(String(a.name || "")));
        if (sortMode === "cost-desc") sorted.sort((a: any, b: any) => Number(b.monthlyCost || 0) - Number(a.monthlyCost || 0));
        if (sortMode === "cost-asc") sorted.sort((a: any, b: any) => Number(a.monthlyCost || 0) - Number(b.monthlyCost || 0));
        return sorted;
    }, [items, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filteredItems, 15);
    const filteredTotalCost = useMemo(
        () => filteredItems.reduce((acc: number, item: any) => acc + Number(item.monthlyCost || 0), 0),
        [filteredItems]
    );

    if (selectedTenant.id === 'default') return null;

    if (loading) {
        return (
            <div className="p-6 w-full flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t('loading')}</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">{t('load_error')}</div>;

    if (data.error) {
        const requiredTier = parseTierRequiredError(data.error);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('page_title')} />;
        }
    }

    if (data.empty || (data.items || []).length === 0) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('empty_title')}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{data.message || t('empty_desc')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 w-full animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <Activity className="w-8 h-8 text-brand-deep" />
                    {t('page_title')}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{t('page_subtitle')}</p>
            </div>
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
                onSortChange={(value) => setSortMode(value as "name-asc" | "name-desc" | "cost-desc" | "cost-asc")}
                labels={{
                    resource: t("filterResource"),
                    region: t("filterRegion"),
                    type: t("filterType"),
                    resourceGroup: t("filterResourceGroup"),
                    sort: t("sortBy"),
                }}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><DollarSign className="w-4 h-4" />{t('kpi_total_cost')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(filteredTotalCost)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Layers className="w-4 h-4" />{t('kpi_resource_count')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{filteredItems.length}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t('table_title')}</h3>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-full table-fixed text-left border-collapse">
                        <thead>
                            <tr>
                                <ResizableTh minWidth={190} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_resource')}</ResizableTh>
                                <ResizableTh minWidth={130} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('colRegion')}</ResizableTh>
                                <ResizableTh minWidth={200} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('colSubscription')}</ResizableTh>
                                <ResizableTh minWidth={180} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('colType')}</ResizableTh>
                                <ResizableTh minWidth={170} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('colResourceGroup')}</ResizableTh>
                                <ResizableTh minWidth={110} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_sampling')}</ResizableTh>
                                <ResizableTh minWidth={120} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_monthly_cost')}</ResizableTh>
                            </tr>
                        </thead>
                        <tbody>
                            {paged.map((r: any) => (
                                <tr key={r.resourceId} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200 whitespace-normal break-words">
                                        {r.name}
                                    </td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{r.region || "unknown"}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{r.subscriptionName || r.subscriptionId || t('na')}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{r.type || t('na')}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{r.resourceGroup || t('na')}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 text-right">{r.ingestionSamplingPercentage === null ? t('na') : `${r.ingestionSamplingPercentage}%`}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(r.monthlyCost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} pageSizes={[15,30,45,60]} />
                {!data.costBreakdownAvailable && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-3">{t('cost_unavailable_note')}</p>
                )}
            </div>
        </div>
    );
}

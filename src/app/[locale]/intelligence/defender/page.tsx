"use client";

import MockBanner from "@/components/MockBanner";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { ShieldCheck, DollarSign, Layers } from "lucide-react";
import { toast } from "sonner";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTranslations } from "next-intl";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import Pagination, { usePagination } from "@/components/Pagination";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import ResizableTh from "@/components/ResizableTh";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

export default function DefenderPage() {
    const t = useTranslations("Defender");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState<string>("");
    const [togglingKey, setTogglingKey] = useState<string | null>(null);
    const [resourceFilter, setResourceFilter] = useState<string>(FILTER_ALL);
    const [regionFilter, setRegionFilter] = useState<string>(FILTER_ALL);
    const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);
    const [resourceGroupFilter, setResourceGroupFilter] = useState<string>(FILTER_ALL);
    const [sortMode, setSortMode] = useState<SortMode>("cost-desc");

    const authFetch = useCallback(async (url: string, init?: RequestInit) => {
        const mock = isMockTenant(selectedTenant.id);
        const headers = new Headers(init?.headers);
        if (!mock) headers.set("Authorization", `Bearer ${await getFreshIdToken(instance, accounts[0])}`);
        const res = await fetch(url, { ...init, headers });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || t("toast_load_error"));
        return json;
    }, [accounts, instance, selectedTenant.id, t]);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const json = await authFetch(`/api/intelligence/defender?tenantId=${selectedTenant.id}`);
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [authFetch, selectedTenant.id]);

    useEffect(() => {
        if (selectedTenant.id === "default" || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        void load();
    }, [selectedTenant.id, accounts.length, load]);

    const plans = useMemo(() => (Array.isArray(data?.plans) ? data.plans : []), [data?.plans]);
    const standardPlanCount = Math.max(1, Number(data?.standardPlanCount || 0));
    const totalMonthlyCost = Number(data?.totalMonthlyCost || 0);
    const enrichedPlans = useMemo(
        () => plans.map((plan: any) => ({
            ...plan,
            resourceName: String(plan.planName || "-"),
            region: "global",
            type: "microsoft.security/pricings",
            resourceGroup: "-",
            monthlyCostEstimate: plan.pricingTier === "Standard" ? Number((totalMonthlyCost / standardPlanCount).toFixed(2)) : 0,
        })),
        [plans, standardPlanCount, totalMonthlyCost]
    );

    const resourceOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(enrichedPlans.map((plan: any) => String(plan.resourceName || "-")))).sort().map((value) => ({ value, label: value }))],
        [enrichedPlans, t]
    );
    const regionOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(enrichedPlans.map((plan: any) => String(plan.region || "global")))).sort().map((value) => ({ value, label: value }))],
        [enrichedPlans, t]
    );
    const typeOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(enrichedPlans.map((plan: any) => String(plan.type || "microsoft.security/pricings")))).sort().map((value) => ({ value, label: value }))],
        [enrichedPlans, t]
    );
    const resourceGroupOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(enrichedPlans.map((plan: any) => String(plan.resourceGroup || "-")))).sort().map((value) => ({ value, label: value }))],
        [enrichedPlans, t]
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

    const filteredPlans = useMemo(() => {
        const filtered = enrichedPlans.filter((plan: any) => {
            if (resourceFilter !== FILTER_ALL && String(plan.resourceName || "-") !== resourceFilter) return false;
            if (regionFilter !== FILTER_ALL && String(plan.region || "global") !== regionFilter) return false;
            if (typeFilter !== FILTER_ALL && String(plan.type || "microsoft.security/pricings") !== typeFilter) return false;
            if (resourceGroupFilter !== FILTER_ALL && String(plan.resourceGroup || "-") !== resourceGroupFilter) return false;
            return true;
        });
        const sorted = [...filtered];
        if (sortMode === "name-asc") sorted.sort((a, b) => String(a.resourceName || "").localeCompare(String(b.resourceName || "")));
        if (sortMode === "name-desc") sorted.sort((a, b) => String(b.resourceName || "").localeCompare(String(a.resourceName || "")));
        if (sortMode === "cost-desc") sorted.sort((a, b) => Number(b.monthlyCostEstimate || 0) - Number(a.monthlyCostEstimate || 0));
        if (sortMode === "cost-asc") sorted.sort((a, b) => Number(a.monthlyCostEstimate || 0) - Number(b.monthlyCostEstimate || 0));
        return sorted;
    }, [enrichedPlans, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);
    const filteredTotalCost = useMemo(
        () => filteredPlans.reduce((acc: number, plan: any) => acc + Number(plan.monthlyCostEstimate || 0), 0),
        [filteredPlans]
    );
    const filteredStandardCount = useMemo(
        () => filteredPlans.filter((plan: any) => plan.pricingTier === "Standard").length,
        [filteredPlans]
    );
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filteredPlans, 15);

    if (selectedTenant.id === "default") return null;

    if (error) {
        const requiredTier = parseTierRequiredError(error);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t("page_title")} />;
        }
    }

    if (loading) {
        return (
            <div className="p-6 w-full flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t("loading")}</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">{t("load_error")}</div>;

    async function toggle(plan: any) {
        const key = `${plan.subscriptionId}/${plan.planName}`;
        const nextTier = plan.pricingTier === "Standard" ? "Free" : "Standard";
        setTogglingKey(key);
        try {
            await authFetch("/api/intelligence/defender", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selectedTenant.id, subscriptionId: plan.subscriptionId, planName: plan.planName, pricingTier: nextTier }),
            });
            toast.success(t("toast_updated"));
            await load();
        } catch (e: any) {
            toast.error(e.message || t("toast_update_error"));
        } finally {
            setTogglingKey(null);
        }
    }

    return (
        <div className="p-6 w-full animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <ShieldCheck className="w-8 h-8 text-brand-deep" />
                    {t("page_title")}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{t("page_subtitle")}</p>
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
                onSortChange={(value) => setSortMode(value as SortMode)}
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
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><DollarSign className="w-4 h-4" />{t("kpi_total_cost")}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(filteredTotalCost)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Layers className="w-4 h-4" />{t("kpi_standard_plans")}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{filteredStandardCount}</p>
                </div>
            </div>

            {filteredPlans.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center shadow-sm">
                    <ShieldCheck className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t("empty_title")}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{t("empty_desc")}</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t("table_title")}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-full table-fixed text-left border-collapse">
                            <thead>
                                <tr>
                                    <ResizableTh minWidth={190} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_resource")}</ResizableTh>
                                    <ResizableTh minWidth={130} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_region")}</ResizableTh>
                                    <ResizableTh minWidth={190} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_subscription")}</ResizableTh>
                                    <ResizableTh minWidth={200} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_type")}</ResizableTh>
                                    <ResizableTh minWidth={170} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_resource_group")}</ResizableTh>
                                    <ResizableTh minWidth={120} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_tier")}</ResizableTh>
                                    <ResizableTh minWidth={130} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("col_monthly_cost")}</ResizableTh>
                                    <ResizableTh minWidth={140} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("col_action")}</ResizableTh>
                                </tr>
                            </thead>
                            <tbody>
                                {paged.map((plan: any) => {
                                    const key = `${plan.subscriptionId}/${plan.planName}`;
                                    return (
                                        <tr key={key} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200 whitespace-normal break-words">{plan.resourceName}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{plan.region}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 font-mono whitespace-normal break-words">{plan.subscriptionId || "-"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{plan.type}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{plan.resourceGroup}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${plan.pricingTier === "Standard" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400"}`}>
                                                    {plan.pricingTier}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(Number(plan.monthlyCostEstimate || 0))}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-right">
                                                {!isMockTenant(selectedTenant.id) && (
                                                    <button
                                                        onClick={() => void toggle(plan)}
                                                        disabled={togglingKey === key}
                                                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                                                    >
                                                        {togglingKey === key ? t("toggling") : (plan.pricingTier === "Standard" ? t("action_disable") : t("action_enable"))}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} pageSizes={[15, 30, 45, 60]} />
                    {!data.costBreakdownAvailable && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-3">{t("cost_unavailable_note")}</p>
                    )}
                </div>
            )}
        </div>
    );
}

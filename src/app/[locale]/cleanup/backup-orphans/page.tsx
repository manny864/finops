"use client";
import MockBanner from "@/components/MockBanner";
import React, { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { ShieldAlert, Info, DollarSign, Layers, Tag } from "lucide-react";
import { toast } from "sonner";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTranslations } from "next-intl";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import BulkTagModal from "@/components/BulkTagModal";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

export default function BackupOrphansPage() {
    const t = useTranslations("BackupOrphans");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState<string>("");
    const [resourceFilter, setResourceFilter] = useState<string>(FILTER_ALL);
    const [regionFilter, setRegionFilter] = useState<string>(FILTER_ALL);
    const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);
    const [resourceGroupFilter, setResourceGroupFilter] = useState<string>(FILTER_ALL);
    const [sortMode, setSortMode] = useState<SortMode>("cost-desc");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isTagModalOpen, setIsTagModalOpen] = useState(false);

    useEffect(() => {
        if (selectedTenant.id === "default" || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError("");
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const url = new URL(`/api/cleanup/backup-orphans`, window.location.origin);
                url.searchParams.set("tenantId", selectedTenant.id);
                const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
                const json = await res.json();
                if (cancelled) return;
                if (res.ok) setData(json);
                else setError(json.error || t("toast_load_error"));
            } catch (e) {
                if (cancelled) return;
                console.error(e);
                toast.error(t("toast_network_error"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedTenant.id, accounts.length, instance, t]);

    const items = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data?.items]);
    const filteredItems = useMemo(() => {
        const filtered = items.filter((item: any) => {
            const resource = String(item.itemName || "-");
            const region = String(item.region || "global");
            const type = String(item.backupManagementType || "-");
            const rg = String(item.resourceGroup || "-");
            if (resourceFilter !== FILTER_ALL && resource !== resourceFilter) return false;
            if (regionFilter !== FILTER_ALL && region !== regionFilter) return false;
            if (typeFilter !== FILTER_ALL && type !== typeFilter) return false;
            if (resourceGroupFilter !== FILTER_ALL && rg !== resourceGroupFilter) return false;
            return true;
        });
        const sorted = [...filtered];
        if (sortMode === "name-asc") sorted.sort((a, b) => String(a.itemName || "").localeCompare(String(b.itemName || "")));
        if (sortMode === "name-desc") sorted.sort((a, b) => String(b.itemName || "").localeCompare(String(a.itemName || "")));
        if (sortMode === "cost-desc") sorted.sort((a, b) => Number(b.estimatedMonthlyCost || 0) - Number(a.estimatedMonthlyCost || 0));
        if (sortMode === "cost-asc") sorted.sort((a, b) => Number(a.estimatedMonthlyCost || 0) - Number(b.estimatedMonthlyCost || 0));
        return sorted;
    }, [items, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filteredItems, 15);
    const totalFilteredMonthlyCost = useMemo(
        () => filteredItems.reduce((sum: number, item: any) => sum + Number(item.estimatedMonthlyCost || 0), 0),
        [filteredItems]
    );

    useEffect(() => {
        setPage(1);
    }, [resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode, setPage]);

    // Cleanup: prune selected IDs that no longer exist
    useEffect(() => {
        setSelectedIds((prev) => {
            if (prev.size === 0) return prev;
            const validIds = new Set(filteredItems.map((item: any) => item.sourceResourceId));
            const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [filteredItems]);

    const toggleSelected = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === paged.length) {
            setSelectedIds(new Set());
        } else {
            const allIds = new Set(paged.map((item: any) => item.sourceResourceId));
            setSelectedIds(allIds);
        }
    };

    const selectedResourceNames = useMemo(
        () =>
            Array.from(selectedIds)
                .map((id) => filteredItems.find((item: any) => item.sourceResourceId === id)?.itemName)
                .filter(Boolean),
        [selectedIds, filteredItems]
    );

    const allOption = t("allOption");
    const resourceOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: allOption }, ...Array.from(new Set<string>(items.map((item: any) => String(item.itemName || "-")))).sort().map((value) => ({ value, label: value }))],
        [items, allOption]
    );
    const regionOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: allOption }, ...Array.from(new Set<string>(items.map((item: any) => String(item.region || "global")))).sort().map((value) => ({ value, label: value }))],
        [items, allOption]
    );
    const typeOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: allOption }, ...Array.from(new Set<string>(items.map((item: any) => String(item.backupManagementType || "-")))).sort().map((value) => ({ value, label: value }))],
        [items, allOption]
    );
    const resourceGroupOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: allOption }, ...Array.from(new Set<string>(items.map((item: any) => String(item.resourceGroup || "-")))).sort().map((value) => ({ value, label: value }))],
        [items, allOption]
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

    return (
        <div className="p-6 w-full animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <ShieldAlert className="w-8 h-8 text-brand-deep" />
                    {t("page_title")}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{t("page_subtitle")}</p>
            </div>

            {items.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center shadow-sm">
                    <ShieldAlert className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t("empty_title")}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{t("empty_desc")}</p>
                </div>
            ) : (
                <>
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                                <DollarSign className="w-4 h-4" />
                                {t("kpi_total_cost")}
                            </h3>
                            <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(totalFilteredMonthlyCost)}</p>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                                <Layers className="w-4 h-4" />
                                {t("kpi_item_count")}
                            </h3>
                            <p className="text-2xl font-black text-gray-900 dark:text-white">{filteredItems.length}</p>
                        </div>
                    </div>

                    {selectedIds.size > 0 && (
                        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
                            <span className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                                {selectedIds.size} {t("itemsSelected", { defaultMessage: "items selected" })}
                            </span>
                            <button
                                onClick={() => setIsTagModalOpen(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                <Tag className="w-4 h-4" />
                                {t("bulkTagButton", { defaultMessage: "Apply Tags" })}
                            </button>
                        </div>
                    )}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                        <div className="mb-4 flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 p-3 rounded-lg text-sm">
                            <Info className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{t("review_disclaimer")}</span>
                        </div>
                        <div className="overflow-x-scroll custom-scrollbar pb-1">
                            <table className="w-full min-w-[1700px] table-fixed text-left border-collapse">
                                <thead>
                                    <tr>
                                        <ResizableTh minWidth={40} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.size === paged.length && paged.length > 0}
                                                onChange={toggleSelectAll}
                                                className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                                            />
                                        </ResizableTh>
                                        <ResizableTh minWidth={250} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_resource")}</ResizableTh>
                                        <ResizableTh minWidth={140} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_region")}</ResizableTh>
                                        <ResizableTh minWidth={180} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_type")}</ResizableTh>
                                        <ResizableTh minWidth={200} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_resource_group")}</ResizableTh>
                                        <ResizableTh minWidth={220} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_subscription")}</ResizableTh>
                                        <ResizableTh minWidth={180} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_vault")}</ResizableTh>
                                        <ResizableTh minWidth={170} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("col_state")}</ResizableTh>
                                        <ResizableTh minWidth={140} className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("col_cost")}</ResizableTh>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paged.map((item: any, idx: number) => (
                                        <tr key={`${item.sourceResourceId || "row"}-${idx}`} className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors ${selectedIds.has(item.sourceResourceId) ? "bg-blue-50 dark:bg-blue-900/10" : ""}`}>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(item.sourceResourceId)}
                                                    onChange={() => toggleSelected(item.sourceResourceId)}
                                                    className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                                                />
                                            </td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200 whitespace-normal break-words">{item.itemName}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{item.region || "global"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{item.backupManagementType}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{item.resourceGroup}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{item.subscriptionName || item.subscriptionId}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{item.vaultName}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{item.protectionState}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right whitespace-nowrap tabular-nums">{fmt.format(Number(item.estimatedMonthlyCost || 0))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="mt-4">
                            <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} pageSizes={[15, 30, 45, 60]} />
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">{t("cost_estimate_note")}</p>
                    </div>
                </>
            )}
            <BulkTagModal
                isOpen={isTagModalOpen}
                resourceIds={Array.from(selectedIds)}
                resourceNames={selectedResourceNames as string[]}
                onClose={() => setIsTagModalOpen(false)}
                onSuccess={() => setSelectedIds(new Set())}
                t={t}
            />
        </div>
    );
}

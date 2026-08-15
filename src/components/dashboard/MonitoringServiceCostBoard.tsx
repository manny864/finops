"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import MockBanner from "@/components/MockBanner";
import { DollarSign, Layers, Edit, Trash2, Plus } from "lucide-react";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import AlertEditModal from "@/components/AlertEditModal";
import ActionGroupEditModal from "@/components/ActionGroupEditModal";

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Family = "azure-monitor" | "alerts" | "action-groups" | "workbooks" | "network-watcher" | "microsoft-sentinel";
const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

export default function MonitoringServiceCostBoard({
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
    const t = useTranslations("MonitoringFamilies");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [resourceFilter, setResourceFilter] = useState<string>(FILTER_ALL);
    const [regionFilter, setRegionFilter] = useState<string>(FILTER_ALL);
    const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);
    const [resourceGroupFilter, setResourceGroupFilter] = useState<string>(FILTER_ALL);
    const [sortMode, setSortMode] = useState<SortMode>("cost-desc");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedAlert, setSelectedAlert] = useState<any>(null);
    const [selectedActionGroup, setSelectedActionGroup] = useState<any>(null);
    const [modalLoading, setModalLoading] = useState(false);
    
    const hasResources = Array.isArray(data?.resources) && data.resources.length > 0;
    const resources = useMemo(() => (Array.isArray(data?.resources) ? data.resources : []), [data?.resources]);
    const resourceOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(resources.map((r: any) => String(r.name || "-")))).sort().map((value) => ({ value, label: value }))],
        [resources, t]
    );
    const regionOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(resources.map((r: any) => String(r.region || "unknown")))).sort().map((value) => ({ value, label: value }))],
        [resources, t]
    );
    const typeOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(resources.map((r: any) => String(r.type || "-")))).sort().map((value) => ({ value, label: value }))],
        [resources, t]
    );
    const resourceGroupOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: t("allOption") }, ...Array.from(new Set<string>(resources.map((r: any) => String(r.resourceGroup || "-")))).sort().map((value) => ({ value, label: value }))],
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
                const url = new URL("/api/intelligence/monitoring/service-cost", window.location.origin);
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

    const handleEditAlert = async (alert: any) => {
        if (family !== "alerts") return;
        setModalLoading(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(
                `/api/intelligence/monitoring/alerts?tenantId=${encodeURIComponent(selectedTenant.id)}&alertId=${encodeURIComponent(alert.id)}`,
                {
                    method: "PUT",
                    headers: { 
                        Authorization: `Bearer ${idToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(alert),
                }
            );
            if (!res.ok) throw new Error("Failed to update alert");
            const updated = await res.json();
            setData((prev: any) => ({
                ...prev,
                resources: prev.resources.map((r: any) => r.id === updated.id ? updated : r),
            }));
            toast.success("Alert updated successfully");
            setIsModalOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error updating alert");
        } finally {
            setModalLoading(false);
        }
    };

    const handleDeleteAlert = async (alertId: string) => {
        if (family !== "alerts" || !confirm("Delete this alert?")) return;
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(
                `/api/intelligence/monitoring/alerts?tenantId=${encodeURIComponent(selectedTenant.id)}&alertId=${encodeURIComponent(alertId)}`,
                {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${idToken}` },
                }
            );
            if (!res.ok) throw new Error("Failed to delete alert");
            setData((prev: any) => ({
                ...prev,
                resources: prev.resources.filter((r: any) => r.id !== alertId),
            }));
            toast.success("Alert deleted successfully");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error deleting alert");
        }
    };

    const handleEditActionGroup = async (actionGroup: any) => {
        if (family !== "action-groups") return;
        setModalLoading(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(
                `/api/intelligence/monitoring/action-groups?tenantId=${encodeURIComponent(selectedTenant.id)}&actionGroupId=${encodeURIComponent(actionGroup.id)}`,
                {
                    method: "PUT",
                    headers: { 
                        Authorization: `Bearer ${idToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(actionGroup),
                }
            );
            if (!res.ok) throw new Error("Failed to update action group");
            const updated = await res.json();
            setData((prev: any) => ({
                ...prev,
                resources: prev.resources.map((r: any) => r.id === updated.id ? updated : r),
            }));
            toast.success("Action group updated successfully");
            setIsModalOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error updating action group");
        } finally {
            setModalLoading(false);
        }
    };

    const handleDeleteActionGroup = async (actionGroupId: string) => {
        if (family !== "action-groups" || !confirm("Delete this action group?")) return;
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(
                `/api/intelligence/monitoring/action-groups?tenantId=${encodeURIComponent(selectedTenant.id)}&actionGroupId=${encodeURIComponent(actionGroupId)}`,
                {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${idToken}` },
                }
            );
            if (!res.ok) throw new Error("Failed to delete action group");
            setData((prev: any) => ({
                ...prev,
                resources: prev.resources.filter((r: any) => r.id !== actionGroupId),
            }));
            toast.success("Action group deleted successfully");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error deleting action group");
        }
    };

    if (selectedTenant.id === "default") return null;
    if (loading) return <div className="p-6 w-full text-gray-500">{t("loading")}</div>;

    return (
        <div className="p-6 w-full animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                    {icon}
                    {title}
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
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {t("kpiTotalCost")}
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(hasResources ? totalFilteredMonthlyCost : Number(data?.monthlyCost || 0))}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Layers className="w-4 h-4" />
                        {t("kpiResourceCount")}
                    </h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{hasResources ? filteredResources.length : Number(data?.resourceCount || 0)}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t("tableTitle")}</h3>
                {hasResources ? (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-full table-fixed text-left border-collapse">
                                <thead>
                                    <tr>
                                        <ResizableTh minWidth={220} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colResourceName")}</ResizableTh>
                                        <ResizableTh minWidth={130} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colRegion")}</ResizableTh>
                                        <ResizableTh minWidth={180} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colResourceType")}</ResizableTh>
                                        <ResizableTh minWidth={180} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colResourceGroup")}</ResizableTh>
                                        <ResizableTh minWidth={200} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t("colSubscription")}</ResizableTh>
                                        <ResizableTh minWidth={130} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("colMonthlyCost")}</ResizableTh>
                                        {(family === "alerts" || family === "action-groups") && <ResizableTh minWidth={120} className="bg-white dark:bg-slate-900 py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-center">Actions</ResizableTh>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {paged.map((res: any, idx: number) => (
                                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200 whitespace-normal break-words">{res.name}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{res.region || "unknown"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{res.type || "-"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{res.resourceGroup || "-"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 whitespace-normal break-words">{res.subscriptionName || res.subscriptionId || "-"}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(res.monthlyCost)}</td>
                                            {family === "alerts" && (
                                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-center flex gap-2 justify-center">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedAlert(res);
                                                            setIsModalOpen(true);
                                                        }}
                                                        className="rounded p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-700"
                                                        title="Edit alert"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => void handleDeleteAlert(res.id)}
                                                        className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-slate-700"
                                                        title="Delete alert"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            )}
                                            {family === "action-groups" && (
                                                <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-center flex gap-2 justify-center">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedActionGroup(res);
                                                            setIsModalOpen(true);
                                                        }}
                                                        className="rounded p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-700"
                                                        title="Edit action group"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => void handleDeleteActionGroup(res.id)}
                                                        className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-slate-700"
                                                        title="Delete action group"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            )}
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

            {family === "alerts" && (
                <AlertEditModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false);
                        setSelectedAlert(null);
                    }}
                    alert={selectedAlert}
                    onSave={handleEditAlert}
                    loading={modalLoading}
                />
            )}

            {family === "action-groups" && (
                <ActionGroupEditModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false);
                        setSelectedActionGroup(null);
                    }}
                    actionGroup={selectedActionGroup}
                    onSave={handleEditActionGroup}
                    loading={modalLoading}
                />
            )}
        </div>
    );
}

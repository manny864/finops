"use client";
import React, { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { usePendingDeletionsStore } from '@/store/pendingDeletionsStore';
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Network, AlertCircle, Info, DollarSign, Trash2, Tag, ShieldCheck, Shield, Edit3, X, MessageSquare, Zap } from "lucide-react";

import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { canDeleteResources } from "@/lib/tierLogic";
import EnterpriseDeleteDisclaimer from "@/components/EnterpriseDeleteDisclaimer";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import { errorMessage } from '@/lib/apiErrors';

type ZombieItem = {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    armType: string;
    resourceGroup: string;
    subscriptionId: string;
    monthlyCost: number;
    reason: string;
    daysIdle: number;
    isExempted?: boolean;
    exemptionReason?: string;
    exemptionComment?: string;
};

const TYPE_BADGE: Record<string, string> = {
    applicationGateway:       "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
    loadBalancer:             "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
    virtualNetworkGateway:    "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
    virtualNetwork:           "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
    subnet:                   "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
    virtualWanHub:            "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
    routeServer:              "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
    expressRouteCircuit:      "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
    vnetPeering:              "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
    azureFirewall:            "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
    networkSecurityGroup:     "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
    applicationSecurityGroup: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
    privateEndpoint:          "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
    privateDnsZone:           "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
    dnsZone:                  "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
    bastionHost:              "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
    ddosProtectionPlan:       "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400",
    webApplicationFirewall:   "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
    frontDoor:                "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
    trafficManager:           "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
    natGateway:               "bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400",
    networkWatcher:           "bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300",
    trafficAnalytics:         "bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300",
};

const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function NetworkingZombiesPanel() {
    const t = useTranslations("NetworkingZombies");
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    
    const { addPending, isPending } = usePendingDeletionsStore();
    
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [resourceFilter, setResourceFilter] = useState<string>(FILTER_ALL);
    const [regionFilter, setRegionFilter] = useState<string>(FILTER_ALL);
    const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);
    const [resourceGroupFilter, setResourceGroupFilter] = useState<string>(FILTER_ALL);
    const [sortMode, setSortMode] = useState<SortMode>("cost-desc");
    const [taggingItems, setTaggingItems] = useState<ZombieItem[]>([]);
    const [tagValues, setTagValues] = useState({ CostCenter: "", Environment: "", Owner: "" });
    const [isTagging, setIsTagging] = useState(false);

    const [exemptionModalOpen, setExemptionModalOpen] = useState(false);
    const [exemptionItem, setExemptionItem] = useState<ZombieItem | null>(null);
    const [reasonInput, setReasonInput] = useState("");
    const [commentInput, setCommentInput] = useState("");
    const [savingExemption, setSavingExemption] = useState(false);

    const handleOpenExemptionModal = (item: ZombieItem) => {
        setExemptionItem(item);
        setReasonInput(item.exemptionReason || "");
        setCommentInput(item.exemptionComment || "");
        setExemptionModalOpen(true);
    };

    const handleSaveExemption = async () => {
        if (!exemptionItem) return;
        setSavingExemption(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/intelligence/zombies/exemptions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                    "x-tenant-id": selectedTenant?.id || ""
                },
                body: JSON.stringify({
                    tenantId: selectedTenant?.id,
                    recommendationType: "zombies",
                    resourceId: exemptionItem.resourceId,
                    resourceName: exemptionItem.resourceName,
                    reason: reasonInput || "Eximida por el usuario",
                    comment: commentInput || null
                })
            });
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || "Error guardando exención");
            mutate();
            setExemptionModalOpen(false);
            toast.success(t("exemptionSaved"));
        } catch (err) {
            toast.error(errorMessage(err) || "Error al guardar exención");
        } finally {
            setSavingExemption(false);
        }
    };

    const handleRemoveExemption = async (item: ZombieItem) => {
        if (!window.confirm(t("confirm_remove_exemption", { name: item.resourceName }))) return;
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/intelligence/zombies/exemptions?resourceId=${encodeURIComponent(item.resourceId)}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "x-tenant-id": selectedTenant?.id || ""
                }
            });
            if (!res.ok) throw new Error("Error removiendo exención");
            mutate();
            toast.success("Exención eliminada", { description: "La sugerencia ha sido restaurada." });
        } catch {
            toast.error("Error", { description: "No se pudo remover la exención." });
        }
    };

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || t("loadError"));
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/cleanup/zombies/networking?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const toggleSelected = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const removeFromCache = (resourceIds: Set<string>) => {
        mutate((prev: any) => {
            if (!prev) return prev;
            const items = (prev.items || []).filter((r: ZombieItem) => !resourceIds.has(r.resourceId));
            const totalMonthlyWaste = Number(items.reduce((sum: number, r: ZombieItem) => sum + r.monthlyCost, 0).toFixed(2));
            return { ...prev, items, totalMonthlyWaste };
        }, { revalidate: false });
    };

    // Ejecuta el DELETE contra /api/remediation para un único recurso; no
    // muestra toasts (single-item y bulk manejan su propio feedback).
    const deleteResourceItem = async (item: ZombieItem): Promise<{ ok: boolean; error?: string }> => {
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/remediation", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    tenantId: selectedTenant?.id,
                    subscriptionId: item.subscriptionId,
                    resourceGroup: item.resourceGroup,
                    resourceName: item.resourceName,
                    resourceType: item.armType,
                    resourceId: item.resourceId,
                    domain: 'networking',
                }),
            });
            const json = await res.json();
            if (!res.ok) return { ok: false, error: json.error || t("deleteFailed") };
            return { ok: true };
        } catch (err) {
            return { ok: false, error: errorMessage(err) };
        }
    };

    const handleDelete = async (item: ZombieItem) => {
        if (!selectedTenant) return;
        if (!window.confirm(t("confirmDeleteSingle", { name: item.resourceName, type: item.resourceType }))) return;

        setDeletingId(item.resourceId);
        const result = await deleteResourceItem(item);
        if (result.ok) {
            addPending({
                id: item.resourceId,
                name: item.resourceName,
                type: item.resourceType,
                tenantId: selectedTenant.id
            });
            removeFromCache(new Set([item.resourceId]));
            toast.success(t("deletedToastTitle"), { description: t("deletedToastDescription", { name: item.resourceName }) });
        } else if (result.error === "MISSING_CONTRIBUTOR_ROLE") {
            toast.error(t("deniedToastTitle"), { description: t("deniedToastDescriptionSingle") });
        } else {
            toast.error(t("deleteErrorToastTitle"), { description: result.error });
        }
        setDeletingId(null);
    };

    const handleBulkDelete = async (items: ZombieItem[]) => {
        if (!selectedTenant || items.length === 0) return;
        if (!window.confirm(t("confirmDeleteBulk", { count: items.length }))) return;

        setBulkDeleting(true);
        const removed = new Set<string>();
        let ok = 0, missingRole = 0, failed = 0;
        for (const item of items) {
            setDeletingId(item.resourceId);
            const result = await deleteResourceItem(item);
            if (result.ok) { 
                ok++; 
                removed.add(item.resourceId); 
                addPending({
                    id: item.resourceId,
                    name: item.resourceName,
                    type: item.resourceType,
                    tenantId: selectedTenant.id
                });
            }
            else if (result.error === "MISSING_CONTRIBUTOR_ROLE") missingRole++;
            else failed++;
        }
        if (removed.size > 0) removeFromCache(removed);
        setDeletingId(null);
        setBulkDeleting(false);
        setSelectedIds(new Set());

        if (ok > 0) toast.success(t("bulkDeletedToastTitle", { count: ok }), { description: t("bulkDeletedToastDescription") });
        if (missingRole > 0) toast.error(t("deniedToastTitle"), { description: t("deniedToastDescriptionBulk", { count: missingRole }) });
        if (failed > 0) toast.error(t("bulkDeleteErrorToastTitle"), { description: t("bulkDeleteErrorToastDescription", { count: failed }) });
    };

    const handleTagSubmit = async () => {
        if (!selectedTenant || taggingItems.length === 0) return;
        setIsTagging(true);

        let ok = 0, failed = 0;
        for (const item of taggingItems) {
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const res = await fetch("/api/tags/apply", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        tenantId: selectedTenant.id,
                        resourceId: item.resourceId,
                        tags: tagValues,
                    }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.details || json.error || t("tagApplyFailed"));
                ok++;
            } catch {
                failed++;
            }
        }

        setIsTagging(false);
        setTaggingItems([]);
        setSelectedIds(new Set());

        if (ok > 0) toast.success(ok === 1 ? t("tagsAppliedSingle") : t("tagsAppliedMultiple", { count: ok }));
        if (failed > 0) toast.error(t("tagsFailedToast", { count: failed }));
    };

    const tenantInactive = !selectedTenant || selectedTenant.id === "default";
    const items: ZombieItem[] = Array.isArray(data?.items) ? data.items : [];
    const totalWaste: number = Number(data?.totalMonthlyWaste || 0);
    const canDelete = canDeleteResources(selectedTenant?.tier || "Professional", 'networking');
    const filteredItems = useMemo(() => {
        const filtered = items.filter((item) => {
            const resourceName = String(item.resourceName || "-");
            const region = String((item as any).region || (item as any).location || "-");
            const type = String(item.resourceType || "-");
            const resourceGroup = String(item.resourceGroup || "-");
            if (resourceFilter !== FILTER_ALL && resourceName !== resourceFilter) return false;
            if (regionFilter !== FILTER_ALL && region !== regionFilter) return false;
            if (typeFilter !== FILTER_ALL && type !== typeFilter) return false;
            if (resourceGroupFilter !== FILTER_ALL && resourceGroup !== resourceGroupFilter) return false;
            return true;
        });
        const sorted = [...filtered];
        if (sortMode === "name-asc") sorted.sort((a, b) => String(a.resourceName || "").localeCompare(String(b.resourceName || "")));
        if (sortMode === "name-desc") sorted.sort((a, b) => String(b.resourceName || "").localeCompare(String(a.resourceName || "")));
        if (sortMode === "cost-desc") sorted.sort((a, b) => Number(b.monthlyCost || 0) - Number(a.monthlyCost || 0));
        if (sortMode === "cost-asc") sorted.sort((a, b) => Number(a.monthlyCost || 0) - Number(b.monthlyCost || 0));
        return sorted;
    }, [items, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filteredItems, 15);
    const filteredTotalWaste = useMemo(
        () => filteredItems.reduce((sum, item) => sum + Number(item.monthlyCost || 0), 0),
        [filteredItems]
    );
    const pageItems = paged;
    const pageAllSelected = pageItems.length > 0 && pageItems.every((i) => selectedIds.has(i.resourceId));
    const pageSomeSelected = !pageAllSelected && pageItems.some((i) => selectedIds.has(i.resourceId));
    const selectedItems = filteredItems.filter((i) => selectedIds.has(i.resourceId));

    useEffect(() => {
        setPage(1);
    }, [resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode, setPage]);

    const allOption = t("allOption");
    const resourceOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: allOption }, ...Array.from(new Set(filteredItems.map((item) => String(item.resourceName || "-")))).sort().map((value) => ({ value, label: value }))],
        [filteredItems, allOption]
    );
    const regionOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: allOption }, ...Array.from(new Set(filteredItems.map((item) => String((item as any).region || (item as any).location || "-")))).sort().map((value) => ({ value, label: value }))],
        [filteredItems, allOption]
    );
    const typeOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: allOption }, ...Array.from(new Set(filteredItems.map((item) => String(item.resourceType || "-")))).sort().map((value) => ({ value, label: value }))],
        [filteredItems, allOption]
    );
    const resourceGroupOptions = useMemo<FinopsTableOption[]>(
        () => [{ value: FILTER_ALL, label: allOption }, ...Array.from(new Set(filteredItems.map((item) => String(item.resourceGroup || "-")))).sort().map((value) => ({ value, label: value }))],
        [filteredItems, allOption]
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

    if (tenantInactive) return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loadingMessage")}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t("featureName")} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {t("errorHeading")}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {data.mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <span className="font-bold mr-2 px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 rounded text-xs">{tm("badge")}</span>
                        {tm("description")}
                    </div>
                </div>
            )}

            {!canDelete && <EnterpriseDeleteDisclaimer domain="networking" />}

            {/* Acumulación de Private Endpoints: aunque estén sanos y en uso, cada
                uno suma un costo fijo por hora — desplegar decenas sin consolidar
                genera un gasto acumulado que no aparece como "recurso roto". */}
            {data.privateEndpointAccumulation?.totalCount > 0 && (
                <div className="bg-fuchsia-50 dark:bg-fuchsia-950/20 p-3 flex gap-3 rounded-xl border border-fuchsia-200 dark:border-fuchsia-800/50 text-fuchsia-800 dark:text-fuchsia-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-sm">
                        {t("privateEndpointAccumulation", {
                            count: data.privateEndpointAccumulation.totalCount,
                            cost: data.privateEndpointAccumulation.estimatedMonthlyCost.toFixed(2),
                        })}
                    </p>
                </div>
            )}

            {/* Listado completo de Private Endpoints (conectados + desconectados),
                para que se puedan revisar y tomar acción caso por caso. Los
                Disconnected ya son accionables (borrado) en la tabla de abajo —
                acá solo se marca su estado; no se duplica el botón de borrado
                para no exponer un delete de un click sobre recursos sanos. */}
            {(data.privateEndpointsDetail?.length || 0) > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">{t("pePanelTitle")}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t("pePanelSubtitle")}</p>
                    <div className="max-h-80 overflow-y-auto overflow-x-scroll custom-scrollbar pb-1 rounded-lg border border-gray-100 dark:border-slate-800">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-800/50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t("peColName")}</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t("peColResourceGroup")}</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t("peColSubscription")}</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t("peColState")}</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t("peColCost")}</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-100 dark:divide-slate-800">
                                {[...data.privateEndpointsDetail]
                                    .sort((a: any, b: any) => (a.connectionState === "Disconnected" ? -1 : 1) - (b.connectionState === "Disconnected" ? -1 : 1))
                                    .map((pe: any) => {
                                        const isDisconnected = pe.connectionState === "Disconnected";
                                        return (
                                            <tr key={pe.resourceId} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                                <td className="px-4 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap">{pe.resourceName}</td>
                                                <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{pe.resourceGroup}</td>
                                                <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono text-xs">{pe.subscriptionId}</td>
                                                <td className="px-4 py-2 whitespace-nowrap">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${isDisconnected ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"}`}>
                                                        {isDisconnected ? t("peStateDisconnected") : t("peStateConnected")}
                                                    </span>
                                                    {isDisconnected && (
                                                        <span className="ml-2 text-[11px] text-red-600 dark:text-red-400">{t("peActionableAbove")}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">${pe.monthlyCost.toFixed(2)}</td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Summary KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t("kpiDetectedLabel")}</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{items.length}</p>
                    <p className="text-xs text-slate-400 mt-1">{t("kpiDetectedSub")}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        {t("kpiWasteLabel")}
                    </p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">{usdFmt.format(filteredTotalWaste)}</p>
                    <p className="text-xs text-slate-400 mt-1">{t("kpiWasteSub")}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t("kpiSavingsLabel")}</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{usdFmt.format(filteredTotalWaste * 12)}</p>
                    <p className="text-xs text-slate-400 mt-1">{t("kpiSavingsSub")}</p>
                </div>
            </div>

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-800/50">
                    <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">{t("selectedCount", { count: selectedIds.size })}</span>
                    <button
                        onClick={() => {
                            setTaggingItems(selectedItems);
                            setTagValues({ CostCenter: "", Environment: "", Owner: "" });
                        }}
                        className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800/50 transition-colors"
                    >
                        <Tag className="w-3.5 h-3.5" /> {t("tagSelected")}
                    </button>
                    {canDelete ? (
                        <button
                            onClick={() => handleBulkDelete(selectedItems)}
                            disabled={bulkDeleting}
                            className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800/50 transition-colors disabled:opacity-50"
                        >
                            <Trash2 className="w-3.5 h-3.5" /> {bulkDeleting ? t("deleting") : t("deleteSelected")}
                        </button>
                    ) : (
                        <span className="text-xs font-medium text-gray-400 dark:text-slate-500 px-3 py-1.5">
                            {t("deleteRequiresEnterprise")}
                        </span>
                    )}
                    <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 font-semibold">
                        {t("clearSelection")}
                    </button>
                </div>
            )}

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

            {/* Table */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                    <Network className="w-4 h-4 text-cyan-500" />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("tableTitle")}</h3>
                    <span className="ml-auto text-xs font-medium px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-500 rounded-full">
                        {filteredItems.length}
                    </span>
                </div>
                {filteredItems.length === 0 ? (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                        <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">{t("emptyState")}</p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-scroll custom-scrollbar pb-1">
                            <table className="w-full min-w-[2100px] table-fixed text-sm text-left">
                                <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <ResizableTh minWidth={48} className="px-4 py-3 w-8">
                                            <input
                                                type="checkbox"
                                                checked={pageAllSelected}
                                                ref={(el) => { if (el) el.indeterminate = pageSomeSelected; }}
                                                onChange={() => {
                                                    setSelectedIds((prev) => {
                                                        const next = new Set(prev);
                                                        if (pageAllSelected) pageItems.forEach((i) => next.delete(i.resourceId));
                                                        else pageItems.forEach((i) => next.add(i.resourceId));
                                                        return next;
                                                    });
                                                }}
                                                className="cursor-pointer"
                                            />
                                        </ResizableTh>
                                        <ResizableTh minWidth={220} className="px-4 py-3 font-semibold">{t("colResource")}</ResizableTh>
                                        <ResizableTh minWidth={140} className="px-4 py-3 font-semibold">{t("colRegion")}</ResizableTh>
                                        <ResizableTh minWidth={180} className="px-4 py-3 font-semibold">{t("colType")}</ResizableTh>
                                        <ResizableTh minWidth={190} className="px-4 py-3 font-semibold">{t("colResourceGroup")}</ResizableTh>
                                        <ResizableTh minWidth={200} className="px-4 py-3 font-semibold">{t("colSubscription")}</ResizableTh>
                                        <ResizableTh minWidth={220} className="px-4 py-3 font-semibold">{t("colReason")}</ResizableTh>
                                        <ResizableTh minWidth={100} className="px-4 py-3 font-semibold text-right">{t("colDaysIdle")}</ResizableTh>
                                        <ResizableTh minWidth={170} className="px-4 py-3 font-semibold text-right">{t("colMonthlyCost")}</ResizableTh>
                                        {canDelete && <ResizableTh minWidth={320} className="px-4 py-3 font-semibold text-right">{t("colAction")}</ResizableTh>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                    {pageItems.map((item) => (
                                        <tr key={item.resourceId} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                            <td className="px-4 py-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(item.resourceId)}
                                                    onChange={() => toggleSelected(item.resourceId)}
                                                    className="cursor-pointer"
                                                />
                                            </td>
                                            <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200" title={item.resourceName}>
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-[7px] font-bold text-ink">
                                                        {item.isExempted ? (
                                                            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                                                        ) : (
                                                            <Network className="w-4 h-4 text-cyan-500" />
                                                        )}
                                                        <span className="max-w-[220px] truncate">{item.resourceName}</span>
                                                    </div>
                                                    {item.isExempted && (
                                                        <div className="mt-1.5 ml-6 flex flex-col gap-1">
                                                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 w-fit">
                                                                <Shield className="w-3 h-3" />
                                                                {t("badge_exempted")}
                                                            </span>
                                                            {item.exemptionReason && (
                                                                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 m-0">
                                                                    📌 {item.exemptionReason}
                                                                </p>
                                                            )}
                                                            {item.exemptionComment && (
                                                                <p className="text-[10px] text-slate-500 dark:text-slate-400 italic m-0 bg-surface-2 p-1.5 rounded border border-line/60 max-w-md">
                                                                    💬 "{item.exemptionComment}"
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                                                {(item as any).region || (item as any).location || "-"}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TYPE_BADGE[item.resourceType] || "bg-gray-100 text-gray-600"}`}>
                                                    {item.resourceType}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">{item.resourceGroup}</td>
                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{(item as any).subscriptionName || item.subscriptionId}</td>
                                            <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={item.reason}>
                                                {item.reason}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className="text-slate-600 dark:text-slate-300">
                                                    {item.daysIdle}d
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400 whitespace-nowrap tabular-nums">
                                                {usdFmt.format(Number(item.monthlyCost || 0))}
                                            </td>
                                            {canDelete && (
                                                <td className="px-4 py-3 align-top">
                                                    <div className="flex justify-end items-start gap-2 whitespace-nowrap">
                                                        {item.isExempted ? (
                                                            <>
                                                                <button
                                                                    onClick={() => handleOpenExemptionModal(item)}
                                                                    className="font-heading font-semibold text-[11px] rounded-lg bg-surface-2 hover:bg-surface-3 text-ink border border-line p-[6px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs h-fit whitespace-nowrap"
                                                                    title={t("btn_edit_exemption")}
                                                                >
                                                                    <Edit3 className="w-3.5 h-3.5 text-primary" />
                                                                    {t("btn_edit_exemption")}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleRemoveExemption(item)}
                                                                    className="font-heading font-semibold text-[11px] rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 p-[6px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs h-fit whitespace-nowrap"
                                                                    title={t("btn_remove_exemption")}
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                                                    {t("btn_remove_exemption")}
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => handleOpenExemptionModal(item)}
                                                                    className="font-heading font-semibold text-[11px] rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-line p-[7px_10px] cursor-pointer active:scale-95 transition-all inline-flex items-center gap-1 shadow-xs h-fit whitespace-nowrap"
                                                                    title={t("btn_exempt")}
                                                                >
                                                                    <Shield className="w-3.5 h-3.5 text-amber" />
                                                                    {t("btn_exempt")}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDelete(item)}
                                                                    disabled={deletingId === item.resourceId || isPending(item.resourceId)}
                                                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 p-[7px_10px] rounded-lg border border-transparent h-fit whitespace-nowrap"
                                                                    title={t("deleteTitle", { name: item.resourceName })}
                                                                >
                                                                    {deletingId === item.resourceId || isPending(item.resourceId) ? (
                                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                    ) : (
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    )}
                                                                    {isPending(item.resourceId) ? "Borrando..." : t("delete")}
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800">
                            <Pagination
                                page={page}
                                setPage={setPage}
                                pageSize={pageSize}
                                setPageSize={setPageSize}
                                total={total}
                                totalPages={totalPages}
                                pageSizes={[15, 30, 45, 60]}
                            />
                        </div>
                    </>
                )}
            </div>

            {/* Bulk tag modal */}
            {taggingItems.length > 0 && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6 w-[450px] animate-in zoom-in-95">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-2">{t("tagModalTitle")}</h3>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
                            {taggingItems.length === 1 ? (
                                t.rich("tagModalDescSingle", {
                                    name: taggingItems[0].resourceName,
                                    mono: (chunks) => <span className="font-mono font-semibold text-gray-700 dark:text-slate-300">{chunks}</span>,
                                })
                            ) : (
                                t.rich("tagModalDescMultiple", {
                                    count: taggingItems.length,
                                    strong: (chunks) => <span className="font-semibold text-gray-700 dark:text-slate-300">{chunks}</span>,
                                })
                            )}{" "}
                            {t.rich("tagModalPolicyNote", {
                                b: (chunks) => <b>{chunks}</b>,
                            })}
                        </p>
                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">CostCenter</label>
                                <input
                                    type="text"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-700 dark:bg-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-deep"
                                    placeholder={t("costCenterPlaceholder")}
                                    value={tagValues.CostCenter}
                                    onChange={(e) => setTagValues({ ...tagValues, CostCenter: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Environment</label>
                                <select
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-700 dark:bg-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-deep"
                                    value={tagValues.Environment}
                                    onChange={(e) => setTagValues({ ...tagValues, Environment: e.target.value })}
                                >
                                    <option value="">{t("environmentPlaceholder")}</option>
                                    <option value="Production">Production</option>
                                    <option value="Staging">Staging</option>
                                    <option value="Development">Development</option>
                                    <option value="Testing">Testing</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 mb-1">Owner</label>
                                <input
                                    type="text"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-700 dark:bg-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-deep"
                                    placeholder={t("ownerPlaceholder")}
                                    value={tagValues.Owner}
                                    onChange={(e) => setTagValues({ ...tagValues, Owner: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setTaggingItems([])}
                                className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-md transition-colors"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                onClick={handleTagSubmit}
                                disabled={isTagging || !tagValues.CostCenter || !tagValues.Environment || !tagValues.Owner}
                                className="px-4 py-2 text-sm font-semibold text-white bg-[#0054A6] hover:bg-[#00AEEF] rounded-md transition-colors disabled:opacity-50 flex items-center"
                            >
                                {isTagging ? t("applying") : t("applyTags")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {exemptionModalOpen && exemptionItem && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
                        <button
                            onClick={() => setExemptionModalOpen(false)}
                            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber">
                                <Shield className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t("modal_exemption_title")}</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{exemptionItem.resourceName}</p>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                            {t("modal_exemption_desc")}
                        </p>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                    {t("field_reason")}
                                </label>
                                <input
                                    type="text"
                                    value={reasonInput}
                                    onChange={(e) => setReasonInput(e.target.value)}
                                    placeholder={t("field_reason_placeholder")}
                                    className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                                    <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                                    {t("field_comment")}
                                </label>
                                <textarea
                                    rows={4}
                                    value={commentInput}
                                    onChange={(e) => setCommentInput(e.target.value)}
                                    placeholder={t("field_comment_placeholder")}
                                    className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-all resize-none"
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={() => setExemptionModalOpen(false)}
                                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-xl border border-transparent cursor-pointer transition-all"
                            >
                                {t("cancel", { defaultMessage: "Cancelar" })}
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveExemption}
                                disabled={savingExemption}
                                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md cursor-pointer transition-all disabled:opacity-50 inline-flex items-center gap-2"
                            >
                                {savingExemption ? <Zap className="w-4 h-4 animate-bounce" /> : <ShieldCheck className="w-4 h-4" />}
                                {t("btn_save_exemption")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

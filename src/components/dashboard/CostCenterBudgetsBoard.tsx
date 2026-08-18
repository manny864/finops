"use client";
import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, AlertCircle, Wallet, AlertTriangle, Pencil, Check, X, Trash2, Plus, Eye, Tag } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import BulkTagModal from "@/components/BulkTagModal";

const UNASSIGNED_NAME = "Sin asignar";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

function Kpi({ label, value, icon: Icon, tone, subtitle, badge }: { label: string; value: string; icon: any; tone: string; subtitle?: string; badge?: string }) {
    return (
        <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                <Icon className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{label}</p>
                    {badge && <span className="rounded bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">{badge}</span>}
                </div>
                <p className="text-lg font-extrabold text-gray-900 dark:text-white">{value}</p>
                {subtitle && <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{subtitle}</p>}
            </div>
        </div>
    );
}

function BudgetCell({ costCenter, isAdmin, onSaved, onDeleted, t }: { costCenter: any; isAdmin: boolean; onSaved: (name: string, value: number) => void; onDeleted: (name: string) => void; t: ReturnType<typeof useTranslations> }) {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(String(costCenter.budget ?? ""));
    const [saving, setSaving] = useState(false);

    const remove = async () => {
        if (!confirm(t("confirmDeleteBudget"))) return;
        setSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/intelligence/cost-centers?tenantId=${selectedTenant.id}&costCenterName=${encodeURIComponent(costCenter.name)}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${idToken}` }
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("deleteError"));
            toast.success(t("deleteSuccess"));
            onDeleted(costCenter.name);
        } catch (e: any) {
            toast.error(e.message || t("deleteError"));
        }
        setSaving(false);
    };

    const save = async () => {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
            toast.error(t("invalidBudget"));
            return;
        }
        setSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/intelligence/cost-centers", {
                method: "PUT",
                headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selectedTenant.id, costCenterName: costCenter.name, monthlyBudgetUsd: num }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("saveError"));
            toast.success(t("saveSuccess"));
            onSaved(costCenter.name, num);
            setEditing(false);
        } catch (e: any) {
            toast.error(e.message || t("saveError"));
        }
        setSaving(false);
    };

    if (!editing) {
        return (
            <div className="flex items-center gap-2">
                <span className={costCenter.budget === null ? "text-gray-400 italic" : "text-gray-700 dark:text-gray-300"}>
                    {costCenter.budget === null ? t("budgetNotSet") : fmtUsd(costCenter.budget)}
                </span>
                {isAdmin && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditing(true)} className="p-1 rounded text-gray-400 hover:text-brand-deep hover:bg-gray-100 dark:hover:bg-slate-800" title={t("editBudgetTooltip")}>
                            <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {costCenter.budget !== null && (
                            <button onClick={remove} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30" title={t("deleteBudgetTooltip")}>
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5">
            <input
                type="number"
                min={0}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
                className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-700 rounded-md text-sm bg-white dark:bg-slate-900"
            />
            <button onClick={save} disabled={saving} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50" title={t("saveTooltip")}>
                <Check className="w-4 h-4" />
            </button>
            <button onClick={() => setEditing(false)} disabled={saving} className="text-gray-400 hover:text-gray-600" title={t("cancelTooltip")}>
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}

/** Modal / Drawer espacioso con los recursos individuales de un Centro de Costos, con selección múltiple (hasta 100) y paginación 25/50/75/100. */
function ResourceDrawer({
    tenantId, costCenterName, excludedIds, onClose, onAssignTags, t,
}: {
    tenantId: string;
    costCenterName: string;
    excludedIds?: Set<string>;
    onClose: () => void;
    onAssignTags?: (resources: Array<{ id: string; name: string }>) => void;
    t: ReturnType<typeof useTranslations>;
}) {
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [resources, setResources] = useState<Array<{ id: string; name: string; type: string; resourceGroup: string }>>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(25);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const res = await fetch(`/api/intelligence/cost-centers/resources?tenantId=${tenantId}&costCenterName=${encodeURIComponent(costCenterName)}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || t("loadError"));
                if (!cancelled) {
                    const rawList = json.resources || [];
                    const filtered = excludedIds && excludedIds.size > 0
                        ? rawList.filter((r: any) => !excludedIds.has(r.id))
                        : rawList;
                    setResources(filtered);
                    setSelectedIds(new Set());
                    setPage(1);
                }
            } catch (e: any) {
                if (!cancelled) setError(e.message || t("loadError"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [tenantId, costCenterName, excludedIds, instance, accounts, t]);

    // Filtrado en tiempo real
    const filteredResources = useMemo(() => {
        let list = resources;
        if (excludedIds && excludedIds.size > 0) {
            list = list.filter((r) => !excludedIds.has(r.id));
        }
        if (!searchQuery.trim()) return list;
        const q = searchQuery.toLowerCase();
        return list.filter((r) =>
            r.name.toLowerCase().includes(q) ||
            r.resourceGroup.toLowerCase().includes(q) ||
            r.type.toLowerCase().includes(q)
        );
    }, [resources, excludedIds, searchQuery]);

    // Resetear a página 1 si cambia la búsqueda o pageSize
    React.useEffect(() => {
        setPage(1);
    }, [searchQuery, pageSize]);

    const totalFiltered = filteredResources.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
    const pagedResources = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredResources.slice(start, start + pageSize);
    }, [filteredResources, page, pageSize]);

    const allOnPageSelected = useMemo(() => {
        if (pagedResources.length === 0) return false;
        return pagedResources.every((r) => selectedIds.has(r.id));
    }, [pagedResources, selectedIds]);

    const toggleSelectResource = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            if (next.size >= 100) {
                toast.warning(t("maxSelectionWarning", { defaultMessage: "Solo se pueden etiquetar hasta 100 recursos por lote." }));
                return;
            }
            next.add(id);
        }
        setSelectedIds(next);
    };

    const toggleSelectAllOnPage = () => {
        const next = new Set(selectedIds);
        if (allOnPageSelected) {
            // Deseleccionar los de la página actual
            pagedResources.forEach((r) => next.delete(r.id));
        } else {
            // Seleccionar los de la página actual respetando el límite de 100
            let added = 0;
            let reachedLimit = false;
            for (const r of pagedResources) {
                if (!next.has(r.id)) {
                    if (next.size >= 100) {
                        reachedLimit = true;
                        break;
                    }
                    next.add(r.id);
                    added++;
                }
            }
            if (reachedLimit) {
                toast.warning(t("bulkLimitExceeded", { defaultMessage: "Límite excedido: se pueden seleccionar como máximo 100 recursos para etiquetado masivo." }));
            }
        }
        setSelectedIds(next);
    };

    const handleAssignSelected = () => {
        if (!onAssignTags) return;
        const selectedList = resources
            .filter((r) => selectedIds.has(r.id))
            .map((r) => ({ id: r.id, name: r.name }));
        if (selectedList.length === 0) {
            toast.error(t("noResourcesSelected", { defaultMessage: "No hay recursos seleccionados" }));
            return;
        }
        if (selectedList.length > 100) {
            toast.error(t("bulkLimitExceeded", { defaultMessage: "Límite excedido: se pueden seleccionar como máximo 100 recursos para etiquetado masivo." }));
            return;
        }
        onAssignTags(selectedList);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] border border-gray-100 dark:border-slate-800 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-800/50">
                    <div className="min-w-0 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-[#E6F2FB] dark:bg-slate-800 flex items-center justify-center text-[#0054A6] shrink-0">
                            <Tag className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-lg font-bold text-[#1B2A41] dark:text-white truncate">
                                    {costCenterName}
                                </h3>
                                <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                                    {resources.length} {t("drawerSubtitle", { count: resources.length })}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {t("selectedCountLabel", { selected: selectedIds.size, total: totalFiltered })}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Toolbar: Búsqueda + Selector de Paginación */}
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="relative w-full sm:w-72">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t("searchResourcesPlaceholder", { defaultMessage: "Buscar por nombre, tipo o resource group..." })}
                            className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0054A6]/20 focus:border-[#0054A6] dark:text-white"
                        />
                        <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                            <span>{t("pageSizeLabel", { defaultMessage: "Por página:" })}</span>
                            {[25, 50, 75, 100].map((size) => (
                                <button
                                    key={size}
                                    onClick={() => setPageSize(size)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                                        pageSize === size
                                            ? "bg-white dark:bg-slate-900 border-[#0054A6] text-[#0054A6] shadow-sm ring-1 ring-[#0054A6]/20"
                                            : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                                    }`}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>

                        {onAssignTags && (
                            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-xl border border-amber-200 dark:border-amber-900/50 shrink-0">
                                Máx. 100
                            </span>
                        )}
                    </div>
                </div>

                {/* Tabla de Recursos */}
                <div className="flex-1 overflow-y-auto p-4">
                    {loading && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 animate-spin text-[#0054A6] mb-3" />
                            <p className="text-xs font-semibold text-slate-500">{t("loading")}</p>
                        </div>
                    )}
                    {error && (
                        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 text-xs font-semibold">
                            {error}
                        </div>
                    )}
                    {!loading && !error && totalFiltered === 0 && (
                        <div className="text-center py-16 text-slate-400 text-xs">
                            {t("drawerEmpty", { defaultMessage: "No se encontraron recursos para este centro de costos." })}
                        </div>
                    )}

                    {!loading && !error && totalFiltered > 0 && (
                        <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-slate-800">
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/80 dark:bg-slate-800/60 text-slate-500 font-bold uppercase tracking-wider">
                                        {onAssignTags && (
                                            <th className="py-3 px-4 w-12 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={allOnPageSelected}
                                                    onChange={toggleSelectAllOnPage}
                                                    className="w-4 h-4 rounded text-[#0054A6] focus:ring-[#0054A6] cursor-pointer"
                                                    title={t("selectAllOnPage", { defaultMessage: "Seleccionar todos en la página" })}
                                                />
                                            </th>
                                        )}
                                        <th className="py-3 px-4">{t("colResourceName", { defaultMessage: "Recurso" })}</th>
                                        <th className="py-3 px-4">{t("colResourceGroup", { defaultMessage: "Grupo de Recursos" })}</th>
                                        <th className="py-3 px-4">{t("colResourceType", { defaultMessage: "Tipo de Recurso" })}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800 font-medium">
                                    {pagedResources.map((r) => {
                                        const isSelected = selectedIds.has(r.id);
                                        return (
                                            <tr
                                                key={r.id}
                                                onClick={() => onAssignTags && toggleSelectResource(r.id)}
                                                className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${
                                                    isSelected ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
                                                }`}
                                            >
                                                {onAssignTags && (
                                                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleSelectResource(r.id)}
                                                            className="w-4 h-4 rounded text-[#0054A6] focus:ring-[#0054A6] cursor-pointer"
                                                        />
                                                    </td>
                                                )}
                                                <td className="py-3 px-4 font-semibold text-[#1B2A41] dark:text-white max-w-xs truncate">
                                                    {r.name}
                                                </td>
                                                <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                                                    {r.resourceGroup}
                                                </td>
                                                <td className="py-3 px-4 text-slate-500 dark:text-slate-400 font-mono text-[11px] truncate max-w-xs">
                                                    {r.type.split("/").pop()}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Footer: Paginación y Botón de Acción */}
                <div className="p-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 font-semibold">
                        <span>
                            {t("pageOf", { page, totalPages, defaultMessage: `Página ${page} de ${totalPages}` })}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:opacity-40 disabled:pointer-events-none hover:bg-white dark:hover:bg-slate-800"
                            >
                                {t("prevPage", { defaultMessage: "Anterior" })}
                            </button>
                            <button
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:opacity-40 disabled:pointer-events-none hover:bg-white dark:hover:bg-slate-800"
                            >
                                {t("nextPage", { defaultMessage: "Siguiente" })}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                        >
                            {t("cancel", { defaultMessage: "Cerrar" })}
                        </button>
                        {onAssignTags && (
                            <button
                                onClick={handleAssignSelected}
                                disabled={selectedIds.size === 0 || selectedIds.size > 100}
                                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 text-[#0054A6] dark:text-cyan-400 border border-[#0054A6] dark:border-cyan-500 hover:bg-blue-50/50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-all shadow-sm"
                            >
                                <Tag className="w-3.5 h-3.5" />
                                <span>
                                    {t("assignSelectedTagsBtn", {
                                        count: selectedIds.size,
                                        defaultMessage: `Etiquetar Seleccionados (${selectedIds.size})`,
                                    })}
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function CostCenterBudgetsBoard() {
    const t = useProviderTranslations("IntelligenceCostCenters");
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    const isMock = isMockTenant(selectedTenant?.id);
    const isAdmin = userRole === "Admin" || userRole === "Owner" || systemRole === "SUPERADMIN" || isMock;

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newCostCenter, setNewCostCenter] = useState("");
    const [newBudgetUsd, setNewBudgetUsd] = useState("");
    const [creating, setCreating] = useState(false);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || t("loadError")); }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/cost-centers?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const costCenters: any[] = useMemo(() => data?.costCenters || [], [data]);
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(costCenters, 15);

    const [drawerCostCenter, setDrawerCostCenter] = useState<string | null>(null);
    const [bulkTagLoading, setBulkTagLoading] = useState(false);
    const [bulkTagData, setBulkTagData] = useState<{ ids: string[]; names: string[] } | null>(null);
    const [locallyTaggedIds, setLocallyTaggedIds] = useState<Set<string>>(() => new Set());

    const fetchAndOpenBulkTag = async (costCenterName: string) => {
        setBulkTagLoading(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/intelligence/cost-centers/resources?tenantId=${selectedTenant.id}&costCenterName=${encodeURIComponent(costCenterName)}`, {
                headers: { Authorization: `Bearer ${idToken}` },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("loadError"));
            const resources: Array<{ id: string; name: string }> = json.resources || [];
            if (resources.length === 0) { toast.error(t("noResourcesFound")); return; }
            setBulkTagData({ ids: resources.map((r) => r.id), names: resources.map((r) => r.name) });
            setDrawerCostCenter(null);
        } catch (e: any) {
            toast.error(e.message || t("loadError"));
        } finally {
            setBulkTagLoading(false);
        }
    };

    const unassignedSpend = data?.unassignedSpend ?? 0;
    const allocationRate = data?.allocationRate ?? 0;
    const unassignedSharePct = data?.totalSpend > 0 ? Number(((unassignedSpend / data.totalSpend) * 100).toFixed(1)) : 0;
    const showUnassignedBanner = unassignedSharePct > 20;

    const handleBudgetSaved = (name: string, value: number) => {
        mutate({
            ...data,
            costCenters: costCenters.map((c) => c.name === name
                ? { ...c, budget: value, pctUsed: value > 0 ? Number(((c.currentMonthCost / value) * 100).toFixed(1)) : null, overBudget: c.currentMonthCost > value }
                : c),
        }, false);
    };

    const handleBudgetDeleted = (name: string) => {
        mutate({
            ...data,
            costCenters: costCenters.filter((c) => c.name !== name || c.currentMonthCost > 0).map((c) => c.name === name ? { ...c, budget: null, pctUsed: null, overBudget: false } : c),
        }, false);
    };

    const handleCreateBudget = async () => {
        const num = Number(newBudgetUsd);
        if (!newCostCenter.trim() || !Number.isFinite(num) || num < 0) {
            toast.error(t("invalidBudget"));
            return;
        }
        setCreating(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/intelligence/cost-centers", {
                method: "PUT",
                headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId: selectedTenant.id, costCenterName: newCostCenter.trim(), monthlyBudgetUsd: num }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("saveError"));
            
            toast.success(t("saveSuccess"));
            
            // Si el cost center ya existe, actualizamos su presupuesto, si no, lo agregamos.
            const existing = costCenters.find((c) => c.name === newCostCenter.trim());
            if (existing) {
                handleBudgetSaved(newCostCenter.trim(), num);
            } else {
                mutate(); // Mutate completo para refetch, ya que no teníamos el historial de gastos para calcular todo
            }
            setIsCreateModalOpen(false);
            setNewCostCenter("");
            setNewBudgetUsd("");
        } catch (e: any) {
            toast.error(e.message || t("saveError"));
        }
        setCreating(false);
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t("errorFeatureName")} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {t("errorTitle")}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <Kpi
                    label={t("kpiSpend")}
                    value={fmtUsd(data?.totalSpend)}
                    icon={Wallet}
                    tone="bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400"
                    subtitle={t("kpiSpendSubtitle", { projected: fmtUsd(costCenters.reduce((s, c) => s + (c.projectedMonthEndSpend || 0), 0)) })}
                />
                <Kpi
                    label={t("kpiBudget")}
                    value={fmtUsd(data?.totalBudget)}
                    icon={Wallet}
                    tone="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                    subtitle={data?.totalBudget > 0 ? t("kpiBudgetSubtitle", { pct: Math.round(((data?.totalSpend || 0) / data.totalBudget) * 100) }) : undefined}
                />
                <Kpi label={t("kpiOverBudget")} value={String(data?.overBudgetCount ?? 0)} icon={AlertTriangle} tone="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" />
                <Kpi
                    label={t("kpiAllocationRate")}
                    value={`${allocationRate}%`}
                    icon={Tag}
                    tone="bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400"
                    subtitle={t("kpiAllocationRateSubtitle", { allocated: allocationRate, unassigned: Math.round((100 - allocationRate) * 10) / 10 })}
                    badge={allocationRate < 70 ? "⚠️" : undefined}
                />
            </div>

            {showUnassignedBanner && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                            <AlertTriangle className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <p className="text-sm text-amber-800 dark:text-amber-300">
                                {t("unassignedBannerMessage", { percent: unassignedSharePct, amount: fmtUsd(unassignedSpend) })}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setDrawerCostCenter(UNASSIGNED_NAME)}
                                className="px-3 py-1.5 rounded-md text-xs font-bold border border-amber-600 text-amber-700 dark:text-amber-300 bg-white dark:bg-slate-900 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                            >
                                {t("viewUnassignedBtn")}
                            </button>
                            {isAdmin && (
                                <button
                                    onClick={() => fetchAndOpenBulkTag(UNASSIGNED_NAME)}
                                    disabled={bulkTagLoading}
                                    className="px-3 py-1.5 rounded-md text-xs font-bold bg-brand-deep text-white hover:bg-brand-bright disabled:opacity-50 flex items-center gap-1.5"
                                >
                                    {bulkTagLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    {t("assignUnassignedBtn")}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t("tableTitle", { count: costCenters.length })}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {t("groupedByTagPrefix")} <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">CostCenter</code>{t("groupedByTagSuffix")}
                            {isAdmin ? t("editHintAdmin") : t("editHintReadonly")}
                        </p>
                    </div>
                    {isAdmin && (
                        <button
                            onClick={() => setIsCreateModalOpen(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-brand-deep text-white text-sm font-semibold rounded-lg hover:bg-brand-bright transition-colors shadow-sm"
                        >
                            <Plus className="w-4 h-4" />
                            {t("createBudgetBtn")}
                        </button>
                    )}
                </div>
                <div className="p-6">
                    {costCenters.length === 0 ? (
                        <div className="text-sm text-gray-500 bg-gray-50 dark:bg-slate-800 p-4 rounded-md border border-gray-100 dark:border-slate-700">
                            {t("emptyState")}
                        </div>
                    ) : (
                        <div className="overflow-x-auto custom-scrollbar" style={{ scrollbarWidth: "thin" }}>
                            <table className="min-w-full table-fixed divide-y divide-gray-200 dark:divide-slate-700">
                                <thead className="bg-gray-50 dark:bg-slate-900">
                                    <tr>
                                        <ResizableTh minWidth={160} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("colCostCenter")}</ResizableTh>
                                        <ResizableTh minWidth={130} className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{t("kpiSpend")}</ResizableTh>
                                        <ResizableTh minWidth={110} className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{t("colChangeVsPrevMonth")}</ResizableTh>
                                        <ResizableTh minWidth={150} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("colMonthlyBudget")}</ResizableTh>
                                        <ResizableTh minWidth={160} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("colUsage")}</ResizableTh>
                                        <ResizableTh minWidth={90} className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{t("colActions")}</ResizableTh>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                                    {paged.map((c) => (
                                        <tr key={c.name} className={`group ${c.overBudget ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm font-medium text-gray-900 dark:text-gray-100">
                                                <div className="flex items-center gap-2">
                                                    <span>{c.name}</span>
                                                    {typeof c.resourceCount === "number" && c.resourceCount > 0 && (
                                                        <span className="rounded bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 dark:text-gray-300">{c.resourceCount}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm text-right text-gray-700 dark:text-gray-300 tabular-nums">{fmtUsd(c.currentMonthCost)}</td>
                                            <td className={`px-6 py-4 whitespace-normal break-words text-sm text-right tabular-nums ${c.changePct > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                {c.changePct > 0 ? "+" : ""}{c.changePct}%
                                            </td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm">
                                                <BudgetCell costCenter={c} isAdmin={isAdmin} onSaved={handleBudgetSaved} onDeleted={handleBudgetDeleted} t={t} />
                                            </td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm">
                                                {c.pctUsed === null ? (
                                                    isAdmin ? (
                                                        <button onClick={() => setIsCreateModalOpen(true)} className="text-xs font-semibold text-brand-deep hover:underline">{t("assignBudgetBtn")}</button>
                                                    ) : (
                                                        <span className="text-gray-400 text-xs">—</span>
                                                    )
                                                ) : (
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-2 min-w-[60px] max-w-[100px]">
                                                                <div
                                                                    className={`h-2 rounded-full ${c.overBudget ? "bg-red-500" : c.pctUsed >= 90 ? "bg-amber-500" : "bg-emerald-500"}`}
                                                                    style={{ width: `${Math.min(100, c.pctUsed)}%` }}
                                                                />
                                                            </div>
                                                            <span className={`text-xs font-semibold ${c.overBudget ? "text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-300"}`}>
                                                                {c.pctUsed}%
                                                            </span>
                                                        </div>
                                                        {typeof c.projectedPctUsed === "number" && (
                                                            <p className={`text-[11px] ${c.isProjectedOverBudget ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-400 dark:text-gray-500"}`}>
                                                                {t("usageProjectionLabel", { pct: c.projectedPctUsed })} {c.isProjectedOverBudget ? "⚠️" : ""}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm text-right">
                                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => setDrawerCostCenter(c.name)}
                                                        className="p-1 rounded text-gray-400 hover:text-brand-deep hover:bg-gray-100 dark:hover:bg-slate-800"
                                                        title={t("viewResourcesTooltip")}
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
                        </div>
                    )}
                </div>
            </div>

            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-slate-800">
                        <div className="flex justify-between items-center p-5 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t("createBudgetTitle")}</h3>
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                                    {t("costCenterNameLabel")} <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={newCostCenter}
                                    onChange={(e) => setNewCostCenter(e.target.value)}
                                    placeholder="Ej: Marketing, IT, HR..."
                                    className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-deep/20 focus:border-brand-deep dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
                                    {t("monthlyBudgetLabel")} <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    value={newBudgetUsd}
                                    onChange={(e) => setNewBudgetUsd(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-deep/20 focus:border-brand-deep dark:text-white"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-5 bg-gray-50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800">
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="px-5 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg transition-all"
                            >
                                {t("createBudgetCancel")}
                            </button>
                            <button
                                onClick={handleCreateBudget}
                                disabled={creating || !newCostCenter.trim() || !newBudgetUsd}
                                className="px-5 py-2.5 text-sm font-semibold text-white bg-brand-deep hover:bg-brand-bright rounded-lg transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                            >
                                {creating ? (
                                    <>
                                        <Loader2 className="animate-spin h-4 w-4" />
                                        {t("saveTooltip")}...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-4 h-4" />
                                        {t("createBudgetSave")}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {drawerCostCenter && (
                <ResourceDrawer
                    tenantId={selectedTenant.id}
                    costCenterName={drawerCostCenter}
                    excludedIds={locallyTaggedIds}
                    onClose={() => setDrawerCostCenter(null)}
                    onAssignTags={(resources) => {
                        setBulkTagData({
                            ids: resources.map((r) => r.id),
                            names: resources.map((r) => r.name),
                        });
                        setDrawerCostCenter(null);
                    }}
                    t={t}
                />
            )}

            <BulkTagModal
                isOpen={!!bulkTagData}
                resourceIds={bulkTagData?.ids || []}
                resourceNames={bulkTagData?.names || []}
                onClose={() => setBulkTagData(null)}
                onSuccess={(ids) => {
                    if (ids && ids.length > 0) {
                        setLocallyTaggedIds((prev) => {
                            const next = new Set(prev);
                            ids.forEach((id) => next.add(id));
                            return next;
                        });
                    }
                    setBulkTagData(null);
                    setDrawerCostCenter(null);
                    mutate();
                }}
                t={t}
            />
        </div>
    );
}

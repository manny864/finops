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

/** Drawer lateral con los recursos individuales de un Centro de Costos (o 'Sin asignar'), vía Resource Graph. */
function ResourceDrawer({
    tenantId, costCenterName, onClose, onAssignTags, t,
}: { tenantId: string; costCenterName: string; onClose: () => void; onAssignTags?: (resources: Array<{ id: string; name: string }>) => void; t: ReturnType<typeof useTranslations> }) {
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [resources, setResources] = useState<Array<{ id: string; name: string; type: string; resourceGroup: string }>>([]);

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
                if (!cancelled) setResources(json.resources || []);
            } catch (e: any) {
                if (!cancelled) setError(e.message || t("loadError"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [tenantId, costCenterName, instance, accounts, t]);

    return (
        <div className="fixed inset-0 z-[100] flex items-stretch justify-end bg-black/50" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 h-full w-full max-w-md shadow-2xl overflow-y-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 sticky top-0 z-10">
                    <div className="min-w-0">
                        <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">{costCenterName}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t("drawerSubtitle", { count: resources.length })}</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-5 space-y-2 flex-1">
                    {loading && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-brand-deep" /></div>}
                    {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
                    {!loading && !error && resources.length === 0 && <p className="text-sm text-gray-400">{t("drawerEmpty")}</p>}
                    {!loading && resources.map((r) => (
                        <div key={r.id} className="p-3 rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
                            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{r.name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{r.resourceGroup} · {r.type.split("/").pop()}</p>
                        </div>
                    ))}
                </div>
                {onAssignTags && resources.length > 0 && (
                    <div className="p-5 border-t border-gray-100 dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
                        <button
                            onClick={() => onAssignTags(resources)}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-deep text-white text-sm font-semibold rounded-lg hover:bg-brand-bright transition-colors"
                        >
                            <Tag className="w-4 h-4" /> {t("assignTagsBtn")}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function CostCenterBudgetsBoard() {
    const t = useProviderTranslations("IntelligenceCostCenters");
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    const isAdmin = userRole === "Admin" || userRole === "Owner" || systemRole === "SUPERADMIN";

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
                    onClose={() => setDrawerCostCenter(null)}
                    onAssignTags={isAdmin && drawerCostCenter === UNASSIGNED_NAME ? (resources) => setBulkTagData({ ids: resources.map((r) => r.id), names: resources.map((r) => r.name) }) : undefined}
                    t={t}
                />
            )}

            <BulkTagModal
                isOpen={!!bulkTagData}
                resourceIds={bulkTagData?.ids || []}
                resourceNames={bulkTagData?.names || []}
                onClose={() => setBulkTagData(null)}
                onSuccess={() => { setBulkTagData(null); mutate(); }}
                t={t}
            />
        </div>
    );
}

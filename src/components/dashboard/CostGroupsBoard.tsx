"use client";
import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useLocale } from "next-intl";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import {
    IconCurrencyDollar,
    IconPlus,
    IconDownload,
    IconSparkles,
    IconDotsVertical,
    IconSearch,
    IconInfoCircle,
    IconX,
    IconBuildingBank,
    IconUsers,
    IconTrendingUp,
    IconAlertCircle,
    IconLoader2,
    IconEye,
    IconLayersLinked,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { isMockTenant } from "@/lib/mockData";
import CostGroupDetailModal from "@/components/dashboard/CostGroupDetailModal";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import InfoTooltip from "@/components/InfoTooltip";

type MatchType = "tag" | "name_pattern";

export interface CostGroupItem {
    name: string;
    description: string | null;
    avgDailyCost: number;
    periodCost: number;
    monthlyBilledCost: number;
    budget: number;
    forecast: number;
    owner: string | null;
    createdBy: string | null;
    lastUpdated: string | null;
    subscriptions: number;
    resourceGroups: number;
    resources: number;
    rgNames?: string[];
}

export interface CostGroupRule {
    matchType: MatchType;
    tagKey?: string;
    tagValue?: string;
    rgPattern?: string;
}

export interface CostGroupSummaryKPIs {
    totalCostUsd: number;
    allocatedCostUsd: number;
    unallocatedCostUsd: number;
    allocatedPercent: number;
}

export interface CostGroupLivePreview {
    subscriptions: number;
    resourceGroups: number;
    resources: number;
    monthlyCost: number;
}

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

function fmtDate(iso: string | null | undefined, locale: string) {
    if (!iso) return "—";
    try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)); } catch { return "—"; }
}

function budgetColor(value: number, budget: number): string {
    if (!budget || budget <= 0) return "text-slate-500 dark:text-slate-400";
    const pct = (value / budget) * 100;
    if (pct > 100) return "text-red-600 dark:text-red-400 font-bold";
    if (pct >= 90) return "text-amber-600 dark:text-amber-400 font-bold";
    return "text-emerald-600 dark:text-emerald-400 font-semibold";
}

/* Modal Crear Cost Group con Previsualización en Vivo */
function CreateCostGroupModal({
    tenantId, onClose, onCreated,
}: { tenantId: string; onClose: () => void; onCreated: () => void }) {
    const t = useProviderTranslations("CostGroups");
    const { instance, accounts } = useMsal();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [matchType, setMatchType] = useState<MatchType>("name_pattern");
    const [rgPattern, setRgPattern] = useState("");
    const [tagKey, setTagKey] = useState("");
    const [tagValue, setTagValue] = useState("");
    const [budget, setBudget] = useState("");
    const [ownerUserId, setOwnerUserId] = useState("");
    const [preview, setPreview] = useState<CostGroupLivePreview | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const runPreview = async () => {
        setPreviewLoading(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            const res = await fetch("/api/cost-groups", {
                method: "POST",
                headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    name: (name || "preview").trim(),
                    description: description.trim() || undefined,
                    matchType,
                    previewOnly: true,
                    ...(matchType === "name_pattern" ? { rgPattern: rgPattern.trim() } : { tagKey: tagKey.trim(), tagValue: tagValue.trim() }),
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Error");
            setPreview(json.preview || null);
        } catch {
            setPreview(null);
        } finally {
            setPreviewLoading(false);
        }
    };

    React.useEffect(() => {
        const hasRule = matchType === "name_pattern" ? rgPattern.trim().length > 0 : tagKey.trim().length > 0 && tagValue.trim().length > 0;
        const timer = setTimeout(() => {
            if (hasRule) runPreview(); else setPreview(null);
        }, 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matchType, rgPattern, tagKey, tagValue]);

    const save = async () => {
        if (!name.trim()) { toast.error(t("create_error_name_required")); return; }
        if (matchType === "name_pattern" && !rgPattern.trim()) { toast.error(t("create_error_pattern_required")); return; }
        if (matchType === "tag" && (!tagKey.trim() || !tagValue.trim())) { toast.error(t("create_error_tag_required")); return; }

        setSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            const res = await fetch("/api/cost-groups", {
                method: "POST",
                headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    name: name.trim(),
                    description: description.trim() || undefined,
                    budget: budget.trim() ? Number(budget) : undefined,
                    ownerUserId: ownerUserId.trim() || undefined,
                    matchType,
                    ...(matchType === "name_pattern" ? { rgPattern: rgPattern.trim() } : { tagKey: tagKey.trim(), tagValue: tagValue.trim() }),
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Error");
            toast.success(t("create_success"));
            onCreated();
            onClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("create_error_generic"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg p-6 shadow-2xl border border-slate-200 dark:border-slate-800 z-[10000]" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-slate-800 flex items-center justify-center text-[#0054A6]">
                            <IconLayersLinked className="w-4 h-4" />
                        </div>
                        <div>
                            <h4 className="font-bold text-[16px] text-[#1B2A41] dark:text-white">{t("create_title")}</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t("create_subtitle")}</p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={saving} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
                        <IconX className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex flex-col gap-3.5 mt-4">
                    <div>
                        <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">{t("create_name")} *</label>
                        <input
                            value={name} onChange={(e) => setName(e.target.value)} maxLength={255}
                            placeholder="ej. BU-Engineering, FinOps-Core"
                            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm mt-1 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">{t("create_description")}</label>
                        <input
                            value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000}
                            placeholder="Propósito y alcance del grupo de costos..."
                            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm mt-1 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">{t("create_budget")}</label>
                            <input
                                value={budget}
                                onChange={(e) => setBudget(e.target.value)}
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm mt-1 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">{t("create_owner")}</label>
                            <input
                                value={ownerUserId}
                                onChange={(e) => setOwnerUserId(e.target.value)}
                                placeholder="lider@empresa.com"
                                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm mt-1 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 mb-1.5 block">{t("create_rule_type")}</label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setMatchType("name_pattern")}
                                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${matchType === "name_pattern" ? "bg-white text-[#0054A6] border-[#0054A6] shadow-sm" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50"}`}
                            >
                                {t("create_rule_pattern")}
                            </button>
                            <button
                                type="button"
                                onClick={() => setMatchType("tag")}
                                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${matchType === "tag" ? "bg-white text-[#0054A6] border-[#0054A6] shadow-sm" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50"}`}
                            >
                                {t("create_rule_tag")}
                            </button>
                        </div>
                    </div>

                    {matchType === "name_pattern" ? (
                        <div>
                            <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">{t("create_rg_pattern")} *</label>
                            <input
                                value={rgPattern} onChange={(e) => setRgPattern(e.target.value)}
                                placeholder="rg-prod-%, rg-peopletack-%"
                                className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm mt-1 bg-white dark:bg-slate-800 font-mono text-[#1B2A41] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                            />
                            <p className="text-[11px] text-slate-400 mt-1">{t("create_rg_pattern_hint")}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">{t("create_tag_key")} *</label>
                                <input
                                    value={tagKey} onChange={(e) => setTagKey(e.target.value)} placeholder="CostCenter, Team, Env"
                                    className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm mt-1 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">{t("create_tag_value")} *</label>
                                <input
                                    value={tagValue} onChange={(e) => setTagValue(e.target.value)} placeholder="Engineering, Analytics"
                                    className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm mt-1 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                                />
                            </div>
                        </div>
                    )}

                    {/* Caja de Previsualización en Vivo */}
                    <div className="rounded-xl border border-blue-100 dark:border-slate-700 p-3.5 bg-blue-50/50 dark:bg-slate-800/40">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-xs font-bold text-[#0054A6] dark:text-cyan-400 flex items-center gap-1.5">
                                <IconSparkles className="w-3.5 h-3.5" />
                                {t("create_preview_title")}
                            </p>
                            {previewLoading && <IconLoader2 className="w-3.5 h-3.5 animate-spin text-[#0054A6]" />}
                        </div>
                        {preview ? (
                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300">
                                <div>{t("col_resource_groups")}: <span className="font-bold text-[#1B2A41] dark:text-white">{preview.resourceGroups}</span></div>
                                <div>{t("col_resources")}: <span className="font-bold text-[#1B2A41] dark:text-white">{preview.resources}</span></div>
                                <div>{t("col_subscriptions")}: <span className="font-bold text-[#1B2A41] dark:text-white">{preview.subscriptions}</span></div>
                                <div>{t("col_monthly_billed_cost")}: <span className="font-bold text-[#0054A6] dark:text-cyan-400">{fmtUsd(preview.monthlyCost)}</span></div>
                            </div>
                        ) : (
                            <p className="text-[11px] text-slate-400">{t("create_preview_empty")}</p>
                        )}
                    </div>

                    <div className="flex justify-end gap-2.5 mt-2">
                        <button
                            onClick={onClose}
                            disabled={saving}
                            className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                            {t("create_cancel")}
                        </button>
                        <button
                            onClick={save}
                            disabled={saving}
                            className="px-4 py-2 text-xs font-bold text-[#0054A6] bg-white border border-[#0054A6] rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition-colors"
                        >
                            {saving && <IconLoader2 className="w-3.5 h-3.5 animate-spin" />}
                            {t("create_submit")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* Modal Rápido: Configurar Presupuesto (Budget) */
function SetBudgetModal({
    groupName, currentBudget, tenantId, onClose, onSaved,
}: { groupName: string; currentBudget: number; tenantId: string; onClose: () => void; onSaved: () => void }) {
    const t = useProviderTranslations("CostGroups");
    const { instance, accounts } = useMsal();
    const [budget, setBudget] = useState(currentBudget > 0 ? String(currentBudget) : "");
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            const res = await fetch(`/api/cost-groups/${encodeURIComponent(groupName)}`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, budget: budget ? Number(budget) : 0 }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Error");
            toast.success(t("modal_budget_success"));
            onSaved();
            onClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("create_error_generic"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-slate-200 dark:border-slate-800 z-[10000]" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-slate-800 flex items-center justify-center text-emerald-600">
                        <IconBuildingBank className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="font-bold text-sm text-[#1B2A41] dark:text-white">{t("modal_budget_title")}</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{t("modal_budget_subtitle", { name: groupName })}</p>
                    </div>
                </div>

                <div className="mt-4">
                    <label className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">{t("modal_budget_input")}</label>
                    <div className="relative mt-1">
                        <span className="absolute left-3 top-2.5 text-slate-400 font-bold">$</span>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={budget}
                            onChange={(e) => setBudget(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-7 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-5">
                    <button onClick={onClose} disabled={saving} className="px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50">
                        {t("create_cancel")}
                    </button>
                    <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-white border border-emerald-600 rounded-lg hover:bg-emerald-50 flex items-center gap-1.5">
                        {saving && <IconLoader2 className="w-3.5 h-3.5 animate-spin" />}
                        {t("modal_budget_save")}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function CostGroupsBoard() {
    const t = useProviderTranslations("CostGroups");
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [period, setPeriod] = useState("30d");
    const [groupFilter, setGroupFilter] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [openGroup, setOpenGroup] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [budgetModalGroup, setBudgetModalGroup] = useState<{ name: string; budget: number } | null>(null);
    const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.details || j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/cost-groups?tenantId=${selectedTenant.id}&period=${period}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const groups: CostGroupItem[] = useMemo(() => data?.groups || [], [data]);
    const summary: CostGroupSummaryKPIs | null = data?.summary || null;
    const suggestions: Array<{ pattern: string; matchType: "name_pattern"; estimatedResourceGroups: number; estimatedCostUsd: number }> = data?.suggestions || [];

    const filtered = useMemo(() => {
        let list = groupFilter === "all" ? groups : groups.filter(g => g.name === groupFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(g => g.name.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q)) || (g.owner && g.owner.toLowerCase().includes(q)));
        }
        return list;
    }, [groups, groupFilter, searchQuery]);

    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filtered, 15);

    const kpis = useMemo(() => {
        const totalCost = groups.reduce((s, g) => s + (g.periodCost || 0), 0);
        const avgDaily = groups.reduce((s, g) => s + (g.avgDailyCost || 0), 0);
        const avgPerGroup = groups.length > 0 ? totalCost / groups.length : 0;
        const withBudget = groups.filter(g => (g.budget || 0) > 0).length;
        return { avgDaily, totalCost, avgPerGroup, count: groups.length, withBudget };
    }, [groups]);

    const untaggedGroup = useMemo(() => groups.find(g => g.name === "Untagged"), [groups]);
    const untaggedShareHigh = summary && summary.totalCostUsd > 0 && summary.unallocatedCostUsd / summary.totalCostUsd > 0.5;

    const [creatingSuggestions, setCreatingSuggestions] = useState(false);

    const autoGenerateCostGroups = async () => {
        if (!selectedTenant || suggestions.length === 0) return;
        setCreatingSuggestions(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            for (const s of suggestions) {
                await fetch("/api/cost-groups", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        tenantId: selectedTenant.id,
                        name: s.pattern.replace(/-%$/, ""),
                        matchType: "name_pattern",
                        rgPattern: s.pattern,
                    }),
                });
            }
            toast.success(t("suggestions_created_success", { count: suggestions.length }));
            mutate();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("create_error_generic"));
        } finally {
            setCreatingSuggestions(false);
        }
    };

    /* Exportación Showback a CSV */
    const exportShowbackReport = () => {
        if (!groups.length) return;
        const headers = ["Cost Group", "Daily Avg (USD)", "Period Cost (USD)", "Monthly Billed (USD)", "Budget (USD)", "Forecast (USD)", "Owner", "Subscriptions", "Resource Groups", "Resources", "Last Updated"];
        const rows = groups.map(g => [
            `"${g.name.replace(/"/g, '""')}"`,
            g.avgDailyCost.toFixed(2),
            g.periodCost.toFixed(2),
            g.monthlyBilledCost.toFixed(2),
            g.budget.toFixed(2),
            g.forecast.toFixed(2),
            `"${(g.owner || '').replace(/"/g, '""')}"`,
            g.subscriptions,
            g.resourceGroups,
            g.resources,
            `"${g.lastUpdated || ''}"`,
        ]);
        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Showback-CostGroups-${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success(t("exportSuccess", { fallback: "Reporte Showback descargado correctamente." }));
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div className="space-y-6">
            {/* Header y Filtros */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                        <span>{t("title")}</span>
                        <InfoTooltip content={t("subtitle")} position="bottom" align="left" />
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{t("subtitle")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                    <div className="relative">
                        <IconSearch className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                            placeholder={t("search_placeholder")}
                            className="pl-9 pr-3 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#0054A6]"
                        />
                    </div>
                    <select
                        value={groupFilter}
                        onChange={(e) => { setGroupFilter(e.target.value); setPage(1); }}
                        className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 rounded-lg px-3 py-1.5 text-xs font-bold"
                    >
                        <option value="all">{t("all_cost_groups")}</option>
                        {groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                    </select>
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 rounded-lg px-3 py-1.5 text-xs font-bold"
                    >
                        <option value="30d">{t("period_30d")}</option>
                        <option value="90d">{t("period_90d")}</option>
                        <option value="fy">{t("period_fy")}</option>
                    </select>
                    <button
                        onClick={() => setCreating(true)}
                        className="px-3.5 py-1.5 bg-white text-[#0054A6] border border-[#0054A6] rounded-lg text-xs font-bold hover:bg-blue-50 dark:hover:bg-blue-950/30 flex items-center gap-1.5 shrink-0 shadow-sm transition-colors"
                    >
                        <IconPlus className="w-3.5 h-3.5" /> {t("create_group_btn")}
                    </button>
                    <button
                        onClick={exportShowbackReport}
                        className="px-3.5 py-1.5 bg-white text-emerald-700 border border-emerald-600 rounded-lg text-xs font-bold hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center gap-1.5 shrink-0 shadow-sm transition-colors"
                    >
                        <IconDownload className="w-3.5 h-3.5" /> {t("opp_showback_btn")}
                    </button>
                </div>
            </div>

            {isLoading && (
                <div className="flex flex-col items-center justify-center py-20">
                    <IconLoader2 className="w-8 h-8 animate-spin text-[#0054A6] mb-4" />
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">{t("loading")}</p>
                </div>
            )}

            {error && (
                parseTierRequiredError(error.message) ? (
                    <TierLockedNotice requiredTier={parseTierRequiredError(error.message)!} currentTier={(selectedTenant as any)?.tier} featureName={t('tier_locked_feature_name')} />
                ) : (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-100 dark:border-red-900/50">
                        <h3 className="font-bold flex items-center gap-2 text-sm"><IconAlertCircle className="w-4 h-4" /> Error</h3>
                        <p className="text-xs">{error.message}</p>
                    </div>
                )
            )}

            {!isLoading && !error && data && (
                <>
                    {/* 4 KPIs Superiores Conciliados */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        {/* KPI 1: Costo Diario Promedio */}
                        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center shrink-0 text-[#0054A6]">
                                <IconCurrencyDollar className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("avg_daily_cost")}</p>
                                <p className="text-xl font-extrabold text-[#1B2A41] dark:text-white">{fmtUsd(kpis.avgDaily)} <span className="text-xs font-semibold text-slate-400">/ día</span></p>
                                <p className="text-[11px] text-emerald-600 font-semibold mt-0.5 flex items-center gap-1">
                                    <IconTrendingUp className="w-3 h-3" /> Ritmo de gasto normalizado
                                </p>
                            </div>
                        </div>

                        {/* KPI 2: Costo Total del Período con Barra de Asignación */}
                        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center shrink-0 text-[#0054A6]">
                                <IconLayersLinked className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("total_cost_period")}</p>
                                <p className="text-xl font-extrabold text-[#1B2A41] dark:text-white">{fmtUsd(kpis.totalCost)}</p>
                                {summary && (
                                    <div className="mt-1">
                                        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden flex">
                                            <div className="bg-[#0054A6] h-full" style={{ width: `${summary.allocatedPercent}%` }} />
                                            <div className="bg-amber-400 h-full" style={{ width: `${100 - summary.allocatedPercent}%` }} />
                                        </div>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                                            {t("kpi_allocation_subtitle", { allocated: summary.allocatedPercent, unallocated: Number((100 - summary.allocatedPercent).toFixed(1)) })}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* KPI 3: Costo Promedio por Grupo */}
                        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center shrink-0 text-[#0054A6]">
                                <IconBuildingBank className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("avg_cost_per_group")}</p>
                                <p className="text-xl font-extrabold text-[#1B2A41] dark:text-white">{fmtUsd(kpis.avgPerGroup)} <span className="text-xs font-semibold text-slate-400">/ grupo</span></p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t("avg_cost_per_group_subtitle")}</p>
                            </div>
                        </div>

                        {/* KPI 4: Total de Cost Groups Activos */}
                        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center shrink-0 text-[#0054A6]">
                                <IconUsers className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("cost_groups_count")}</p>
                                <p className="text-xl font-extrabold text-[#1B2A41] dark:text-white">{kpis.count} <span className="text-xs font-semibold text-slate-400">Activo(s)</span></p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t("cost_groups_count_subtitle", { count: kpis.withBudget })}</p>
                            </div>
                        </div>
                    </div>

                    {/* Banner de Oportunidades y Remediación en 1 Clic */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                            <IconSparkles className="w-4 h-4 text-[#0054A6]" />
                            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1B2A41] dark:text-white">{t("opp_banner_title")}</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {/* Oportunidad 1: Untagged */}
                            <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 flex flex-col justify-between">
                                <div>
                                    <p className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                                        <IconAlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                        {t("opp_unallocated_title", { cost: fmtUsd(summary?.unallocatedCostUsd || untaggedGroup?.periodCost || 0) })}
                                    </p>
                                    <p className="text-[11px] text-amber-800 dark:text-amber-400 mt-1">
                                        {t("opp_unallocated_desc", { count: untaggedGroup?.resourceGroups || 9 })}
                                    </p>
                                </div>
                                <button
                                    onClick={autoGenerateCostGroups}
                                    disabled={creatingSuggestions || suggestions.length === 0}
                                    className="mt-3 w-full py-1.5 px-3 bg-white text-[#0054A6] border border-[#0054A6] rounded-lg text-xs font-bold hover:bg-blue-50 dark:hover:bg-slate-800 shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                                >
                                    {creatingSuggestions && <IconLoader2 className="w-3 h-3 animate-spin" />}
                                    <IconSparkles className="w-3.5 h-3.5" />
                                    {t("opp_unallocated_btn")}
                                </button>
                            </div>

                            {/* Oportunidad 2: Presupuesto */}
                            <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/40 dark:bg-blue-950/20 flex flex-col justify-between">
                                <div>
                                    <p className="text-xs font-bold text-[#0054A6] dark:text-cyan-300 flex items-center gap-1.5">
                                        <IconBuildingBank className="w-3.5 h-3.5 text-[#0054A6] shrink-0" />
                                        {t("opp_no_budget_title")}
                                    </p>
                                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                                        {t("opp_no_budget_desc")}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setBudgetModalGroup({ name: groups[0]?.name || "Untagged", budget: groups[0]?.budget || 0 })}
                                    className="mt-3 w-full py-1.5 px-3 bg-white text-[#0054A6] border border-[#0054A6] rounded-lg text-xs font-bold hover:bg-blue-50 dark:hover:bg-slate-800 shadow-sm flex items-center justify-center gap-1.5 transition-colors"
                                >
                                    <IconBuildingBank className="w-3.5 h-3.5" />
                                    {t("opp_no_budget_btn")}
                                </button>
                            </div>

                            {/* Oportunidad 3: Showback */}
                            <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20 flex flex-col justify-between">
                                <div>
                                    <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                                        <IconDownload className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                        {t("opp_showback_title")}
                                    </p>
                                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                                        {t("opp_showback_desc")}
                                    </p>
                                </div>
                                <button
                                    onClick={exportShowbackReport}
                                    className="mt-3 w-full py-1.5 px-3 bg-white text-emerald-700 border border-emerald-600 rounded-lg text-xs font-bold hover:bg-emerald-50 dark:hover:bg-slate-800 shadow-sm flex items-center justify-center gap-1.5 transition-colors"
                                >
                                    <IconDownload className="w-3.5 h-3.5" />
                                    {t("opp_showback_btn")}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Tabla de Cost Groups */}
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200">{t("col_name")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-right">{t("col_avg_daily_cost")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-right">{t("col_period_cost")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200">{t("col_description")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-right">{t("col_monthly_billed_cost")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-right">{t("col_budget")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-right">{t("col_forecast")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200">{t("col_owner")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200">{t("col_last_updated")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-right">{t("col_subscriptions")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-right">{t("col_resource_groups")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-right">{t("col_resources")}</th>
                                        <th className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200 text-center">{t("col_actions")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {paged.map((g: CostGroupItem) => {
                                        const budgetPct = g.budget > 0 ? Math.min(100, Math.round((g.monthlyBilledCost / g.budget) * 100)) : 0;
                                        return (
                                            <tr
                                                key={g.name}
                                                className="hover:bg-blue-50/40 dark:hover:bg-slate-800/50 transition-colors"
                                            >
                                                <td
                                                    onClick={() => setOpenGroup(g.name)}
                                                    className="px-4 py-3 font-bold text-[#1B2A41] dark:text-white whitespace-nowrap cursor-pointer"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span>{g.name}</span>
                                                        {g.name === "Untagged" && untaggedShareHigh && (
                                                            <span className="rounded-full bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                                                {t("untagged_high_share_badge", { percent: Number((100 - (summary?.allocatedPercent || 0)).toFixed(1)) })}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-right text-slate-700 dark:text-slate-200 font-semibold cursor-pointer">{fmtUsd(g.avgDailyCost)}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-right text-slate-700 dark:text-slate-200 font-semibold cursor-pointer">{fmtUsd(g.periodCost)}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-slate-500 dark:text-slate-400 max-w-[200px] truncate cursor-pointer">{g.description || "—"}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className={`px-4 py-3 text-right ${budgetColor(g.monthlyBilledCost, g.budget)} cursor-pointer`}>{fmtUsd(g.monthlyBilledCost)}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-right cursor-pointer">
                                                    {g.budget > 0 ? (
                                                        <div className="flex flex-col items-end">
                                                            <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtUsd(g.budget)}</span>
                                                            <div className="w-16 bg-slate-100 dark:bg-slate-800 h-1 rounded-full mt-1 overflow-hidden">
                                                                <div
                                                                    className={`h-full ${budgetPct > 100 ? "bg-red-500" : budgetPct > 90 ? "bg-amber-500" : "bg-emerald-500"}`}
                                                                    style={{ width: `${budgetPct}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-400">—</span>
                                                    )}
                                                </td>
                                                <td onClick={() => setOpenGroup(g.name)} className={`px-4 py-3 text-right ${budgetColor(g.forecast, g.budget)} cursor-pointer`}>{fmtUsd(g.forecast)}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer">{g.owner || "—"}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap cursor-pointer">{fmtDate(g.lastUpdated, locale)}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-right text-slate-700 dark:text-slate-200 cursor-pointer">{g.subscriptions}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-right text-slate-700 dark:text-slate-200 font-bold cursor-pointer">{g.resourceGroups}</td>
                                                <td onClick={() => setOpenGroup(g.name)} className="px-4 py-3 text-right text-[#0054A6] dark:text-cyan-400 font-bold cursor-pointer">{g.resources}</td>
                                                <td className="px-4 py-3 text-center relative">
                                                    <div className="inline-block text-left">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setActiveActionMenu(activeActionMenu === g.name ? null : g.name);
                                                            }}
                                                            className="p-1.5 text-slate-500 hover:text-[#0054A6] hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                                        >
                                                            <IconDotsVertical className="w-4 h-4" />
                                                        </button>
                                                        {activeActionMenu === g.name && (
                                                            <div
                                                                className="absolute right-4 mt-1 w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 py-1.5 text-left"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <button
                                                                    onClick={() => { setOpenGroup(g.name); setActiveActionMenu(null); }}
                                                                    className="w-full px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 font-semibold"
                                                                >
                                                                    <IconEye className="w-3.5 h-3.5 text-[#0054A6]" />
                                                                    {t("action_view_detail")}
                                                                </button>
                                                                <button
                                                                    onClick={() => { setBudgetModalGroup({ name: g.name, budget: g.budget }); setActiveActionMenu(null); }}
                                                                    className="w-full px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 font-semibold"
                                                                >
                                                                    <IconBuildingBank className="w-3.5 h-3.5 text-emerald-600" />
                                                                    {t("action_set_budget")}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {paged.length === 0 && (
                                        <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">{t("empty")}</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800">
                            <Pagination
                                page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}
                                total={total} totalPages={totalPages}
                                labels={{ showing: t("showing"), of: t("of"), perPage: t("per_page"), prev: t("prev"), next: t("next"), page: t("page") }}
                            />
                        </div>
                    </div>

                    <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                        <IconInfoCircle className="w-3.5 h-3.5" /> {t("drill_through_hint")}
                    </p>
                </>
            )}

            {/* Modal de Detalle / Drawer */}
            {openGroup && (
                <CostGroupDetailModal
                    name={openGroup}
                    tenantId={selectedTenant.id}
                    onClose={() => setOpenGroup(null)}
                    onUpdated={() => mutate()}
                />
            )}

            {/* Modal Crear Cost Group */}
            {creating && (
                <CreateCostGroupModal
                    tenantId={selectedTenant.id}
                    onClose={() => setCreating(false)}
                    onCreated={() => mutate()}
                />
            )}

            {/* Modal Configurar Presupuesto */}
            {budgetModalGroup && (
                <SetBudgetModal
                    groupName={budgetModalGroup.name}
                    currentBudget={budgetModalGroup.budget}
                    tenantId={selectedTenant.id}
                    onClose={() => setBudgetModalGroup(null)}
                    onSaved={() => mutate()}
                />
            )}
        </div>
    );
}


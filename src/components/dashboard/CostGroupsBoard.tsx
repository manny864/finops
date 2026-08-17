"use client";
import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations, useLocale } from "next-intl";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import { Loader2, AlertCircle, DollarSign, MousePointerClick, Plus } from "lucide-react";
import { toast } from "sonner";
import { isMockTenant } from "@/lib/mockData";
import CostGroupDetailModal from "@/components/dashboard/CostGroupDetailModal";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

type MatchType = "tag" | "name_pattern";

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
    const [preview, setPreview] = useState<{ subscriptions: number; resourceGroups: number; resources: number; monthlyCost: number } | null>(null);
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
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("create_error_generic"));
            setPreview(null);
        } finally {
            setPreviewLoading(false);
        }
    };

    // Previsualización en vivo: recalcula al tipear el patrón/tag (debounced),
    // sin que el usuario tenga que apretar el botón manualmente cada vez.
    React.useEffect(() => {
        const hasRule = matchType === "name_pattern" ? rgPattern.trim().length > 0 : tagKey.trim().length > 0 && tagValue.trim().length > 0;
        const timer = setTimeout(() => {
            if (hasRule) runPreview(); else setPreview(null);
        }, 500);
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
        <div className="fixed inset-0 bg-black/40 z-[10000] grid place-items-center p-4" onClick={() => !saving && onClose()}>
            <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h4 className="font-bold text-[15px] text-gray-900 dark:text-white mb-1">{t("create_title")}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t("create_subtitle")}</p>

                <div className="flex flex-col gap-3">
                    <div>
                        <label className="text-xs font-semibold text-gray-500">{t("create_name")}</label>
                        <input
                            value={name} onChange={(e) => setName(e.target.value)} maxLength={255}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-gray-500">{t("create_description")}</label>
                        <input
                            value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-semibold text-gray-500">{t("create_budget")}</label>
                            <input
                                value={budget}
                                onChange={(e) => setBudget(e.target.value)}
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-gray-500">{t("create_owner")}</label>
                            <input
                                value={ownerUserId}
                                onChange={(e) => setOwnerUserId(e.target.value)}
                                placeholder={t("create_owner_placeholder")}
                                className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-gray-500 mb-1.5 block">{t("create_rule_type")}</label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setMatchType("name_pattern")}
                                className={`flex-1 px-3 py-2 rounded-md text-xs font-bold border transition-colors ${matchType === "name_pattern" ? "bg-brand-deep text-white border-brand-deep" : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300"}`}
                            >
                                {t("create_rule_pattern")}
                            </button>
                            <button
                                type="button"
                                onClick={() => setMatchType("tag")}
                                className={`flex-1 px-3 py-2 rounded-md text-xs font-bold border transition-colors ${matchType === "tag" ? "bg-brand-deep text-white border-brand-deep" : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300"}`}
                            >
                                {t("create_rule_tag")}
                            </button>
                        </div>
                    </div>

                    {matchType === "name_pattern" ? (
                        <div>
                            <label className="text-xs font-semibold text-gray-500">{t("create_rg_pattern")}</label>
                            <input
                                value={rgPattern} onChange={(e) => setRgPattern(e.target.value)}
                                placeholder="rg-prod-%"
                                className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent font-mono"
                            />
                            <p className="text-[11px] text-gray-400 mt-1">{t("create_rg_pattern_hint")}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-semibold text-gray-500">{t("create_tag_key")}</label>
                                <input
                                    value={tagKey} onChange={(e) => setTagKey(e.target.value)} placeholder="Team"
                                    className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-gray-500">{t("create_tag_value")}</label>
                                <input
                                    value={tagValue} onChange={(e) => setTagValue(e.target.value)} placeholder="platform"
                                    className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                                />
                            </div>
                        </div>
                    )}

                    <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 bg-gray-50/70 dark:bg-slate-800/40">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("create_preview_title")}</p>
                            <button
                                type="button"
                                onClick={runPreview}
                                disabled={previewLoading || saving}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold border border-[#0054A6] text-[#0054A6] bg-white hover:bg-blue-50 disabled:opacity-50"
                            >
                                {previewLoading ? t("create_preview_loading") : t("create_preview_btn")}
                            </button>
                        </div>
                        {preview ? (
                            <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                                <div>{t("col_subscriptions")}: <span className="font-bold">{preview.subscriptions}</span></div>
                                <div>{t("col_resource_groups")}: <span className="font-bold">{preview.resourceGroups}</span></div>
                                <div>{t("col_resources")}: <span className="font-bold">{preview.resources}</span></div>
                                <div>{t("col_monthly_billed_cost")}: <span className="font-bold">{fmtUsd(preview.monthlyCost)}</span></div>
                            </div>
                        ) : (
                            <p className="text-[11px] text-gray-400">{t("create_preview_empty")}</p>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 mt-2">
                        <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                            {t("create_cancel")}
                        </button>
                        <button onClick={save} disabled={saving} className="px-4 py-2 bg-brand-deep text-white rounded-md text-sm font-bold flex items-center gap-2 disabled:opacity-50 hover:brightness-110">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("create_submit")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

function fmtDate(iso: string | null | undefined, locale: string) {
    if (!iso) return "—";
    try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)); } catch { return "—"; }
}

function budgetColor(value: number, budget: number): string {
    if (!budget || budget <= 0) return "text-gray-500 dark:text-gray-400";
    const pct = (value / budget) * 100;
    if (pct > 100) return "text-red-600 dark:text-red-400 font-bold";
    if (pct >= 90) return "text-amber-600 dark:text-amber-400 font-bold";
    return "text-emerald-600 dark:text-emerald-400 font-semibold";
}

function Kpi({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
    return (
        <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-soft/60 dark:bg-slate-800 flex items-center justify-center shrink-0">
                <DollarSign className="w-4.5 h-4.5 text-brand-deep dark:text-brand-bright" />
            </div>
            <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{label}</p>
                <p className="text-lg font-extrabold text-gray-900 dark:text-white">{value}</p>
                {subtitle && <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{subtitle}</p>}
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
    const [openGroup, setOpenGroup] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

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

    const groups: any[] = useMemo(() => data?.groups || [], [data]);
    const summary: { totalCostUsd: number; allocatedCostUsd: number; unallocatedCostUsd: number; allocatedPercent: number } | null = data?.summary || null;
    const suggestions: Array<{ pattern: string; matchType: "name_pattern"; estimatedResourceGroups: number; estimatedCostUsd: number }> = data?.suggestions || [];
    const filtered = useMemo(
        () => (groupFilter === "all" ? groups : groups.filter(g => g.name === groupFilter)),
        [groups, groupFilter]
    );
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filtered, 10);

    const kpis = useMemo(() => {
        const totalCost = groups.reduce((s, g) => s + (g.periodCost || 0), 0);
        const avgDaily = groups.reduce((s, g) => s + (g.avgDailyCost || 0), 0);
        const avgPeriod = groups.length > 0 ? totalCost / groups.length : 0;
        const withBudget = groups.filter(g => (g.budget || 0) > 0).length;
        return { avgDaily, totalCost, avgPeriod, count: groups.length, withBudget };
    }, [groups]);

    const untaggedShareHigh = summary && summary.totalCostUsd > 0 && summary.unallocatedCostUsd / summary.totalCostUsd > 0.5;

    const [creatingSuggestions, setCreatingSuggestions] = useState(false);
    const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

    const applySuggestions = async () => {
        if (!selectedTenant || selectedSuggestions.size === 0) return;
        setCreatingSuggestions(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            const picks = suggestions.filter(s => selectedSuggestions.has(s.pattern));
            for (const s of picks) {
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
            toast.success(t("suggestions_created_success", { count: picks.length }));
            setSelectedSuggestions(new Set());
            mutate();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("create_error_generic"));
        } finally {
            setCreatingSuggestions(false);
        }
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t("title")}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t("subtitle")}</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={groupFilter}
                        onChange={(e) => { setGroupFilter(e.target.value); setPage(1); }}
                        className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm font-semibold"
                    >
                        <option value="all">{t("all_cost_groups")}</option>
                        {groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                    </select>
                    <select
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm font-semibold"
                    >
                        <option value="30d">{t("period_30d")}</option>
                        <option value="90d">{t("period_90d")}</option>
                        <option value="fy">{t("period_fy")}</option>
                    </select>
                    <button
                        onClick={() => setCreating(true)}
                        className="px-3 py-2 bg-brand-deep text-white rounded-lg text-sm font-bold hover:brightness-110 flex items-center gap-1.5 shrink-0"
                    >
                        <Plus className="w-3.5 h-3.5" /> {t("create_group_btn")}
                    </button>
                </div>
            </div>

            {isLoading && (
                <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
                </div>
            )}

            {error && (
                parseTierRequiredError(error.message) ? (
                    <TierLockedNotice requiredTier={parseTierRequiredError(error.message)!} currentTier={(selectedTenant as any)?.tier} featureName={t('tier_locked_feature_name')} />
                ) : (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                        <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                        <p className="text-sm">{error.message}</p>
                    </div>
                )
            )}

            {!isLoading && !error && data && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        <Kpi label={t("avg_daily_cost")} value={fmtUsd(kpis.avgDaily)} />
                        <Kpi
                            label={t("total_cost_period")}
                            value={fmtUsd(kpis.totalCost)}
                            subtitle={summary ? t("kpi_allocation_subtitle", { allocated: summary.allocatedPercent, unallocated: Math.round((100 - summary.allocatedPercent) * 10) / 10 }) : undefined}
                        />
                        <Kpi label={t("avg_cost_per_group")} value={fmtUsd(kpis.avgPeriod)} subtitle={t("avg_cost_per_group_subtitle")} />
                        <Kpi label={t("cost_groups_count")} value={String(kpis.count)} subtitle={t("cost_groups_count_subtitle", { count: kpis.withBudget })} />
                    </div>

                    {untaggedShareHigh && suggestions.length > 0 && (
                        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex items-start gap-2.5">
                                    <AlertCircle className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-bold text-amber-800 dark:text-amber-300">{t("suggestions_banner_title")}</p>
                                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                                            {t("suggestions_banner_subtitle", { count: suggestions.length })}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={applySuggestions}
                                    disabled={creatingSuggestions || selectedSuggestions.size === 0}
                                    className="px-3 py-1.5 rounded-md text-xs font-bold border border-amber-600 text-amber-700 dark:text-amber-300 bg-white dark:bg-slate-900 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                                >
                                    {creatingSuggestions && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    {t("suggestions_create_btn", { count: selectedSuggestions.size })}
                                </button>
                            </div>
                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {suggestions.map(s => (
                                    <label key={s.pattern} className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-white dark:bg-slate-900 px-3 py-2 text-xs cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedSuggestions.has(s.pattern)}
                                            onChange={(e) => {
                                                setSelectedSuggestions(prev => {
                                                    const next = new Set(prev);
                                                    if (e.target.checked) next.add(s.pattern); else next.delete(s.pattern);
                                                    return next;
                                                });
                                            }}
                                        />
                                        <span className="font-mono font-semibold text-gray-800 dark:text-gray-100">{s.pattern}</span>
                                        <span className="text-gray-400">·</span>
                                        <span className="text-gray-500 dark:text-gray-400">{s.estimatedResourceGroups} RGs</span>
                                        <span className="text-gray-400">·</span>
                                        <span className="text-gray-500 dark:text-gray-400">{fmtUsd(s.estimatedCostUsd)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        <th className="px-4 py-3 font-semibold">{t("col_name")}</th>
                                        <th className="px-4 py-3 font-semibold text-right">{t("col_avg_daily_cost")}</th>
                                        <th className="px-4 py-3 font-semibold text-right">{t("col_period_cost")}</th>
                                        <th className="px-4 py-3 font-semibold">{t("col_description")}</th>
                                        <th className="px-4 py-3 font-semibold text-right">{t("col_monthly_billed_cost")}</th>
                                        <th className="px-4 py-3 font-semibold text-right">{t("col_budget")}</th>
                                        <th className="px-4 py-3 font-semibold text-right">{t("col_forecast")}</th>
                                        <th className="px-4 py-3 font-semibold">{t("col_owner")}</th>
                                        <th className="px-4 py-3 font-semibold">{t("col_last_updated")}</th>
                                        <th className="px-4 py-3 font-semibold text-right">{t("col_subscriptions")}</th>
                                        <th className="px-4 py-3 font-semibold text-right">{t("col_resource_groups")}</th>
                                        <th className="px-4 py-3 font-semibold text-right">{t("col_resources")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                    {paged.map((g: any) => (
                                        <tr
                                            key={g.name}
                                            onClick={() => setOpenGroup(g.name)}
                                            className="cursor-pointer hover:bg-brand-soft/40 dark:hover:bg-slate-800/50 transition-colors"
                                        >
                                            <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    <span>{g.name}</span>
                                                    {g.name === "Untagged" && untaggedShareHigh && (
                                                        <span className="rounded bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                                            {t("untagged_high_share_badge", { percent: Math.round((100 - (summary?.allocatedPercent || 0)) * 10) / 10 })}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{fmtUsd(g.avgDailyCost)}</td>
                                            <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{fmtUsd(g.periodCost)}</td>
                                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-[220px] truncate">{g.description || "—"}</td>
                                            <td className={`px-4 py-3 text-right ${budgetColor(g.monthlyBilledCost, g.budget)}`}>{fmtUsd(g.monthlyBilledCost)}</td>
                                            <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{g.budget > 0 ? fmtUsd(g.budget) : "—"}</td>
                                            <td className={`px-4 py-3 text-right ${budgetColor(g.forecast, g.budget)}`}>{fmtUsd(g.forecast)}</td>
                                            <td className="px-4 py-3 text-gray-700 dark:text-gray-200 whitespace-nowrap">{g.owner || "—"}</td>
                                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(g.lastUpdated, locale)}</td>
                                            <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{g.subscriptions}</td>
                                            <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{g.resourceGroups}</td>
                                            <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{g.resources}</td>
                                        </tr>
                                    ))}
                                    {paged.length === 0 && (
                                        <tr><td colSpan={12} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">{t("empty")}</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-4 pb-4">
                            <Pagination
                                page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}
                                total={total} totalPages={totalPages}
                                labels={{ showing: t("showing"), of: t("of"), perPage: t("per_page"), prev: t("prev"), next: t("next"), page: t("page") }}
                            />
                        </div>
                    </div>

                    <p className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                        <MousePointerClick className="w-3.5 h-3.5" /> {t("drill_through_hint")}
                    </p>
                </>
            )}

            {openGroup && (
                <CostGroupDetailModal
                    name={openGroup}
                    tenantId={selectedTenant.id}
                    onClose={() => setOpenGroup(null)}
                    onUpdated={() => mutate()}
                />
            )}

            {creating && (
                <CreateCostGroupModal
                    tenantId={selectedTenant.id}
                    onClose={() => setCreating(false)}
                    onCreated={() => mutate()}
                />
            )}
        </div>
    );
}

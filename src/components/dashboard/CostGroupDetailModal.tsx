"use client";
import React, { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useMsal } from "@azure/msal-react";
import { useLocale } from "next-intl";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import {
    X, Loader2, AlertCircle, DollarSign, Users, Lightbulb, Boxes, ShieldAlert,
    ChevronRight, TrendingUp, TrendingDown, ScrollText, Info, Plus, Trash2, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ComposedChart, Line,
    ReferenceLine, CartesianGrid, PieChart, Pie, Cell, LineChart, Legend,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getRegionCoords } from "@/lib/azureRegionCoords";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const PIE_COLORS = ["#0054A6", "#F2A900", "#10B981", "#EF4444", "#8B5CF6", "#F43F5E", "#0EA5E9"];

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

function fmtDate(iso: string | null | undefined, locale: string) {
    if (!iso) return "—";
    try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)); } catch { return "—"; }
}

const TABS = ["current_fy", "costs", "actions", "resources", "governance"] as const;
type Tab = typeof TABS[number];

function Card({ title, className = "", children }: { title?: string; className?: string; children: React.ReactNode }) {
    return (
        <div className={`bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col ${className}`}>
            {title && <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">{title}</h3>}
            {children}
        </div>
    );
}

function KpiTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="p-3 rounded-lg border border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                {icon}
            </div>
            <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{label}</p>
                <p className="text-base font-extrabold text-gray-900 dark:text-white truncate">{value}</p>
            </div>
        </div>
    );
}

function LocationsMap({ locations }: { locations: Array<{ region: string; resources: number }> }) {
    const width = 320, height = 160;
    const points = locations
        .map(l => ({ ...l, coords: getRegionCoords(l.region) }))
        .filter(l => l.coords) as Array<{ region: string; resources: number; coords: { lat: number; lng: number; label: string } }>;
    const max = Math.max(1, ...points.map(p => p.resources));

    return (
        <div className="relative w-full rounded-lg bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-800/60 dark:to-slate-900 border border-gray-200 dark:border-slate-800 overflow-hidden" style={{ height }}>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
                {Array.from({ length: 5 }).map((_, i) => (
                    <line key={`v${i}`} x1={(width / 4) * i} y1={0} x2={(width / 4) * i} y2={height} stroke="currentColor" className="text-gray-200 dark:text-slate-700" strokeWidth={0.5} />
                ))}
                {Array.from({ length: 3 }).map((_, i) => (
                    <line key={`h${i}`} x1={0} y1={(height / 2) * i} x2={width} y2={(height / 2) * i} stroke="currentColor" className="text-gray-200 dark:text-slate-700" strokeWidth={0.5} />
                ))}
                {points.map(p => {
                    const x = ((p.coords.lng + 180) / 360) * width;
                    const y = ((90 - p.coords.lat) / 180) * height;
                    const r = 4 + (p.resources / max) * 10;
                    return (
                        <g key={p.region}>
                            <circle cx={x} cy={y} r={r} className="fill-brand-deep/70 dark:fill-brand-bright/70" />
                            <text x={x} y={y - r - 4} textAnchor="middle" className="fill-gray-600 dark:fill-gray-300" fontSize={9} fontWeight={600}>
                                {p.coords.label} ({p.resources})
                            </text>
                        </g>
                    );
                })}
                {points.length === 0 && (
                    <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-gray-400" fontSize={11}>—</text>
                )}
            </svg>
        </div>
    );
}

function MiniPie({ data, donut = false }: { data: Array<{ name: string; cost: number }>; donut?: boolean }) {
    const total = data.reduce((s, d) => s + d.cost, 0);
    if (!data.length) return <div className="flex items-center justify-center h-40 text-gray-400 text-xs">—</div>;
    return (
        <>
            <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                    <Pie data={data} dataKey="cost" nameKey="name" cx="50%" cy="50%" innerRadius={donut ? 34 : 0} outerRadius={58} paddingAngle={2} stroke="none">
                        {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [fmtUsd(Number(v)), n]} />
                </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                {data.map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span className="truncate text-gray-600 dark:text-gray-300">{d.name}</span>
                        </div>
                        <span className="font-semibold text-gray-800 dark:text-gray-100 shrink-0">{total > 0 ? Math.round((d.cost / total) * 100) : 0}%</span>
                    </div>
                ))}
            </div>
        </>
    );
}

function TrendBadge({ pct }: { pct: number }) {
    const up = pct > 0;
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-bold ${up ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(pct)}%
        </span>
    );
}

function ManualResourceGroupsPanel({
    groupName, tenantId, matchedResourceGroups, onChanged,
}: { groupName: string; tenantId: string; matchedResourceGroups: string[]; onChanged: () => void }) {
    const t = useProviderTranslations("CostGroups");
    const { instance, accounts } = useMsal();
    const [newRg, setNewRg] = useState("");
    const [saving, setSaving] = useState(false);

    const authHeaders = async () => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        return { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" };
    };

    const addRg = async () => {
        if (!newRg.trim()) return;
        setSaving(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/cost-groups/${encodeURIComponent(groupName)}/resource-groups`, {
                method: "POST",
                headers,
                body: JSON.stringify({ tenantId, resourceGroup: newRg.trim() }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("error"));
            toast.success(t("assign_rg_success"));
            setNewRg("");
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("assign_rg_error"));
        } finally {
            setSaving(false);
        }
    };

    const removeRg = async (rg: string) => {
        setSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            const res = await fetch(
                `/api/cost-groups/${encodeURIComponent(groupName)}/resource-groups?tenantId=${encodeURIComponent(tenantId)}&resourceGroup=${encodeURIComponent(rg)}`,
                { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } }
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("error"));
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("assign_rg_error"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-xl border border-brand-deep/30 dark:border-brand-bright/30 bg-brand-soft/20 dark:bg-slate-900 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-brand-deep dark:text-brand-bright mb-1">{t("assign_rg_title")}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t("assign_rg_subtitle")}</p>
            <div className="flex gap-2 mb-3">
                <input
                    value={newRg}
                    onChange={(e) => setNewRg(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addRg(); }}
                    placeholder={t("assign_rg_placeholder")}
                    className="flex-1 border border-gray-200 dark:border-slate-700 rounded-md px-3 py-1.5 text-sm bg-white dark:bg-slate-800"
                />
                <button
                    onClick={addRg}
                    disabled={saving || !newRg.trim()}
                    className="px-3 py-1.5 bg-brand-deep text-white rounded-md text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 hover:brightness-110"
                >
                    <Plus className="w-3.5 h-3.5" /> {t("assign_rg_add")}
                </button>
            </div>
            {matchedResourceGroups.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {matchedResourceGroups.map(rg => (
                        <span key={rg} className="inline-flex items-center gap-1 text-xs font-mono bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full pl-2.5 pr-1 py-1">
                            {rg}
                            <button onClick={() => removeRg(rg)} disabled={saving} className="p-0.5 text-gray-400 hover:text-red-500 rounded-full">
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

type MatchType = "tag" | "name_pattern";

function EditCostGroupModal({
    name, tenantId, initial, onClose, onSaved,
}: {
    name: string;
    tenantId: string;
    initial: { description: string | null; matchType: MatchType; matchTagKey: string | null; matchTagValue: string | null; matchRgPattern: string | null };
    onClose: () => void;
    onSaved: () => void;
}) {
    const t = useProviderTranslations("CostGroups");
    const { instance, accounts } = useMsal();
    const [description, setDescription] = useState(initial.description || "");
    const [matchType, setMatchType] = useState<MatchType>(initial.matchType);
    const [rgPattern, setRgPattern] = useState(initial.matchRgPattern || "");
    const [tagKey, setTagKey] = useState(initial.matchTagKey || "");
    const [tagValue, setTagValue] = useState(initial.matchTagValue || "");
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (matchType === "name_pattern" && !rgPattern.trim()) { toast.error(t("create_error_pattern_required")); return; }
        if (matchType === "tag" && (!tagKey.trim() || !tagValue.trim())) { toast.error(t("create_error_tag_required")); return; }

        setSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            const res = await fetch(`/api/cost-groups/${encodeURIComponent(name)}`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    description: description.trim() || undefined,
                    matchType,
                    ...(matchType === "name_pattern" ? { rgPattern: rgPattern.trim() } : { tagKey: tagKey.trim(), tagValue: tagValue.trim() }),
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("error"));
            toast.success(t("edit_success"));
            onSaved();
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
                <h4 className="font-bold text-[15px] text-gray-900 dark:text-white mb-1">{t("edit_title", { name })}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t("edit_subtitle")}</p>

                <div className="flex flex-col gap-3">
                    <div>
                        <label className="text-xs font-semibold text-gray-500">{t("create_description")}</label>
                        <input
                            value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent"
                        />
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

                    <div className="flex justify-end gap-2 mt-2">
                        <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                            {t("create_cancel")}
                        </button>
                        <button onClick={save} disabled={saving} className="px-4 py-2 bg-brand-deep text-white rounded-md text-sm font-bold flex items-center gap-2 disabled:opacity-50 hover:brightness-110">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("edit_submit")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function CostGroupDetailModal({ name, tenantId, onClose, onUpdated }: { name: string; tenantId: string; onClose: () => void; onUpdated?: () => void }) {
    const t = useProviderTranslations("CostGroups");
    const locale = useLocale();
    const { instance, accounts } = useMsal();
    const [tab, setTab] = useState<Tab>("current_fy");
    const [editing, setEditing] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": tenantId } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.details || j.error || t("error")); }
        return res.json();
    };

    const handleDelete = async () => {
        if (!confirm(t("delete_confirm", { name }))) return;
        setDeleting(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
            const res = await fetch(`/api/cost-groups/${encodeURIComponent(name)}?tenantId=${tenantId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${idToken}` },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || t("error"));
            toast.success(t("delete_success"));
            onUpdated?.();
            onClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : t("create_error_generic"));
        } finally {
            setDeleting(false);
        }
    };

    const { data, error, isLoading, mutate } = useSWR(
        tenantId && tenantId !== "default" && (accounts.length > 0 || isMockTenant(tenantId))
            ? `/api/cost-groups/${encodeURIComponent(name)}?tenantId=${tenantId}&locale=${encodeURIComponent(locale)}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const fy = data?.currentFY;
    const subs = fy?.subscriptionBreakdown || [];
    const budgetPerSub = subs.length > 0 && fy?.monthlyBudget ? fy.monthlyBudget / subs.length : 0;

    const costAnomaliesPag = usePagination(data?.actions?.costAnomalies || [], 10);
    const recommendationsPag = usePagination(data?.actions?.recommendations || [], 10);
    const resourceGroupsPag = usePagination(data?.resources?.resourceGroups || [], 10);
    const auditLogsPag = usePagination(data?.governance?.auditLogs || [], 10);

    const subscriptionKeys = useMemo(() => {
        const trend = data?.costs?.subscriptionTrend || [];
        const keys = new Set<string>();
        for (const point of trend) for (const k of Object.keys(point)) if (k !== "month") keys.add(k);
        return Array.from(keys);
    }, [data]);

    return (
        <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-gray-50 dark:bg-slate-950 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <div className="flex items-center gap-2">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{name}</h2>
                            {data?.description && <p className="text-sm text-gray-500 dark:text-gray-400">{data.description}</p>}
                        </div>
                        <>
                            <button
                                onClick={() => setEditing(true)}
                                title={t("edit_button")}
                                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-brand-deep dark:hover:text-brand-bright cursor-pointer shrink-0"
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                title={t("delete_button")}
                                className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer shrink-0 disabled:opacity-50"
                            >
                                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                        </>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400 cursor-pointer">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 px-4 pt-3 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                    {TABS.map(key => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`px-4 py-2 rounded-t-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                                tab === key
                                    ? "bg-brand-soft/60 dark:bg-slate-800 text-brand-deep dark:text-brand-bright border-b-2 border-brand-deep"
                                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800/60"
                            }`}
                        >
                            {t(`tab_${key}`)}
                        </button>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                            <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
                        </div>
                    )}
                    {error && (
                        parseTierRequiredError(error.message) ? (
                            <TierLockedNotice requiredTier={parseTierRequiredError(error.message)!} featureName={t("detailFeatureName")} />
                        ) : (
                            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {t("error")}</h3>
                                <p className="text-sm">{error.message}</p>
                            </div>
                        )
                    )}

                    {!isLoading && !error && data && tab === "current_fy" && (
                        <div className="space-y-4">
                            {/* Row 1: KPIs + Subscription/RG chart */}
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
                                <div className="xl:col-span-2 grid grid-cols-2 gap-3">
                                    <KpiTile icon={<DollarSign className="w-4 h-4 text-brand-deep dark:text-brand-bright" />} label={t("actual_cost_to_date_fy")} value={fmtUsd(fy?.actualCostToDateFY)} />
                                    <KpiTile icon={<DollarSign className="w-4 h-4 text-brand-deep dark:text-brand-bright" />} label={t("current_month_actual_cost")} value={fmtUsd(fy?.currentMonthActualCost)} />
                                    <KpiTile icon={<DollarSign className="w-4 h-4 text-brand-deep dark:text-brand-bright" />} label={t("monthly_budget")} value={fmtUsd(fy?.monthlyBudget)} />
                                    <KpiTile icon={<DollarSign className="w-4 h-4 text-brand-deep dark:text-brand-bright" />} label={t("current_month_forecast")} value={fmtUsd(fy?.currentMonthForecast)} />
                                </div>
                                <Card title={t("subscription_resource_group")}>
                                    <ResponsiveContainer width="100%" height={160}>
                                        <BarChart data={subs} layout="vertical" margin={{ left: 8, right: 16 }}>
                                            <XAxis type="number" tick={{ fontSize: 10 }} domain={[0, "auto"]} label={{ value: t("cost_axis"), position: "insideBottom", offset: -4, fontSize: 10 }} />
                                            <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={90} label={{ value: t("subscription_axis"), angle: -90, position: "insideLeft", fontSize: 10 }} />
                                            <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                                            {budgetPerSub > 0 && <ReferenceLine x={budgetPerSub} stroke="#dc2626" strokeDasharray="4 3" label={{ value: t("budget"), fontSize: 9, fill: "#dc2626" }} />}
                                            <Bar dataKey="cost" fill="#0054A6" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                    {fy?.unattributedSubscriptionCost > 0 && (
                                        <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                            {t("unattributed_subscription_cost", { amount: fmtUsd(fy.unattributedSubscriptionCost) })}
                                        </p>
                                    )}
                                </Card>
                            </div>

                            {/* Row 2: Monthly Saving / Subscriptions / Recommendations / Resource Groups / Cost Anomalies + Owner card */}
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
                                <div className="xl:col-span-2 grid grid-cols-2 grid-rows-3 gap-3">
                                    <KpiTile icon={<DollarSign className="w-4 h-4 text-emerald-600" />} label={t("monthly_saving")} value={fmtUsd(fy?.monthlySaving)} />
                                    <KpiTile icon={<Users className="w-4 h-4 text-brand-deep dark:text-brand-bright" />} label={t("subscriptions_count")} value={String(fy?.subscriptionsCount ?? 0)} />
                                    <Link href={`/${locale}/advisor`} className="group">
                                        <div className="p-3 h-full rounded-lg border border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 flex items-center justify-between gap-2.5 hover:border-brand-deep/40 transition-colors">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                                                    <Lightbulb className="w-4 h-4 text-amber-500" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-[10.5px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{t("recommendations_count")}</p>
                                                    <p className="text-base font-extrabold text-gray-900 dark:text-white">{fy?.recommendationsCount ?? 0}</p>
                                                </div>
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-brand-deep group-hover:translate-x-0.5 transition-all shrink-0" />
                                        </div>
                                    </Link>
                                    <KpiTile icon={<Boxes className="w-4 h-4 text-brand-deep dark:text-brand-bright" />} label={t("resource_groups_count")} value={String(fy?.resourceGroupsCount ?? 0)} />
                                    <KpiTile icon={<ShieldAlert className="w-4 h-4 text-red-500" />} label={t("cost_anomalies_count")} value={String(fy?.costAnomaliesCount ?? 0)} />
                                </div>
                                <Card title={t("cost_group_info")}>
                                    <dl className="space-y-2.5 text-sm">
                                        <div className="flex justify-between gap-2"><dt className="text-gray-400 dark:text-gray-500">{t("owner")}</dt><dd className="font-semibold text-gray-800 dark:text-gray-100 text-right">{data.owner || "—"}</dd></div>
                                        <div className="flex justify-between gap-2"><dt className="text-gray-400 dark:text-gray-500">{t("created_by")}</dt><dd className="font-semibold text-gray-800 dark:text-gray-100 text-right">{data.createdBy || "—"}</dd></div>
                                        <div className="flex justify-between gap-2"><dt className="text-gray-400 dark:text-gray-500">{t("created_on")}</dt><dd className="font-semibold text-gray-800 dark:text-gray-100 text-right">{fmtDate(data.createdAt, locale)}</dd></div>
                                        <div className="pt-1 border-t border-gray-100 dark:border-slate-800">
                                            <dt className="text-gray-400 dark:text-gray-500 mb-1">{t("description")}</dt>
                                            <dd className="text-gray-700 dark:text-gray-200">{data.description || "—"}</dd>
                                        </div>
                                    </dl>
                                </Card>
                            </div>

                            {/* Row 3: Monthly cost chart + locations map */}
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
                                <Card title={t("monthly_cost")} className="xl:col-span-2">
                                    <ResponsiveContainer width="100%" height={220}>
                                        <ComposedChart data={data.costs?.monthlyCost || []}>
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-slate-800" />
                                            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                            <YAxis tick={{ fontSize: 10 }} />
                                            <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                                            <Bar dataKey="actual" name={t("actual_cost")} fill="#0054A6" radius={[4, 4, 0, 0]} barSize={22} />
                                            <Line type="monotone" dataKey="forecast" name={t("forecast")} stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
                                            <Line type="monotone" dataKey="budget" name={t("budget")} stroke="#dc2626" strokeWidth={2} strokeDasharray="2 2" dot={false} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Card>
                                <Card title={t("resource_locations")}>
                                    <LocationsMap locations={data.costs?.locations || []} />
                                </Card>
                            </div>
                        </div>
                    )}

                    {!isLoading && !error && data && tab === "costs" && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-stretch">
                                <div className="flex flex-col gap-4">
                                    <Card title={t("total_period_cost")}>
                                        <p className="text-xl font-extrabold text-gray-900 dark:text-white">{fmtUsd(data.costs?.periodComparison?.periodCost)}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <TrendBadge pct={data.costs?.periodComparison?.periodChangePct ?? 0} />
                                            <span className="text-[11px] text-gray-400 dark:text-gray-500">{t("previous_period")}</span>
                                        </div>
                                    </Card>
                                    <Card title={t("projected_fy_cost")}>
                                        <p className="text-xl font-extrabold text-gray-900 dark:text-white">{fmtUsd(data.costs?.periodComparison?.projectedFYCost)}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <TrendBadge pct={data.costs?.periodComparison?.fyChangePct ?? 0} />
                                            <span className="text-[11px] text-gray-400 dark:text-gray-500">{t("previous_fy")}</span>
                                        </div>
                                    </Card>
                                </div>
                                <Card title={t("by_service")}>
                                    <MiniPie data={data.costs?.byService || []} />
                                </Card>
                                <Card title={t("meter")}>
                                    <MiniPie data={data.costs?.byMeter || []} donut />
                                </Card>
                                <Card title={t("service_category")}>
                                    <MiniPie data={data.costs?.byServiceCategory || []} />
                                </Card>
                            </div>
                            <Card title={t("subscription_evolution")}>
                                <ResponsiveContainer width="100%" height={240}>
                                    <LineChart data={data.costs?.subscriptionTrend || []}>
                                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-slate-800" />
                                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <Tooltip formatter={(v: any) => fmtUsd(Number(v))} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        {subscriptionKeys.map((k, i) => (
                                            <Line key={k} type="monotone" dataKey={k} name={k} stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={false} />
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                            </Card>
                        </div>
                    )}

                    {!isLoading && !error && data && tab === "actions" && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <KpiTile icon={<ShieldAlert className="w-4 h-4 text-red-500" />} label={t("cost_anomalies_count")} value={String(data.actions?.costAnomaliesCount ?? 0)} />
                                <Link href={`/${locale}/advisor`} className="group">
                                    <div className="p-3 h-full rounded-lg border border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 flex items-center justify-between gap-2.5 hover:border-brand-deep/40 transition-colors">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                                                <Lightbulb className="w-4 h-4 text-amber-500" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[10.5px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{t("recommendations_count")}</p>
                                                <p className="text-base font-extrabold text-gray-900 dark:text-white">{data.actions?.recommendationsCount ?? 0}</p>
                                            </div>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-brand-deep group-hover:translate-x-0.5 transition-all shrink-0" />
                                    </div>
                                </Link>
                                <KpiTile icon={<DollarSign className="w-4 h-4 text-emerald-600" />} label={t("monthly_saving")} value={fmtUsd(data.actions?.monthlySaving)} />
                            </div>

                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">{t("cost_anomalies")}</h3>
                                <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                                    <th className="px-4 py-3 font-semibold">{t("col_date")}</th>
                                                    <th className="px-4 py-3 font-semibold">{t("col_resource")}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t("col_previous_cost")}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t("col_new_cost")}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t("col_cost_change")}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t("col_pct_change")}</th>
                                                    <th className="px-4 py-3 font-semibold">{t("col_cost_group")}</th>
                                                    <th className="px-4 py-3 font-semibold">{t("col_subscription")}</th>
                                                    <th className="px-4 py-3 font-semibold">{t("col_resource_group")}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                                {costAnomaliesPag.paged.map((a: any, i: number) => (
                                                    <tr key={`${a.date}-${i}`}>
                                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(a.date, locale)}</td>
                                                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{a.resource}</td>
                                                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{fmtUsd(a.previousCost)}</td>
                                                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{fmtUsd(a.newCost)}</td>
                                                        <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400">+{fmtUsd(a.costChange)}</td>
                                                        <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400">+{a.pctChange}%</td>
                                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{a.costGroup}</td>
                                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 break-all">{a.subscription}</td>
                                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{a.resourceGroup}</td>
                                                    </tr>
                                                ))}
                                                {costAnomaliesPag.paged.length === 0 && (
                                                    <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">{t("empty")}</td></tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="px-4 pb-4">
                                        <Pagination {...costAnomaliesPag} pageSizes={[10]} labels={{ showing: t("showing"), of: t("of"), perPage: t("per_page"), prev: t("prev"), next: t("next"), page: t("page") }} />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">{t("recommendations")}</h3>
                                <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                                <th className="px-4 py-3 font-semibold">{t("col_recommendation")}</th>
                                                <th className="px-4 py-3 font-semibold">{t("col_subscription")}</th>
                                                <th className="px-4 py-3 font-semibold">{t("col_resource_group")}</th>
                                                <th className="px-4 py-3 font-semibold">{t("col_resource")}</th>
                                                <th className="px-4 py-3 font-semibold text-right">{t("col_cost_saving")}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                            {recommendationsPag.paged.map((a: any) => (
                                                <tr key={a.id}>
                                                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{a.title}</td>
                                                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 break-all">{a.subscription || "—"}</td>
                                                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{a.resourceGroup || "—"}</td>
                                                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 break-all">{a.resource || "—"}</td>
                                                    <td className="px-4 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(a.potentialSavingsMonthly)}</td>
                                                </tr>
                                            ))}
                                            {recommendationsPag.paged.length === 0 && (
                                                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">{t("empty")}</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                    <div className="px-4 pb-4">
                                        <Pagination {...recommendationsPag} labels={{ showing: t("showing"), of: t("of"), perPage: t("per_page"), prev: t("prev"), next: t("next"), page: t("page") }} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {!isLoading && !error && data && tab === "resources" && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <KpiTile icon={<Boxes className="w-4 h-4 text-brand-deep dark:text-brand-bright" />} label={t("tab_resources")} value={String(data.resources?.resourceGroupsCount ?? 0)} />
                            </div>
                            {data.isCustom && (
                                <ManualResourceGroupsPanel
                                    groupName={name}
                                    tenantId={tenantId}
                                    matchedResourceGroups={data.matchedResourceGroups || []}
                                    onChanged={() => mutate()}
                                />
                            )}
                            <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                            <th className="px-4 py-3 font-semibold">{t("col_resource_group")}</th>
                                            <th className="px-4 py-3 font-semibold text-right">{t("col_avg_daily_cost")}</th>
                                            <th className="px-4 py-3 font-semibold text-right">{t("col_period_cost")}</th>
                                            <th className="px-4 py-3 font-semibold text-right">{t("col_subscriptions")}</th>
                                            <th className="px-4 py-3 font-semibold">{t("col_owner")}</th>
                                            <th className="px-4 py-3 font-semibold">{t("col_created_date")}</th>
                                            <th className="px-4 py-3 font-semibold">{t("col_created_by")}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                        {resourceGroupsPag.paged.map((r: any, i: number) => (
                                            <tr key={`${r.resourceGroup}-${i}`}>
                                                <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{r.resourceGroup}</td>
                                                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{fmtUsd(r.avgDailyCost)}</td>
                                                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{fmtUsd(r.periodCost)}</td>
                                                <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{r.subscriptions}</td>
                                                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.owner || "—"}</td>
                                                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(r.createdDate, locale)}</td>
                                                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 break-all">{r.createdBy || "—"}</td>
                                            </tr>
                                        ))}
                                        {resourceGroupsPag.paged.length === 0 && (
                                            <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">{t("empty")}</td></tr>
                                        )}
                                    </tbody>
                                </table>
                                <div className="px-4 pb-4">
                                    <Pagination {...resourceGroupsPag} labels={{ showing: t("showing"), of: t("of"), perPage: t("per_page"), prev: t("prev"), next: t("next"), page: t("page") }} />
                                </div>
                            </div>
                        </div>
                    )}

                    {!isLoading && !error && data && tab === "governance" && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <KpiTile icon={<ScrollText className="w-4 h-4 text-brand-deep dark:text-brand-bright" />} label={t("audit_logs")} value={String(data.governance?.auditLogsCount ?? 0)} />
                            </div>
                            <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-slate-800/60 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                            <th className="px-4 py-3 font-semibold">{t("col_date")}</th>
                                            <th className="px-4 py-3 font-semibold">{t("col_from")}</th>
                                            <th className="px-4 py-3 font-semibold">{t("col_to")}</th>
                                            <th className="px-4 py-3 font-semibold">{t("col_subject")}</th>
                                            <th className="px-4 py-3 font-semibold">{t("col_resource")}</th>
                                            <th className="px-4 py-3 font-semibold">{t("col_comment")}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                        {auditLogsPag.paged.map((l: any, i: number) => (
                                            <tr key={`${l.date}-${i}`}>
                                                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtDate(l.date, locale)}</td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-200 break-all">{l.from}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${l.to === "success" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>{l.to}</span>
                                                </td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{l.subject}</td>
                                                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 break-all">{l.resource}</td>
                                                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{l.comment}</td>
                                            </tr>
                                        ))}
                                        {auditLogsPag.paged.length === 0 && (
                                            <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">{t("empty")}</td></tr>
                                        )}
                                    </tbody>
                                </table>
                                <div className="px-4 pb-4">
                                    <Pagination {...auditLogsPag} labels={{ showing: t("showing"), of: t("of"), perPage: t("per_page"), prev: t("prev"), next: t("next"), page: t("page") }} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {editing && (
                <EditCostGroupModal
                    name={name}
                    tenantId={tenantId}
                    initial={{
                        description: data?.description ?? "",
                        matchType: (data?.matchType || "name_pattern") as MatchType,
                        matchTagKey: data?.matchTagKey,
                        matchTagValue: data?.matchTagValue,
                        matchRgPattern: data?.matchRgPattern,
                    }}
                    onClose={() => setEditing(false)}
                    onSaved={() => { mutate(); onUpdated?.(); }}
                />
            )}
        </div>
    );
}

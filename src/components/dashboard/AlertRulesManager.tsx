"use client";
import React, { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { Loader2, Bell, Plus, Trash2, AlertCircle, Info, X } from "lucide-react";
import Pagination, { usePagination } from "@/components/Pagination";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

type Rule = {
    id: string;
    ruleName: string;
    ruleType: string;
    thresholdValue: number;
    thresholdUnit: string;
    channel: string;
    channelTarget: string;
    enabled: boolean;
    lastTriggeredAt: string | null;
    triggerCount: number;
    budgetId?: number | null;
    budgetName?: string | null;
};

type Budget = { id: number; costCenter: string; monthlyLimit: number };

const RULE_TYPES = ["budget", "anomaly", "forecast", "threshold", "credential_expiry", "ttl_expiry"] as const;
// Tipos con umbral fijo en días (no editable, sin unidad %/USD) — comparten
// la misma UI condicional del formulario.
const DAYS_ONLY_TYPES = new Set(["credential_expiry", "ttl_expiry"]);
const CHANNELS = ["email", "webhook", "teams", "slack", "servicenow"] as const;

const CHANNEL_BADGE: Record<string, string> = {
    email:       "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
    webhook:     "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400",
    teams:       "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
    slack:       "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400",
    servicenow:  "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400",
};
const TYPE_BADGE: Record<string, string> = {
    budget:    "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
    anomaly:   "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
    forecast:  "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
    threshold: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
    credential_expiry: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
    ttl_expiry: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
};

export default function AlertRulesManager() {
    const t = useTranslations("AlertsSelfService");
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const [form, setForm] = useState({
        ruleName: "",
        ruleType: "budget" as typeof RULE_TYPES[number],
        thresholdValue: "",
        thresholdUnit: "percent",
        channel: "email" as typeof CHANNELS[number],
        channelTarget: "",
        budgetId: "" as string,
    });

    const getToken = async () => {
        return getFreshIdToken(instance, accounts[0], ["User.Read"]);
    };

    const apiUrl = selectedTenant && selectedTenant.id !== "default"
        ? `/api/budgets/alerts?tenantId=${selectedTenant.id}`
        : null;

    const fetcher = async (url: string) => {
        const token = await getToken();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Error al cargar reglas");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });

    // Carga de budgets disponibles para reglas tipo "budget".
    const budgetsUrl = selectedTenant && selectedTenant.id !== "default"
        ? `/api/budgets?tenantId=${selectedTenant.id}`
        : null;
    const { data: budgetsData } = useSWR(budgetsUrl, fetcher, { revalidateOnFocus: false });
    const budgets: Budget[] = Array.isArray(budgetsData?.data)
        ? budgetsData.data
        : Array.isArray(budgetsData?.budgets)
            ? budgetsData.budgets
            : Array.isArray(budgetsData)
                ? budgetsData
                : [];

    const rules: Rule[] = data?.rules || [];

    // Hook de paginación: DEBE llamarse incondicionalmente (Rules of Hooks),
    // antes de cualquier return temprano.
    const { paged, ...paginationProps } = usePagination(rules, 10);

    const handleDelete = async (id: string) => {
        if (!selectedTenant) return;
        setDeleting(id);
        try {
            const token = await getToken();
            await fetch(`/api/budgets/alerts/${id}?tenantId=${selectedTenant.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            globalMutate(apiUrl);
        } finally {
            setDeleting(null);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTenant) return;
        if (form.ruleType === "budget" && !form.budgetId) {
            return; // el browser ya bloqueará por required
        }
        setSaving(true);
        try {
            const token = await getToken();
            await fetch(`/api/budgets/alerts?tenantId=${selectedTenant.id}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    ruleName: form.ruleName,
                    ruleType: form.ruleType,
                    thresholdValue: parseFloat(form.thresholdValue),
                    thresholdUnit: DAYS_ONLY_TYPES.has(form.ruleType) ? "days" : form.thresholdUnit,
                    channel: form.channel,
                    channelTarget: form.channelTarget,
                    budgetId: form.ruleType === "budget" && form.budgetId ? Number(form.budgetId) : null,
                }),
            });
            setShowModal(false);
            setForm({ ruleName: "", ruleType: "budget", thresholdValue: "", thresholdUnit: "percent", channel: "email", channelTarget: "", budgetId: "" });
            globalMutate(apiUrl);
        } finally {
            setSaving(false);
        }
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loadingRules")}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('tierLockedFeatureName')} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {data?.mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <span className="font-bold mr-2 px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 rounded text-xs">{tm("badge")}</span>
                        {tm("description")}
                    </div>
                </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Bell className="w-4 h-4" />
                    <span>{rules.length} regla{rules.length !== 1 ? "s" : ""} configurada{rules.length !== 1 ? "s" : ""}</span>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    {t("newRule")}
                </button>
            </div>

            {/* Rules table */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                {rules.length === 0 ? (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                        <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">{t("noRules")}</p>
                        <p className="text-sm mt-1">{t("empty")}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">{t("ruleName")}</th>
                                    <th className="px-4 py-3 font-semibold">{t("type")}</th>
                                    <th className="px-4 py-3 font-semibold">{t("threshold")}</th>
                                    <th className="px-4 py-3 font-semibold">{t("channel")}</th>
                                    <th className="px-4 py-3 font-semibold">{t("enabled")}</th>
                                    <th className="px-4 py-3 font-semibold">{t("lastTriggered")}</th>
                                    <th className="px-4 py-3 font-semibold text-right">{t("triggerCount")}</th>
                                    <th className="px-4 py-3 font-semibold text-right">{t("delete")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                {paged.map((rule) => (
                                    <tr key={rule.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 max-w-[220px] truncate" title={rule.ruleName}>
                                            {rule.ruleName}
                                            {rule.ruleType === "budget" && rule.budgetName && (
                                                <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-normal truncate">
                                                    Budget: {rule.budgetName}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TYPE_BADGE[rule.ruleType] || "bg-gray-100 text-gray-600"}`}>
                                                {t(`types.${rule.ruleType}` as `types.budget`)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-mono">
                                            {rule.thresholdValue} {rule.thresholdUnit}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${CHANNEL_BADGE[rule.channel] || "bg-gray-100 text-gray-600"}`}>
                                                {t(`channels.${rule.channel}` as `channels.email`)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-block w-2.5 h-2.5 rounded-full ${rule.enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                                            {rule.lastTriggeredAt
                                                ? new Date(rule.lastTriggeredAt).toLocaleDateString()
                                                : "—"}
                                        </td>
                                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
                                            {rule.triggerCount}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => handleDelete(rule.id)}
                                                disabled={deleting === rule.id}
                                                className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
                                                aria-label={t("delete")}
                                            >
                                                {deleting === rule.id
                                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                                    : <Trash2 className="w-4 h-4" />}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {rules.length > 0 && <Pagination {...paginationProps} />}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-slate-700">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
                            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Plus className="w-4 h-4 text-indigo-500" />
                                {t("newRule")}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-slate-400">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("ruleName")}</label>
                                <input
                                    type="text"
                                    required
                                    value={form.ruleName}
                                    onChange={(e) => setForm((f) => ({ ...f, ruleName: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                    placeholder={t("ruleNamePlaceholder")}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("type")}</label>
                                    <select
                                        value={form.ruleType}
                                        onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value as typeof RULE_TYPES[number], budgetId: "" }))}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                    >
                                        {RULE_TYPES.map((rt) => (
                                            <option key={rt} value={rt}>{t(`types.${rt}` as `types.budget`)}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("threshold")}</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            required
                                            min={0}
                                            step="any"
                                            value={form.thresholdValue}
                                            onChange={(e) => setForm((f) => ({ ...f, thresholdValue: e.target.value }))}
                                            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        />
                                        <select
                                            value={DAYS_ONLY_TYPES.has(form.ruleType) ? "days" : form.thresholdUnit}
                                            onChange={(e) => setForm((f) => ({ ...f, thresholdUnit: e.target.value }))}
                                            disabled={DAYS_ONLY_TYPES.has(form.ruleType)}
                                            className="px-2 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-70"
                                        >
                                            {DAYS_ONLY_TYPES.has(form.ruleType) ? (
                                                <option value="days">{t("daysUnit")}</option>
                                            ) : (
                                                <>
                                                    <option value="percent">%</option>
                                                    <option value="usd">USD</option>
                                                </>
                                            )}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            {form.ruleType === "budget" && (
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                        Budget asociado <span className="text-red-500">*</span>
                                    </label>
                                    {budgets.length === 0 ? (
                                        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-3">
                                            {t.rich("noBudgetsNotice", { b: (c) => <strong>{c}</strong> })}
                                        </div>
                                    ) : (
                                        <select
                                            required
                                            value={form.budgetId}
                                            onChange={(e) => setForm((f) => ({ ...f, budgetId: e.target.value }))}
                                            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                        >
                                            <option value="">Selecciona un budget…</option>
                                            {budgets.map((b) => (
                                                <option key={b.id} value={b.id}>
                                                    {t("budgetOptionLine", { costCenter: b.costCenter, limit: Number(b.monthlyLimit).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) })}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                        {t("budgetAlertHint")}
                                    </p>
                                </div>
                            )}
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("channel")}</label>
                                <select
                                    value={form.channel}
                                    onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as typeof CHANNELS[number] }))}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                >
                                    {CHANNELS.map((ch) => (
                                        <option key={ch} value={ch}>{t(`channels.${ch}` as `channels.email`)}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("channelTargetLabel")}</label>
                                <input
                                    type="text"
                                    required
                                    value={form.channelTarget}
                                    onChange={(e) => setForm((f) => ({ ...f, channelTarget: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                    placeholder={t("channelTargetPlaceholder")}
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                                >
                                    {t("cancel")}
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-5 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-2"
                                >
                                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {t("save")}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

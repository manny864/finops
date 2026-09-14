"use client";
/**
 * Gestión de presupuestos de plataforma (tabla Budgets, por cost center):
 * lista con consumo/utilización, edición del límite y umbral (upsert
 * POST /api/budgets) y creación de alertas vinculadas al budget
 * (POST /api/budgets/alerts con ruleType=budget + budgetId), integrando la
 * página de Presupuestos con Alertas Self-Service y Sugerencias de Tags.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { Link } from "@/i18n/routing";
import { Loader2, Pencil, BellPlus, Plus, ExternalLink, Tag } from "lucide-react";
import { toast } from "sonner";
import BudgetMonthlyChart, { type BudgetMonthlyChartPoint } from "@/components/budgets/BudgetMonthlyChart";
import type { BudgetStatus } from "@/lib/budgetTypes";

/** Hash simple y determinístico de un string, para generar datos mock estables entre renders. */
function seededRandom(seed: string): () => number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    return () => {
        h = (Math.imul(1103515245, h) + 12345) | 0;
        return ((h >>> 0) % 1000) / 1000;
    };
}

/** Genera 6 meses de historial mensual sintético terminando en `currentSpend`, para tenants demo. */
function generateMockMonthlyHistory(costCenter: string, currentSpend: number): BudgetMonthlyChartPoint[] {
    const rand = seededRandom(costCenter);
    const now = new Date();
    const points: BudgetMonthlyChartPoint[] = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        const isLast = i === 0;
        const drift = 0.7 + (5 - i) * 0.06;
        const noise = 0.9 + rand() * 0.2;
        const cost = isLast ? currentSpend : Number((currentSpend * drift * noise).toFixed(2));
        points.push({ month, cost: Math.max(0, cost) });
    }
    return points;
}

interface PlatformBudget {
    id: number;
    costCenter: string;
    monthlyLimit: number;
    alertThreshold: number;
    currentSpend: number;
    utilization: number;
    dailyBurnRate?: number;
    forecastedMonthEndSpend?: number;
    forecastedBreachDate?: string | null;
    budgetStatus?: BudgetStatus;
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function PlatformBudgetsManager() {
    const t = useTranslations("Budgets");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [budgets, setBudgets] = useState<PlatformBudget[]>([]);
    const [suggestedCostCenters, setSuggestedCostCenters] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [monthlyHistory, setMonthlyHistory] = useState<Record<number, BudgetMonthlyChartPoint[]>>({});
    const [monthlyLoading, setMonthlyLoading] = useState<Record<number, boolean>>({});
    const [editing, setEditing] = useState<PlatformBudget | null>(null);
    const [creating, setCreating] = useState(false);
    const [editForm, setEditForm] = useState({ costCenter: "", monthlyLimit: "", alertThreshold: "80" });
    const [saving, setSaving] = useState(false);

    const [alertFor, setAlertFor] = useState<PlatformBudget | null>(null);
    const [alertForm, setAlertForm] = useState({
        ruleName: "",
        thresholdValue: "80",
        channelType: "email" as "email" | "webhook",
        channelTarget: "",
        forecastAlertEnabled: true,
    });
    const [savingAlert, setSavingAlert] = useState(false);

    const isMock = isMockTenant(selectedTenant?.id || "");

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!accounts || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, accounts]);

    const load = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            let json;
            if (isMock) {
                json = getMockDataForRoute("platform-budgets", (selectedTenant as { tier?: string }).tier || selectedTenant.id);
            } else {
                const headers = await authHeaders();
                const res = await fetch(`/api/budgets?tenantId=${selectedTenant.id}`, { headers });
                json = await res.json();
                if (!res.ok) throw new Error(json.error);
            }
            setBudgets(json.budgets || []);
            setSuggestedCostCenters(json.suggestedCostCenters || ["engineering", "marketing", "data-platform", "shared-services", "Databases", "AI-Services"]);
        } catch {
            toast.error(t("platformError"));
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, isMock, authHeaders, t]);

    useEffect(() => {
        load();
    }, [load]);

    // Historial de gasto mensual por budget (últimos 6 meses)
    useEffect(() => {
        if (budgets.length === 0 || !selectedTenant?.id) return;

        if (isMock) {
            const mockHistory: Record<number, BudgetMonthlyChartPoint[]> = {};
            budgets.forEach((b) => {
                mockHistory[b.id] = generateMockMonthlyHistory(b.costCenter, b.currentSpend);
            });
            setMonthlyHistory(mockHistory);
            return;
        }

        let isMounted = true;
        setMonthlyLoading(Object.fromEntries(budgets.map((b) => [b.id, true])));

        (async () => {
            const headers = await authHeaders();
            const results = await Promise.all(budgets.map(async (b) => {
                try {
                    const res = await fetch(`/api/budgets/monthly-history?tenantId=${selectedTenant.id}&costCenter=${encodeURIComponent(b.costCenter)}`, { headers });
                    const json = await res.json();
                    return [b.id, (json.monthlyHistory || []) as BudgetMonthlyChartPoint[]] as const;
                } catch {
                    return [b.id, [] as BudgetMonthlyChartPoint[]] as const;
                }
            }));
            if (isMounted) {
                setMonthlyHistory(Object.fromEntries(results));
                setMonthlyLoading({});
            }
        })();

        return () => {
            isMounted = false;
        };
    }, [budgets.map((b) => b.id).join(","), selectedTenant?.id, isMock]);

    const openEdit = (b: PlatformBudget | null) => {
        setCreating(!b);
        setEditing(b || { id: 0, costCenter: "", monthlyLimit: 0, alertThreshold: 80, currentSpend: 0, utilization: 0 });
        setEditForm({
            costCenter: b?.costCenter || (suggestedCostCenters[0] || ""),
            monthlyLimit: b ? String(b.monthlyLimit) : "",
            alertThreshold: b ? String(b.alertThreshold) : "80",
        });
    };

    const saveBudget = async () => {
        const limit = Number(editForm.monthlyLimit);
        const threshold = Number(editForm.alertThreshold);
        if (!editForm.costCenter.trim() || !Number.isFinite(limit) || limit <= 0 || !Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
            toast.error(t("platformInvalidForm"));
            return;
        }
        if (isMock) {
            toast.success(t("platformSaved"));
            setEditing(null);
            return;
        }
        setSaving(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/budgets", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    costCenter: editForm.costCenter.trim(),
                    monthlyLimit: limit,
                    alertThreshold: threshold,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            toast.success(t("platformSaved"));
            setEditing(null);
            await load();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("platformError"));
        } finally {
            setSaving(false);
        }
    };

    const openAlert = (b: PlatformBudget) => {
        setAlertFor(b);
        setAlertForm({
            ruleName: t("platformAlertDefaultName", { costCenter: b.costCenter }),
            thresholdValue: String(b.alertThreshold || 80),
            channelType: "email",
            channelTarget: accounts[0]?.username || "",
            forecastAlertEnabled: true,
        });
    };

    const saveAlert = async () => {
        if (!alertFor) return;
        const threshold = Number(alertForm.thresholdValue);
        if (!alertForm.ruleName.trim() || !alertForm.channelTarget.trim() || !Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
            toast.error(t("platformInvalidForm"));
            return;
        }
        if (isMock) {
            toast.success(t("platformAlertCreated"));
            setAlertFor(null);
            return;
        }
        setSavingAlert(true);
        try {
            const headers = await authHeaders();
            const res = await fetch(`/api/budgets/alerts?tenantId=${selectedTenant.id}`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    ruleName: alertForm.ruleName.trim(),
                    ruleType: "budget",
                    budgetId: alertFor.id,
                    thresholdValue: threshold,
                    thresholdUnit: "percent",
                    channel: alertForm.channelType,
                    channelTarget: alertForm.channelTarget.trim(),
                    forecastAlert: alertForm.forecastAlertEnabled,
                }),
            });
            const json = await res.json();
            if (!res.ok || json.success === false) throw new Error(json.error);
            toast.success(t("platformAlertCreated"));
            setAlertFor(null);
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("platformError"));
        } finally {
            setSavingAlert(false);
        }
    };

    const renderFinancialBadge = (status: BudgetStatus = "OK") => {
        switch (status) {
            case "OK":
                return (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        {t("status_ok")}
                    </span>
                );
            case "WARNING":
                return (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        {t("status_warning")}
                    </span>
                );
            case "CRITICAL":
                return (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
                        {t("status_critical")}
                    </span>
                );
        }
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div id="platform-budgets-section" className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-6 mt-6">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4 pb-3 border-b border-gray-100 dark:border-slate-800">
                <div>
                    <h3 className="text-lg font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: "Montserrat, sans-serif" }}>
                        {t("platformTitle")}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("platformSubtitle")}</p>
                </div>
                <button
                    onClick={() => openEdit(null)}
                    className="px-3.5 py-2 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
                >
                    <Plus className="w-3.5 h-3.5" /> {t("platformNew")}
                </button>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
                    <Loader2 className="w-4 h-4 animate-spin" /> {t("platformLoading")}
                </div>
            ) : budgets.length === 0 ? (
                <div className="py-8 text-center border-2 border-dashed border-gray-100 dark:border-slate-800 rounded-xl flex flex-col items-center justify-center">
                    <Tag className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-sm text-slate-400 max-w-md mb-3">{t("platformEmpty")}</p>
                    <button
                        onClick={() => openEdit(null)}
                        className="px-4 py-2 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 rounded-lg text-xs font-semibold hover:bg-blue-50 transition-colors shadow-sm"
                    >
                        {t("platformNew")}
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {budgets.map((b) => {
                        const pct = Math.min(100, Math.round(b.utilization));
                        const over = b.utilization >= b.alertThreshold;
                        return (
                            <div key={b.id} className="border border-gray-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between bg-white dark:bg-slate-900/90 shadow-sm">
                                <div>
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <Tag className="w-4 h-4 text-[#0054A6] dark:text-[#00AEEF] flex-shrink-0" />
                                            <h4 className="font-bold text-sm text-[#1B2A41] dark:text-white truncate" title={b.costCenter} style={{ fontFamily: "Montserrat, sans-serif" }}>
                                                {b.costCenter}
                                            </h4>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {renderFinancialBadge(b.budgetStatus || (over ? "WARNING" : "OK"))}
                                            <button onClick={() => openEdit(b)} title={t("platformEdit")} className="p-1.5 text-slate-400 hover:text-[#0054A6] transition-colors">
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => openAlert(b)} title={t("platformCreateAlert")} className="p-1.5 text-slate-400 hover:text-[#0054A6] transition-colors">
                                                <BellPlus className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-end mb-2">
                                        <div>
                                            <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{t("platformLimit")}</p>
                                            <p className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200 font-mono">{fmt.format(b.monthlyLimit)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{t("platformSpend")}</p>
                                            <p className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200 font-mono">{fmt.format(b.currentSpend)}</p>
                                        </div>
                                    </div>

                                    <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-2 mb-3 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-[#0054A6]"}`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>

                                    {b.dailyBurnRate !== undefined && (
                                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-3 bg-slate-50 dark:bg-slate-800/40 p-2 rounded-lg">
                                            <span>Burn: <strong className="text-slate-900 dark:text-white font-mono">{t("perDay", { v: fmt.format(b.dailyBurnRate) })}</strong></span>
                                            <span>Proy: <strong className="text-[#0054A6] dark:text-blue-400 font-mono">{fmt.format(b.forecastedMonthEndSpend || b.currentSpend)}</strong></span>
                                        </div>
                                    )}

                                    <div className="border-t border-gray-100 dark:border-slate-800 pt-2 mb-2">
                                        <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{t("monthly_spend")}</p>
                                        <BudgetMonthlyChart
                                            data={monthlyHistory[b.id] || []}
                                            budgetAmount={b.monthlyLimit}
                                            forecastedSpend={b.forecastedMonthEndSpend}
                                            loading={!!monthlyLoading[b.id]}
                                            height={120}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="mt-4 text-xs text-gray-400">
                <Link href="/governance/alerts" className="inline-flex items-center gap-1 text-[#0054A6] dark:text-[#00AEEF] hover:underline font-semibold">
                    {t("platformGoToAlerts")} <ExternalLink className="w-3 h-3" />
                </Link>
            </div>

            {/* Modal editar/crear budget (Z-INDEX ESTRICTO Z-50) */}
            {editing && (
                <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => !saving && setEditing(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md p-6 shadow-2xl z-50 border border-slate-200 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                        <h4 className="font-bold text-[16px] text-[#1B2A41] dark:text-white mb-4" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {creating ? t("platformNew") : t("platformEditTitle", { costCenter: editing.costCenter })}
                        </h4>
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 mb-1">
                                    <Tag className="w-3.5 h-3.5 text-[#0054A6]" />
                                    {t("platformCostCenter")}
                                </label>
                                {creating && suggestedCostCenters.length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                        <select
                                            value={suggestedCostCenters.includes(editForm.costCenter) ? editForm.costCenter : "__custom__"}
                                            onChange={(e) => {
                                                if (e.target.value !== "__custom__") {
                                                    setEditForm({ ...editForm, costCenter: e.target.value });
                                                }
                                            }}
                                            className="w-full border border-gray-300 dark:border-slate-700 rounded-lg p-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:border-[#0054A6]"
                                        >
                                            <option value="" disabled>{t("select_or_type_cc")}</option>
                                            {suggestedCostCenters.map((cc) => (
                                                <option key={cc} value={cc}>
                                                    {cc}
                                                </option>
                                            ))}
                                            <option value="__custom__">+ Escribir otro Cost Center...</option>
                                        </select>
                                        <input
                                            value={editForm.costCenter}
                                            onChange={(e) => setEditForm({ ...editForm, costCenter: e.target.value })}
                                            placeholder={t("select_or_type_cc")}
                                            maxLength={255}
                                            className="w-full border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-xs bg-transparent text-slate-900 dark:text-white focus:border-[#0054A6]"
                                        />
                                    </div>
                                ) : (
                                    <input
                                        value={editForm.costCenter}
                                        onChange={(e) => setEditForm({ ...editForm, costCenter: e.target.value })}
                                        disabled={!creating}
                                        maxLength={255}
                                        className="w-full border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-xs bg-transparent disabled:opacity-60 text-slate-900 dark:text-white"
                                    />
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("platformLimit")} (USD)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={editForm.monthlyLimit}
                                        onChange={(e) => setEditForm({ ...editForm, monthlyLimit: e.target.value })}
                                        className="w-full border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-xs mt-1 bg-transparent text-slate-900 dark:text-white focus:border-[#0054A6]"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("platformThreshold")} (%)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={editForm.alertThreshold}
                                        onChange={(e) => setEditForm({ ...editForm, alertThreshold: e.target.value })}
                                        className="w-full border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-xs mt-1 bg-transparent text-slate-900 dark:text-white focus:border-[#0054A6]"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-3">
                                <button
                                    onClick={() => setEditing(null)}
                                    disabled={saving}
                                    className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors shadow-sm"
                                >
                                    {t("platformCancel")}
                                </button>
                                <button
                                    onClick={saveBudget}
                                    disabled={saving}
                                    className="px-4 py-2 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 hover:bg-blue-50 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 transition-colors shadow-sm"
                                >
                                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("platformSave")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal crear alerta vinculada (Z-INDEX ESTRICTO Z-50) */}
            {alertFor && (
                <div className="fixed inset-0 bg-black/50 z-50 grid place-items-center p-4" onClick={() => !savingAlert && setAlertFor(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md p-6 shadow-2xl z-50 border border-slate-200 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                        <h4 className="font-bold text-[16px] text-[#1B2A41] dark:text-white mb-1" style={{ fontFamily: "Montserrat, sans-serif" }}>
                            {t("platformCreateAlert")}
                        </h4>
                        <p className="text-xs text-slate-500 mb-4">{t("platformAlertLinked", { costCenter: alertFor.costCenter })}</p>
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("platformAlertName")}</label>
                                <input
                                    value={alertForm.ruleName}
                                    onChange={(e) => setAlertForm({ ...alertForm, ruleName: e.target.value })}
                                    maxLength={255}
                                    className="w-full border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-xs mt-1 bg-transparent text-slate-900 dark:text-white focus:border-[#0054A6]"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("platformThreshold")} (%)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={alertForm.thresholdValue}
                                        onChange={(e) => setAlertForm({ ...alertForm, thresholdValue: e.target.value })}
                                        className="w-full border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-xs mt-1 bg-transparent text-slate-900 dark:text-white focus:border-[#0054A6]"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("channel_type")}</label>
                                    <select
                                        value={alertForm.channelType}
                                        onChange={(e) => setAlertForm({ ...alertForm, channelType: e.target.value as "email" | "webhook" })}
                                        className="w-full border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-xs mt-1 bg-transparent text-slate-900 dark:text-white focus:border-[#0054A6]"
                                    >
                                        <option value="email">{t("channel_email")}</option>
                                        <option value="webhook">{t("channel_webhook")}</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    {alertForm.channelType === "email" ? t("emailLabel") : "Webhook URL"}
                                </label>
                                <input
                                    type={alertForm.channelType === "email" ? "email" : "url"}
                                    value={alertForm.channelTarget}
                                    placeholder={alertForm.channelType === "email" ? "admin@cscloudsolutions.com" : t("webhook_placeholder")}
                                    onChange={(e) => setAlertForm({ ...alertForm, channelTarget: e.target.value })}
                                    className="w-full border border-gray-200 dark:border-slate-700 rounded-lg p-2 text-xs mt-1 bg-transparent text-slate-900 dark:text-white focus:border-[#0054A6]"
                                />
                            </div>

                            {/* Alerta Predictiva Checkbox */}
                            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 mt-1">
                                <input
                                    type="checkbox"
                                    id="forecast-alert-cb"
                                    checked={alertForm.forecastAlertEnabled}
                                    onChange={(e) => setAlertForm({ ...alertForm, forecastAlertEnabled: e.target.checked })}
                                    className="rounded border-slate-300 text-[#0054A6] focus:ring-[#0054A6]"
                                />
                                <label htmlFor="forecast-alert-cb" className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                                    {t("forecast_alert_checkbox")}
                                </label>
                            </div>

                            <div className="flex justify-end gap-2 mt-3">
                                <button
                                    onClick={() => setAlertFor(null)}
                                    disabled={savingAlert}
                                    className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors shadow-sm"
                                >
                                    {t("platformCancel")}
                                </button>
                                <button
                                    onClick={saveAlert}
                                    disabled={savingAlert}
                                    className="px-4 py-2 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 hover:bg-blue-50 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 transition-colors shadow-sm"
                                >
                                    {savingAlert && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("platformAlertCreate")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

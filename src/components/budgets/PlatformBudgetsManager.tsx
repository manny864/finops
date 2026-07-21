"use client";
/**
 * Gestión de presupuestos de plataforma (tabla Budgets, por cost center):
 * lista con consumo/utilización, edición del límite y umbral (upsert
 * POST /api/budgets) y creación de alertas vinculadas al budget
 * (POST /api/budgets/alerts con ruleType=budget + budgetId), integrando la
 * página de Presupuestos con Alertas Self-Service.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { Link } from "@/i18n/routing";
import { Loader2, Pencil, BellPlus, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import BudgetMonthlyChart, { type BudgetMonthlyChartPoint } from "@/components/budgets/BudgetMonthlyChart";

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
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function PlatformBudgetsManager() {
    const t = useTranslations("Budgets");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const [budgets, setBudgets] = useState<PlatformBudget[]>([]);
    const [loading, setLoading] = useState(true);
    const [monthlyHistory, setMonthlyHistory] = useState<Record<number, BudgetMonthlyChartPoint[]>>({});
    const [monthlyLoading, setMonthlyLoading] = useState<Record<number, boolean>>({});
    const [editing, setEditing] = useState<PlatformBudget | null>(null);
    const [creating, setCreating] = useState(false);
    const [editForm, setEditForm] = useState({ costCenter: "", monthlyLimit: "", alertThreshold: "80" });
    const [saving, setSaving] = useState(false);

    const [alertFor, setAlertFor] = useState<PlatformBudget | null>(null);
    const [alertForm, setAlertForm] = useState({ ruleName: "", thresholdValue: "80", channelTarget: "" });
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
        } catch {
            toast.error(t("platformError"));
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, isMock, authHeaders, t]);

    useEffect(() => {
        load();
    }, [load]);

    // Historial de gasto mensual por budget (últimos 6 meses), para el
    // gráfico tipo Azure "View Monthly Cost Data" junto a cada tarjeta.
    // Mock: se genera client-side (determinístico por costCenter), sin red.
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- solo re-fetch cuando cambia la lista de budgets (ids), no en cada render de authHeaders
    }, [budgets.map((b) => b.id).join(","), selectedTenant?.id, isMock]);

    const openEdit = (b: PlatformBudget | null) => {
        setCreating(!b);
        setEditing(b || { id: 0, costCenter: "", monthlyLimit: 0, alertThreshold: 80, currentSpend: 0, utilization: 0 });
        setEditForm({
            costCenter: b?.costCenter || "",
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
            channelTarget: accounts[0]?.username || "",
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
                    channel: "email",
                    channelTarget: alertForm.channelTarget.trim(),
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

    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg shadow-sm p-6 mt-6">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                <div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t("platformTitle")}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("platformSubtitle")}</p>
                </div>
                <button onClick={() => openEdit(null)} className="px-3 py-2 bg-brand-deep text-white rounded-md text-xs font-bold hover:brightness-110 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> {t("platformNew")}
                </button>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-6"><Loader2 className="w-4 h-4 animate-spin" /> {t("platformLoading")}</div>
            ) : budgets.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center border-2 border-dashed border-gray-100 dark:border-slate-800 rounded-lg">{t("platformEmpty")}</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {budgets.map((b) => {
                        const pct = Math.min(100, Math.round(b.utilization));
                        const over = b.utilization >= b.alertThreshold;
                        return (
                            <div key={b.id} className="border border-gray-200 dark:border-slate-800 rounded-lg p-4 flex flex-col">
                                <div className="flex items-start justify-between gap-2 mb-3">
                                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 truncate" title={b.costCenter}>{b.costCenter}</h4>
                                    <div className="flex items-center gap-0.5 shrink-0">
                                        <button onClick={() => openEdit(b)} title={t("platformEdit")} className="p-1.5 text-slate-500 hover:text-brand-deep">
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => openAlert(b)} title={t("platformCreateAlert")} className="p-1.5 text-slate-500 hover:text-brand-deep">
                                            <BellPlus className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex justify-between items-end mb-2">
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{t("platformLimit")}</p>
                                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmt.format(b.monthlyLimit)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{t("platformSpend")}</p>
                                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmt.format(b.currentSpend)}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 mb-3">
                                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                                        <div className={`h-full ${over ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className={`text-xs font-semibold ${over ? "text-red-600" : "text-slate-600 dark:text-slate-300"}`}>{b.utilization.toFixed(0)}%</span>
                                </div>

                                <div className="border-t border-gray-100 dark:border-slate-800 pt-2">
                                    <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{t('monthly_spend')}</p>
                                    <BudgetMonthlyChart
                                        data={monthlyHistory[b.id] || []}
                                        budgetAmount={b.monthlyLimit}
                                        loading={!!monthlyLoading[b.id]}
                                        height={120}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="mt-4 text-xs text-gray-400">
                <Link href="/intelligence/alerts" className="inline-flex items-center gap-1 text-brand-deep hover:underline">
                    {t("platformGoToAlerts")} <ExternalLink className="w-3 h-3" />
                </Link>
            </div>

            {/* Modal editar/crear budget */}
            {editing && (
                <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={() => !saving && setEditing(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h4 className="font-bold text-[15px] text-gray-900 dark:text-white mb-4">
                            {creating ? t("platformNew") : t("platformEditTitle", { costCenter: editing.costCenter })}
                        </h4>
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="text-xs font-semibold text-gray-500">{t("platformCostCenter")}</label>
                                <input
                                    value={editForm.costCenter}
                                    onChange={(e) => setEditForm({ ...editForm, costCenter: e.target.value })}
                                    disabled={!creating}
                                    maxLength={255}
                                    className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent disabled:opacity-60"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-gray-500">{t("platformLimit")} (USD)</label>
                                    <input type="number" min={1} value={editForm.monthlyLimit} onChange={(e) => setEditForm({ ...editForm, monthlyLimit: e.target.value })} className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500">{t("platformThreshold")} (%)</label>
                                    <input type="number" min={1} max={100} value={editForm.alertThreshold} onChange={(e) => setEditForm({ ...editForm, alertThreshold: e.target.value })} className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent" />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-2">
                                <button onClick={() => setEditing(null)} disabled={saving} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">{t("platformCancel")}</button>
                                <button onClick={saveBudget} disabled={saving} className="px-4 py-2 bg-brand-deep text-white rounded-md text-sm font-bold flex items-center gap-2 disabled:opacity-50 hover:brightness-110">
                                    {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("platformSave")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal crear alerta vinculada */}
            {alertFor && (
                <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center p-4" onClick={() => !savingAlert && setAlertFor(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h4 className="font-bold text-[15px] text-gray-900 dark:text-white mb-1">{t("platformCreateAlert")}</h4>
                        <p className="text-xs text-gray-500 mb-4">{t("platformAlertLinked", { costCenter: alertFor.costCenter })}</p>
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="text-xs font-semibold text-gray-500">{t("platformAlertName")}</label>
                                <input value={alertForm.ruleName} onChange={(e) => setAlertForm({ ...alertForm, ruleName: e.target.value })} maxLength={255} className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-gray-500">{t("platformThreshold")} (%)</label>
                                    <input type="number" min={1} max={100} value={alertForm.thresholdValue} onChange={(e) => setAlertForm({ ...alertForm, thresholdValue: e.target.value })} className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent" />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500">{t('emailLabel')}</label>
                                    <input type="email" value={alertForm.channelTarget} onChange={(e) => setAlertForm({ ...alertForm, channelTarget: e.target.value })} className="w-full border border-gray-200 dark:border-slate-700 rounded-md p-2 text-sm mt-1 bg-transparent" />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-2">
                                <button onClick={() => setAlertFor(null)} disabled={savingAlert} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">{t("platformCancel")}</button>
                                <button onClick={saveAlert} disabled={savingAlert} className="px-4 py-2 bg-brand-deep text-white rounded-md text-sm font-bold flex items-center gap-2 disabled:opacity-50 hover:brightness-110">
                                    {savingAlert && <Loader2 className="w-4 h-4 animate-spin" />} {t("platformAlertCreate")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

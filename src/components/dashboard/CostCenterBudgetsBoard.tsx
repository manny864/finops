"use client";
import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, AlertCircle, Wallet, AlertTriangle, Pencil, Check, X } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import { useProviderTranslations } from "@/lib/useProviderTranslations";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone: string }) {
    return (
        <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
                <Icon className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{label}</p>
                <p className="text-lg font-extrabold text-gray-900 dark:text-white">{value}</p>
            </div>
        </div>
    );
}

function BudgetCell({ costCenter, isAdmin, onSaved, t }: { costCenter: any; isAdmin: boolean; onSaved: (name: string, value: number) => void; t: ReturnType<typeof useTranslations> }) {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(String(costCenter.budget ?? ""));
    const [saving, setSaving] = useState(false);

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
                    <button onClick={() => setEditing(true)} className="text-gray-400 hover:text-brand-deep" title={t("editBudgetTooltip")}>
                        <Pencil className="w-3.5 h-3.5" />
                    </button>
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

export default function CostCenterBudgetsBoard() {
    const t = useProviderTranslations("IntelligenceCostCenters");
    const { selectedTenant, userRole, systemRole } = useTenant();
    const { instance, accounts } = useMsal();
    const isAdmin = userRole === "Admin" || userRole === "Owner" || systemRole === "SUPERADMIN";

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

    const handleBudgetSaved = (name: string, value: number) => {
        mutate({
            ...data,
            costCenters: costCenters.map((c) => c.name === name
                ? { ...c, budget: value, pctUsed: value > 0 ? Number(((c.currentMonthCost / value) * 100).toFixed(1)) : null, overBudget: c.currentMonthCost > value }
                : c),
        }, false);
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Kpi label={t("kpiSpend")} value={fmtUsd(data?.totalSpend)} icon={Wallet} tone="bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400" />
                <Kpi label={t("kpiBudget")} value={fmtUsd(data?.totalBudget)} icon={Wallet} tone="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" />
                <Kpi label={t("kpiOverBudget")} value={String(data?.overBudgetCount ?? 0)} icon={AlertTriangle} tone="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t("tableTitle", { count: costCenters.length })}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t("groupedByTagPrefix")} <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded">CostCenter</code>{t("groupedByTagSuffix")}
                        {isAdmin ? t("editHintAdmin") : t("editHintReadonly")}
                    </p>
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
                                        <ResizableTh minWidth={140} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("colUsage")}</ResizableTh>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
                                    {paged.map((c) => (
                                        <tr key={c.name} className={c.overBudget ? "bg-red-50/50 dark:bg-red-950/10" : ""}>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm text-right text-gray-700 dark:text-gray-300 tabular-nums">{fmtUsd(c.currentMonthCost)}</td>
                                            <td className={`px-6 py-4 whitespace-normal break-words text-sm text-right tabular-nums ${c.changePct > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                                {c.changePct > 0 ? "+" : ""}{c.changePct}%
                                            </td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm">
                                                <BudgetCell costCenter={c} isAdmin={isAdmin} onSaved={handleBudgetSaved} t={t} />
                                            </td>
                                            <td className="px-6 py-4 whitespace-normal break-words text-sm">
                                                {c.pctUsed === null ? (
                                                    <span className="text-gray-400 text-xs">—</span>
                                                ) : (
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
                                                )}
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
        </div>
    );
}

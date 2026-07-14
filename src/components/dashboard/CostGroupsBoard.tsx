"use client";
import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations, useLocale } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import { Loader2, AlertCircle, DollarSign, MousePointerClick } from "lucide-react";
import { isMockTenant } from "@/lib/mockData";
import CostGroupDetailModal from "@/components/dashboard/CostGroupDetailModal";
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const fmtUsd = (n: number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

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

function Kpi({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-soft/60 dark:bg-slate-800 flex items-center justify-center shrink-0">
                <DollarSign className="w-4.5 h-4.5 text-brand-deep dark:text-brand-bright" />
            </div>
            <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{label}</p>
                <p className="text-lg font-extrabold text-gray-900 dark:text-white">{value}</p>
            </div>
        </div>
    );
}

export default function CostGroupsBoard() {
    const t = useTranslations("CostGroups");
    const locale = useLocale();
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [period, setPeriod] = useState("30d");
    const [groupFilter, setGroupFilter] = useState("all");
    const [openGroup, setOpenGroup] = useState<string | null>(null);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.details || j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/cost-groups?tenantId=${selectedTenant.id}&period=${period}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const groups: any[] = useMemo(() => data?.groups || [], [data]);
    const filtered = useMemo(
        () => (groupFilter === "all" ? groups : groups.filter(g => g.name === groupFilter)),
        [groups, groupFilter]
    );
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filtered, 10);

    const kpis = useMemo(() => {
        const totalCost = groups.reduce((s, g) => s + (g.periodCost || 0), 0);
        const avgDaily = groups.reduce((s, g) => s + (g.avgDailyCost || 0), 0);
        const avgPeriod = groups.length > 0 ? totalCost / groups.length : 0;
        return { avgDaily, totalCost, avgPeriod, count: groups.length };
    }, [groups]);

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
                    <TierLockedNotice requiredTier={parseTierRequiredError(error.message)!} currentTier={(selectedTenant as any)?.tier} featureName="Grupos de Costos" />
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
                        <Kpi label={t("total_cost_period")} value={fmtUsd(kpis.totalCost)} />
                        <Kpi label={t("avg_cost_period")} value={fmtUsd(kpis.avgPeriod)} />
                        <Kpi label={t("cost_groups_count")} value={String(kpis.count)} />
                    </div>

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
                                            <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">{g.name}</td>
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
                />
            )}
        </div>
    );
}

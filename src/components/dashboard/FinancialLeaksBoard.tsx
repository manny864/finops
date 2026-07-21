"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { Loader2, AlertCircle, X } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import CostPieChart from "@/components/CostPieChart";
import ZombieResourcesTable from "@/components/ZombieResourcesTable";

export default function FinancialLeaksBoard() {
    const t = useTranslations("OverviewFinancialLeaks");
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const [dashboardData, setDashboardData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === "default" || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const sub = selectedSubscription && selectedSubscription.toLowerCase() !== "all" ? selectedSubscription : "All";
                const res = await fetch(`/api/dashboard/summary?tenantId=${selectedTenant.id}&subscriptionId=${sub}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || t("errorLoading"));
                if (!cancelled) setDashboardData(json.dashboardData || []);
            } catch (e: any) {
                if (!cancelled) setError(e.message || t("errorLoading"));
            }
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [selectedTenant?.id, selectedSubscription, accounts.length]);

    const breakdown = useMemo(() => {
        const grouped: Record<string, { count: number; savings: number }> = {};
        dashboardData.forEach((item: any) => {
            if (item.issueType !== "cost" || !(item.potentialSavings > 0)) return;
            if (!grouped[item.type]) grouped[item.type] = { count: 0, savings: 0 };
            grouped[item.type].count += 1;
            grouped[item.type].savings += item.potentialSavings;
        });
        return Object.entries(grouped)
            .map(([type, v]) => ({ type, ...v }))
            .sort((a, b) => b.savings - a.savings);
    }, [dashboardData]);

    const totalLeak = breakdown.reduce((s, b) => s + b.savings, 0);

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("calculatingLeaks")}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {t("error")}</h3>
                <p className="text-sm">{error}</p>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">{t("distributionByCategory")}</h3>
                    <p className="text-sm text-ink-soft mb-2">{t("clickSegmentHint")}</p>
                    <CostPieChart data={dashboardData} onSegmentClick={(cat) => setSelectedCategory(cat)} />
                </div>

                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">{t("breakdownByResourceType")}</h3>
                    <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 mb-3">{format(totalLeak)} <span className="text-xs font-normal text-slate-400">{t("totalLeakDetected")}</span></p>
                    <div className="flex-1 overflow-y-auto max-h-[280px] custom-scrollbar">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] text-slate-400 uppercase">
                                    <th className="py-1.5 pr-2">{t("type")}</th>
                                    <th className="py-1.5 pr-2 text-right">{t("resources")}</th>
                                    <th className="py-1.5 text-right">{t("potentialSavings")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                {breakdown.map((b) => (
                                    <tr key={b.type} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => setSelectedCategory(b.type)}>
                                        <td className="py-2 pr-2 font-medium text-slate-700 dark:text-slate-300">{b.type}</td>
                                        <td className="py-2 pr-2 text-right text-slate-500">{b.count}</td>
                                        <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{format(b.savings)}</td>
                                    </tr>
                                ))}
                                {breakdown.length === 0 && (
                                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">{t("noLeaksDetected")}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {selectedCategory && (
                <div className="animate-in slide-in-from-bottom-4 duration-500 card">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-bold text-[var(--brand-deep)]">
                            {t("affectedResources")}: <span className="text-[var(--brand)]">{selectedCategory}</span>
                        </h3>
                        <button onClick={() => setSelectedCategory(null)} className="text-sm text-gray-500 hover:text-[var(--brand-deep)] transition-colors inline-flex items-center gap-1.5">
                            <X className="w-4 h-4" /> {t("clearFilter")}
                        </button>
                    </div>
                    <ZombieResourcesTable forceFilterType={selectedCategory} />
                </div>
            )}
        </div>
    );
}

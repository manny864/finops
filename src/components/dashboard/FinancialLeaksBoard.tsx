"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import CostPieChart from "@/components/CostPieChart";
import ZombieResourcesTable from "@/components/ZombieResourcesTable";
import InfoTooltip from "@/components/InfoTooltip";
import {
    IconDropletDollar,
    IconChartDonut,
    IconAlertTriangle,
    IconFilterOff,
    IconLoader2,
    IconServer,
    IconTag,
} from "@tabler/icons-react";
import { errorMessage } from '@/lib/apiErrors';
import { mapAuditToUnifiedZombieList } from "@/lib/zombieAuditCatalog";

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
                const idToken = accounts[0] ? await getFreshIdToken(instance, accounts[0]) : "";
                const sub = selectedSubscription && selectedSubscription.toLowerCase() !== "all" ? selectedSubscription : "All";
                const auditUrl = `/api/audit/full?tenantId=${selectedTenant.id}${sub !== "All" ? `&subscriptionId=${encodeURIComponent(sub)}` : ""}`;
                
                const res = await fetch(auditUrl, {
                    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
                });
                const json = await res.json();
                
                if (res.ok && json.auditResults) {
                    const items = mapAuditToUnifiedZombieList(json.auditResults);
                    if (!cancelled) setDashboardData(items);
                } else {
                    // Fallback a summary
                    const summaryRes = await fetch(`/api/dashboard/summary?tenantId=${selectedTenant.id}&subscriptionId=${sub}`, {
                        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
                    });
                    const summaryJson = await summaryRes.json();
                    if (!cancelled) setDashboardData(summaryJson.dashboardData || []);
                }
            } catch (e) {
                if (!cancelled) setError(errorMessage(e) || t("errorLoading"));
            }
            if (!cancelled) setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedTenant?.id, selectedSubscription, accounts.length]);

    const breakdown = useMemo(() => {
        const grouped: Record<string, { count: number; savings: number; estimatedCount: number; measuredCount: number }> = {};
        dashboardData.forEach((item: any) => {
            if (item.issueType !== "cost" || !(item.potentialSavings > 0)) return;
            const type = item.type || "Otros";
            if (!grouped[type]) grouped[type] = { count: 0, savings: 0, estimatedCount: 0, measuredCount: 0 };
            grouped[type].count += 1;
            grouped[type].savings += Number(item.potentialSavings) || 0;
            if (item.savingsSource === "cost_management") {
                grouped[type].measuredCount += 1;
            } else {
                grouped[type].estimatedCount += 1;
            }
        });
        return Object.entries(grouped)
            .map(([type, v]) => ({ type, ...v }))
            .sort((a, b) => b.savings - a.savings);
    }, [dashboardData]);

    const totalLeak = breakdown.reduce((s, b) => s + b.savings, 0);

    // Hallazgos sin costo directo facturado (etiquetado, huérfanos sin cargo propio).
    // El módulo los ignoraba por completo: con la tabla de abajo llena, el resumen
    // mostraba $0.00 y "sin fugas detectadas".
    const governanceLeaks = useMemo(() => {
        const grouped: Record<string, number> = {};
        dashboardData.forEach((item: any) => {
            if (item.issueType !== "governance" || item.type === "__skip__") return;
            const type = item.type || "Otros";
            grouped[type] = (grouped[type] || 0) + 1;
        });
        return Object.entries(grouped)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);
    }, [dashboardData]);

    const governanceCount = governanceLeaks.reduce((s, g) => s + g.count, 0);

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <IconLoader2 className="w-8 h-8 animate-spin text-[#0078D4] mb-4 stroke-[2]" />
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    {t("calculatingLeaks")}
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-200 dark:border-red-900/50 flex items-start gap-3">
                <IconAlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5 stroke-[1.5]" />
                <div>
                    <h3 className="font-bold text-sm mb-1">{t("error")}</h3>
                    <p className="text-xs">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6">
            {/* Top Row: Donut Chart + Resource Type Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left Card: Distribution by Category */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <IconChartDonut className="w-5 h-5 text-[#0078D4] stroke-[1.5]" />
                            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                                {t("distributionByCategory")}
                            </h3>
                            <InfoTooltip content="Desglose de fugas financieras y desperdicio detectado por tipo de servicio cloud." />
                        </div>
                        {selectedCategory && (
                            <button
                                type="button"
                                onClick={() => setSelectedCategory(null)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] hover:text-[#0054A6] bg-blue-50/80 dark:bg-blue-950/40 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 transition-colors"
                            >
                                <IconFilterOff className="w-3.5 h-3.5 stroke-[1.5]" />
                                {t("clearFilter")}
                            </button>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                        {t("clickSegmentHint")}
                    </p>
                    <CostPieChart
                        data={dashboardData}
                        selectedCategory={selectedCategory}
                        onSegmentClick={(cat) => setSelectedCategory(cat)}
                    />
                </div>

                {/* Right Card: Breakdown by Resource Type */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <IconDropletDollar className="w-5 h-5 text-[#0078D4] stroke-[1.5]" />
                            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                                {t("breakdownByResourceType")}
                            </h3>
                            <InfoTooltip content={t("tooltip_amount_count")} />
                        </div>
                    </div>

                    <div className="mb-4">
                        <span className="text-3xl font-extrabold text-[#1B2A41] dark:text-slate-100 font-heading">
                            {format(totalLeak)}
                        </span>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 ml-2">
                            {t("totalLeakDetected")}
                        </span>
                        {governanceCount > 0 && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                + {governanceCount} {governanceCount === 1 ? "hallazgo" : "hallazgos"} de
                                gobernanza sin costo directo facturado
                            </p>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-[290px] custom-scrollbar border border-slate-100 dark:border-slate-800/80 rounded-lg">
                        <table className="min-w-full text-xs">
                            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 z-10 border-b border-slate-200 dark:border-slate-700">
                                <tr className="text-left text-[11px] text-slate-500 dark:text-slate-400 font-bold uppercase">
                                    <th className="py-2.5 px-3">{t("type")}</th>
                                    <th className="py-2.5 px-3 text-right">{t("resources")}</th>
                                    <th className="py-2.5 px-3 text-right">{t("potentialSavings")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {breakdown.map((b) => {
                                    const isSelected = selectedCategory === b.type;
                                    const isEstimatedOnly = b.estimatedCount > 0 && b.measuredCount === 0;
                                    return (
                                        <tr
                                            key={b.type}
                                            onClick={() =>
                                                setSelectedCategory(isSelected ? null : b.type)
                                            }
                                            className={`cursor-pointer transition-colors ${
                                                isSelected
                                                    ? "bg-blue-50/70 dark:bg-blue-950/30 font-semibold"
                                                    : "hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                                            }`}
                                        >
                                            <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                                <IconServer className="w-3.5 h-3.5 text-[#0078D4] stroke-[1.5] shrink-0" />
                                                <span className="truncate max-w-[200px]">{b.type}</span>
                                            </td>
                                            <td className="py-2.5 px-3 text-right text-slate-500 dark:text-slate-400 font-semibold">
                                                {b.count}
                                            </td>
                                            <td className="py-2.5 px-3 text-right font-bold text-[#1B2A41] dark:text-sky-400">
                                                {format(b.savings)}
                                                {isEstimatedOnly && (
                                                    <span
                                                        className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 font-normal"
                                                        title={t("tooltip_pricelist_baseline")}
                                                    >
                                                        (est.)
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {governanceLeaks.map((g) => {
                                    const isSelected = selectedCategory === g.type;
                                    return (
                                        <tr
                                            key={`gov-${g.type}`}
                                            onClick={() => setSelectedCategory(isSelected ? null : g.type)}
                                            className={`cursor-pointer transition-colors ${
                                                isSelected
                                                    ? "bg-blue-50/70 dark:bg-blue-950/30 font-semibold"
                                                    : "hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                                            }`}
                                            title="Hallazgo de gobernanza: no tiene costo directo facturado asociado."
                                        >
                                            <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                                <IconTag className="w-3.5 h-3.5 text-amber-500 stroke-[1.5] shrink-0" />
                                                <span className="truncate max-w-[200px]">{g.type}</span>
                                            </td>
                                            <td className="py-2.5 px-3 text-right text-slate-500 dark:text-slate-400 font-semibold">
                                                {g.count}
                                            </td>
                                            <td className="py-2.5 px-3 text-right text-slate-400 dark:text-slate-500">
                                                —
                                            </td>
                                        </tr>
                                    );
                                })}
                                {breakdown.length === 0 && governanceLeaks.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={3}
                                            className="py-8 text-center text-slate-500 dark:text-slate-400 font-semibold"
                                        >
                                            {t("noLeaksDetected")}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Bottom Row: Affected Resources Table (CMP Standard) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <IconDropletDollar className="w-5 h-5 text-[#0078D4] stroke-[1.5]" />
                        <h3 className="text-sm font-heading font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                            {t("affectedResources", { fallback: "Recursos con Fuga Financiera" })}
                        </h3>
                        {selectedCategory && (
                            <span className="text-xs bg-blue-50 dark:bg-blue-950/40 text-[#0078D4] px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 font-semibold">
                                {selectedCategory}
                            </span>
                        )}
                        <InfoTooltip content="Auditoría granular de recursos zombis, discos huérfanos, IPs sin vincular y servicios vacíos que generan costos innecesarios." />
                    </div>
                    {selectedCategory && (
                        <button
                            type="button"
                            onClick={() => setSelectedCategory(null)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:text-[#0054A6] bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 rounded-md border border-blue-200 dark:border-blue-800 transition-colors"
                        >
                            <IconFilterOff className="w-3.5 h-3.5 stroke-[1.5]" />
                            {t("clearFilter")}
                        </button>
                    )}
                </div>
                <ZombieResourcesTable forceFilterType={selectedCategory || undefined} />
            </div>
        </div>
    );
}


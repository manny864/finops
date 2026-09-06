"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import {
    IconLoader2,
    IconAlertCircle,
    IconInfoCircle,
    IconCalendarTime,
    IconTrophy,
    IconBulb,
    IconListDetails
} from "@tabler/icons-react";
import { isMockTenant } from '@/lib/mockData';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import type {
    SavingsPlanVsReservationData,
    TermComparisonItem,
    CommitmentType,
    CommitmentTerm,
    GranularCommitmentRecommendationItem
} from "@/types/commitmentComparison.types";
import CommitmentRecommendationsDrilldownModal from "@/components/optimization/CommitmentRecommendationsDrilldownModal";

export default function CommitmentSimulatorDashboard() {
    const t = useTranslations("CommitmentSimulator");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();

    const [drilldownState, setDrilldownState] = useState<{
        type: CommitmentType;
        term: CommitmentTerm;
        termDisplayName: string;
        totalSavingsUSD: number;
        coveragePercentage: number;
        items: GranularCommitmentRecommendationItem[];
    } | null>(null);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" },
        });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || t("error"));
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/commitment-simulator?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <IconLoader2 className="w-8 h-8 animate-spin text-[#0054A6] dark:text-[#38BDF8] mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
            </div>
        );
    }
    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t("featureName")} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><IconAlertCircle className="w-4 h-4" /> {t("error")}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }
    if (!data || data.success === false) {
        return (
            <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 p-4 rounded-lg border border-blue-100 dark:border-blue-900/50">
                <IconInfoCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{data?.error || t("empty")}</p>
            </div>
        );
    }

    // Adaptación coherente de datos tipados (soporta payload v1 y v2 tipado)
    const comparison: SavingsPlanVsReservationData | null = data.comparisonData || (data.reservation && data.savingsPlan ? {
        evaluatedSubscriptionsCount: data.subscriptionsEvaluated || 1,
        oneYearComparison: {
            term: "1_YEAR",
            termDisplayName: t("term1y"),
            winner: data.verdict?.oneYear === "reservation" ? "RESERVATION" : data.verdict?.oneYear === "savingsPlan" ? "SAVINGS_PLAN" : "TIED",
            winnerBadgeText: data.verdict?.oneYear === "reservation" ? t("winnerRI") : data.verdict?.oneYear === "savingsPlan" ? t("winnerSP") : t("none"),
            reservationOption: {
                monthlySavingsUSD: data.reservation.oneYear.monthlySavings || 0,
                recommendationsCount: data.reservation.oneYear.recommendations || 0,
                savingsPercentage: 0,
                coveragePercentage: 100,
                isWinner: data.verdict?.oneYear === "reservation",
                items: [],
            },
            savingsPlanOption: {
                monthlySavingsUSD: data.savingsPlan.oneYear.monthlySavings || 0,
                recommendationsCount: data.savingsPlan.oneYear.monthlySavings > 0 ? 1 : 0,
                savingsPercentage: data.savingsPlan.oneYear.savingsPct || 0,
                coveragePercentage: data.savingsPlan.oneYear.coveragePct || 0,
                isWinner: data.verdict?.oneYear === "savingsPlan",
                items: [],
            },
        },
        threeYearComparison: {
            term: "3_YEARS",
            termDisplayName: t("term3y"),
            winner: data.verdict?.threeYear === "reservation" ? "RESERVATION" : data.verdict?.threeYear === "savingsPlan" ? "SAVINGS_PLAN" : "TIED",
            winnerBadgeText: data.verdict?.threeYear === "reservation" ? t("winnerRI") : data.verdict?.threeYear === "savingsPlan" ? t("winnerSP") : t("none"),
            reservationOption: {
                monthlySavingsUSD: data.reservation.threeYear.monthlySavings || 0,
                recommendationsCount: data.reservation.threeYear.recommendations || 0,
                savingsPercentage: 0,
                coveragePercentage: 100,
                isWinner: data.verdict?.threeYear === "reservation",
                items: [],
            },
            savingsPlanOption: {
                monthlySavingsUSD: data.savingsPlan.threeYear.monthlySavings || 0,
                recommendationsCount: data.savingsPlan.threeYear.monthlySavings > 0 ? 1 : 0,
                savingsPercentage: data.savingsPlan.threeYear.savingsPct || 0,
                coveragePercentage: data.savingsPlan.threeYear.coveragePct || 0,
                isWinner: data.verdict?.threeYear === "savingsPlan",
                items: [],
            },
        },
        bestPracticeInsightMarkdown: "Las **reservas** dan el mayor ahorro para cargas estables en una instancia/región fija. Los **Savings Plans** son más flexibles (cualquier región/familia) y convienen para cargas cambiantes. Primero **rightsizing**, después comprometer.",
        lastEvaluatedAtIso: new Date().toISOString(),
    } : null);

    if (!data.hasData && (!comparison || (comparison.oneYearComparison.reservationOption.monthlySavingsUSD === 0 && comparison.threeYearComparison.savingsPlanOption.monthlySavingsUSD === 0))) {
        return (
            <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 p-4 rounded-lg border border-blue-100 dark:border-blue-900/50">
                <IconInfoCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{t("noRecs")}</p>
            </div>
        );
    }

    const items: TermComparisonItem[] = comparison
        ? [comparison.oneYearComparison, comparison.threeYearComparison]
        : [];

    const renderWinnerBadge = (item: TermComparisonItem) => {
        if (item.winner === "RESERVATION") {
            return (
                <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/80">
                    <IconTrophy size={13} className="inline mr-1" />
                    {t("winnerRI")}
                </span>
            );
        }
        if (item.winner === "SAVINGS_PLAN") {
            return (
                <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-800/80">
                    <IconTrophy size={13} className="inline mr-1" />
                    {t("winnerSP")}
                </span>
            );
        }
        if (item.reservationOption.monthlySavingsUSD === 0 && item.savingsPlanOption.monthlySavingsUSD === 0) {
            return (
                <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200 dark:bg-slate-800 dark:text-gray-400 dark:border-slate-700">
                    {t("none")}
                </span>
            );
        }
        return (
            <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:border-slate-700">
                {t("tie")}
            </span>
        );
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {items.map((item) => {
                    const isRiWinner = item.reservationOption.isWinner;
                    const isSpWinner = item.savingsPlanOption.isWinner;

                    return (
                        <div
                            key={item.term}
                            className="p-5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                                    <IconCalendarTime className="w-4 h-4 text-[#0054A6] dark:text-[#38BDF8]" />
                                    <span>{item.termDisplayName}</span>
                                </div>
                                {renderWinnerBadge(item)}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Reserva (RI) */}
                                <div
                                    onClick={() => {
                                        setDrilldownState({
                                            type: "RESERVATION",
                                            term: item.term,
                                            termDisplayName: item.termDisplayName,
                                            totalSavingsUSD: item.reservationOption.monthlySavingsUSD,
                                            coveragePercentage: item.reservationOption.coveragePercentage,
                                            items: item.reservationOption.items || [],
                                        });
                                    }}
                                    title={t("clickBreakdown")}
                                    className={`p-4 rounded-xl border transition-all cursor-pointer hover:border-[#0078D4] dark:hover:border-sky-400/60 ${
                                        isRiWinner
                                            ? "border-[#0078D4] dark:border-[#0078D4] bg-blue-50/20 dark:bg-slate-800/40 shadow-sm"
                                            : "border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                                    }`}
                                >
                                    <div className="text-xs text-gray-500 dark:text-slate-400 mb-1 font-medium">
                                        {t("reservation")}
                                    </div>
                                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                                        {format(item.reservationOption.monthlySavingsUSD)}
                                    </div>
                                    <div className="text-xs text-gray-400 dark:text-slate-400">
                                        {t("perMonth")}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-slate-300 font-medium mt-2 flex items-center justify-between">
                                        <span>
                                            {item.reservationOption.recommendationsCount} {t("recs")}
                                        </span>
                                        <IconListDetails size={13} className="text-[#0078D4] dark:text-[#38BDF8] shrink-0" />
                                    </div>
                                </div>

                                {/* Savings Plan */}
                                <div
                                    onClick={() => {
                                        setDrilldownState({
                                            type: "SAVINGS_PLAN",
                                            term: item.term,
                                            termDisplayName: item.termDisplayName,
                                            totalSavingsUSD: item.savingsPlanOption.monthlySavingsUSD,
                                            coveragePercentage: item.savingsPlanOption.coveragePercentage,
                                            items: item.savingsPlanOption.items || [],
                                        });
                                    }}
                                    title={t("clickBreakdown")}
                                    className={`p-4 rounded-xl border transition-all cursor-pointer hover:border-[#0078D4] dark:hover:border-sky-400/60 ${
                                        isSpWinner
                                            ? "border-[#0078D4] dark:border-[#0078D4] bg-blue-50/20 dark:bg-slate-800/40 shadow-sm"
                                            : "border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                                    }`}
                                >
                                    <div className="text-xs text-gray-500 dark:text-slate-400 mb-1 font-medium">
                                        {t("savingsPlan")}
                                    </div>
                                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                                        {format(item.savingsPlanOption.monthlySavingsUSD)}
                                    </div>
                                    <div className="text-xs text-gray-400 dark:text-slate-400">
                                        {t("perMonth")}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-slate-300 font-medium mt-2 flex items-center justify-between">
                                        <span>
                                            {Number(item.savingsPlanOption.savingsPercentage).toFixed(1)}% {t("savingsPct")} ·{" "}
                                            {Number(item.savingsPlanOption.coveragePercentage).toFixed(1)}% {t("coverage")}
                                        </span>
                                        <IconListDetails size={13} className="text-[#0078D4] dark:text-[#38BDF8] shrink-0 ml-1" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Banner Inferior de Buenas Prácticas FinOps */}
            <div className="flex items-start gap-3 bg-blue-50/60 dark:bg-slate-900 border border-blue-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
                <IconBulb size={18} className="text-[#0054A6] dark:text-[#38BDF8] shrink-0 mt-0.5" />
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {t.rich("riVsSpExplainer", { b: (c) => <strong className="font-semibold text-slate-900 dark:text-white">{c}</strong> })}
                </p>
            </div>

            {/* Nota de pie de página */}
            <p className="text-xs text-gray-400 dark:text-slate-400">
                {t("source", { subs: comparison?.evaluatedSubscriptionsCount || data.subscriptionsEvaluated || 1 })}
            </p>

            {/* Modal de Inspección Detallada (Drilldown) */}
            {drilldownState && (
                <CommitmentRecommendationsDrilldownModal
                    isOpen={Boolean(drilldownState)}
                    onClose={() => setDrilldownState(null)}
                    type={drilldownState.type}
                    term={drilldownState.term}
                    termDisplayName={drilldownState.termDisplayName}
                    totalSavingsUSD={drilldownState.totalSavingsUSD}
                    coveragePercentage={drilldownState.coveragePercentage}
                    items={drilldownState.items}
                />
            )}
        </div>
    );
}



"use client";
import React from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { Loader2, AlertCircle, Info, PiggyBank, CalendarClock } from "lucide-react";
import { isMockTenant } from '@/lib/mockData';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

type TermData = {
    reservation: { monthlySavings: number; recommendations: number };
    savingsPlan: { monthlySavings: number; savingsPct: number; coveragePct: number; hourlyCommitment: number };
    verdict: "reservation" | "savingsPlan" | "tie" | "none";
};

export default function CommitmentSimulatorDashboard() {
    const t = useTranslations("CommitmentSimulator");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${idToken}`, "x-tenant-id": selectedTenant?.id ?? "" },
        });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || "Error");
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
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
            </div>
        );
    }
    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="Simulador de Compromisos" />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }
    if (!data || data.success === false) {
        return (
            <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 p-4 rounded-lg border border-blue-100 dark:border-blue-900/50">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{data?.error || t("empty")}</p>
            </div>
        );
    }

    const terms: Array<{ key: "oneYear" | "threeYear"; label: string; d: TermData }> = [
        { key: "oneYear", label: t("term1y"), d: { reservation: data.reservation.oneYear, savingsPlan: data.savingsPlan.oneYear, verdict: data.verdict.oneYear } },
        { key: "threeYear", label: t("term3y"), d: { reservation: data.reservation.threeYear, savingsPlan: data.savingsPlan.threeYear, verdict: data.verdict.threeYear } },
    ];

    if (!data.hasData) {
        return (
            <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 p-4 rounded-lg border border-blue-100 dark:border-blue-900/50">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{t("noRecs")}</p>
            </div>
        );
    }

    const verdictBadge = (v: TermData["verdict"]) => {
        if (v === "savingsPlan") return { text: t("winnerSP"), cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" };
        if (v === "reservation") return { text: t("winnerRI"), cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
        if (v === "tie") return { text: t("tie"), cls: "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300" };
        return { text: t("none"), cls: "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400" };
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {terms.map(({ key, label, d }) => {
                    const badge = verdictBadge(d.verdict);
                    return (
                        <div key={key} className="p-5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                                    <CalendarClock className="w-4 h-4" /> {label}
                                </div>
                                <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge.cls}`}>{badge.text}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Reserva */}
                                <div className={`p-3 rounded-lg border ${d.verdict === "reservation" ? "border-emerald-300 dark:border-emerald-700" : "border-gray-100 dark:border-slate-800"}`}>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("reservation")}</div>
                                    <div className="text-xl font-bold text-gray-900 dark:text-white">{format(d.reservation.monthlySavings)}</div>
                                    <div className="text-xs text-gray-400">{t("perMonth")}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{d.reservation.recommendations} {t("recs")}</div>
                                </div>
                                {/* Savings Plan */}
                                <div className={`p-3 rounded-lg border ${d.verdict === "savingsPlan" ? "border-indigo-300 dark:border-indigo-700" : "border-gray-100 dark:border-slate-800"}`}>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("savingsPlan")}</div>
                                    <div className="text-xl font-bold text-gray-900 dark:text-white">{format(d.savingsPlan.monthlySavings)}</div>
                                    <div className="text-xs text-gray-400">{t("perMonth")}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {d.savingsPlan.savingsPct}% {t("savingsPct")} · {d.savingsPlan.coveragePct}% {t("coverage")}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Guía de decisión */}
            <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-200 p-4 rounded-lg border border-amber-100 dark:border-amber-900/40">
                <PiggyBank className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{t("guidance")}</p>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500">{t("source", { subs: data.subscriptionsEvaluated })}</p>
        </div>
    );
}

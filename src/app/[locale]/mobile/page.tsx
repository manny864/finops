"use client";
/**
 * Resumen móvil (home de la app): los 4 números que se miran desde el
 * teléfono — costo del mes, proyección, ahorro potencial y zombies — en
 * tarjetas grandes mobile-first, más accesos rápidos.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { TrendingUp, PiggyBank, Ghost, DollarSign, BellRing, LifeBuoy, RefreshCw, Lightbulb } from "lucide-react";

interface Summary {
    actualCost: number;
    projectedCost: number;
    totalSavings: number;
    zombieCount: number;
}

const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function MobileSummaryPage() {
    const t = useTranslations("Mobile");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const isMock = isMockTenant(selectedTenant?.id || "");

    const load = useCallback(async () => {
        if (!selectedTenant?.id || selectedTenant.id === "default") {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(false);
        try {
            if (isMock) {
                setSummary(getMockDataForRoute("mobile-summary", (selectedTenant as { tier?: string }).tier || selectedTenant.id));
                return;
            }
            if (accounts.length === 0) return;
            const token = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch(`/api/dashboard/summary?tenantId=${selectedTenant.id}&subscriptionId=All`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setSummary({
                actualCost: Number(json.actualCost || 0),
                projectedCost: Number(json.projectedCost || 0),
                totalSavings: Number(json.totalSavings || 0),
                zombieCount: Number(json.zombieCount || 0),
            });
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [selectedTenant, isMock, accounts, instance]);

    useEffect(() => {
        load();
    }, [load]);

    const cards = summary ? [
        { icon: DollarSign, label: t("monthCost"), value: fmt(summary.actualCost), tone: "text-ink dark:text-white" },
        { icon: TrendingUp, label: t("forecast"), value: fmt(summary.projectedCost), tone: "text-amber-600" },
        { icon: PiggyBank, label: t("potentialSavings"), value: fmt(summary.totalSavings), tone: "text-emerald-600" },
        { icon: Ghost, label: t("zombies"), value: String(summary.zombieCount), tone: summary.zombieCount > 0 ? "text-red-600" : "text-emerald-600" },
    ] : [];

    return (
        <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-2xl font-extrabold text-ink dark:text-white font-heading">{t("summaryTitle")}</h1>
                    <p className="text-sm text-ink-soft dark:text-gray-400 mt-0.5">{selectedTenant?.name || ""}</p>
                </div>
                <button onClick={load} aria-label={t("refresh")} className="p-2.5 rounded-full bg-surface-2 dark:bg-slate-800 text-ink-soft dark:text-gray-300">
                    <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            {loading ? (
                <div className="grid grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className="h-28 rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
                    ))}
                </div>
            ) : error ? (
                <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 p-5 text-center">
                    <p className="text-base text-red-700 dark:text-red-400 font-semibold">{t("errorLoading")}</p>
                    <button onClick={load} className="mt-3 px-4 py-2 rounded-lg bg-brand-deep text-white text-sm font-bold">
                        {t("retry")}
                    </button>
                </div>
            ) : summary ? (
                <div className="grid grid-cols-2 gap-3">
                    {cards.map(({ icon: Icon, label, value, tone }) => (
                        <div key={label} className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4 shadow-sm">
                            <Icon className="w-5 h-5 text-brand-deep dark:text-brand-sky mb-2" />
                            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-gray-400">{label}</div>
                            <div className={`text-2xl font-extrabold mt-1 font-heading ${tone}`}>{value}</div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-base text-ink-soft text-center py-10">{t("noData")}</p>
            )}

            {/* Accesos rápidos */}
            <div className="mt-6 flex flex-col gap-2.5">
                <Link href="/mobile/alerts" className="flex items-center gap-3 rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4 shadow-sm active:bg-surface-2">
                    <BellRing className="w-6 h-6 text-brand-deep dark:text-brand-sky shrink-0" />
                    <div>
                        <div className="text-base font-bold text-ink dark:text-white">{t("quickAlerts")}</div>
                        <div className="text-sm text-ink-soft dark:text-gray-400">{t("quickAlertsDesc")}</div>
                    </div>
                </Link>
                <Link href="/advisor" className="flex items-center gap-3 rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4 shadow-sm active:bg-surface-2">
                    <Lightbulb className="w-6 h-6 text-amber-500 shrink-0" />
                    <div>
                        <div className="text-base font-bold text-ink dark:text-white">{t("quickAdvisor")}</div>
                        <div className="text-sm text-ink-soft dark:text-gray-400">{t("quickAdvisorDesc")}</div>
                    </div>
                </Link>
                <Link href="/support" className="flex items-center gap-3 rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4 shadow-sm active:bg-surface-2">
                    <LifeBuoy className="w-6 h-6 text-brand-deep dark:text-brand-sky shrink-0" />
                    <div>
                        <div className="text-base font-bold text-ink dark:text-white">{t("quickSupport")}</div>
                        <div className="text-sm text-ink-soft dark:text-gray-400">{t("quickSupportDesc")}</div>
                    </div>
                </Link>
            </div>
        </div>
    );
}

"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { Loader2, HardDrive, TrendingDown, AlertCircle, Info } from "lucide-react";
import { isMockTenant } from '@/lib/mockData';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const TIER_COLORS: Record<string, string> = {
    hot:     "bg-orange-400",
    cool:    "bg-blue-400",
    cold:    "bg-cyan-400",
    archive: "bg-slate-400",
};
const TIER_TEXT_COLORS: Record<string, string> = {
    hot:     "text-orange-600 dark:text-orange-400",
    cool:    "text-blue-600 dark:text-blue-400",
    cold:    "text-cyan-600 dark:text-cyan-400",
    archive: "text-slate-600 dark:text-slate-400",
};

export default function StorageEfficiencyDashboard() {
    const t = useTranslations("StorageEfficiency");
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const [days] = useState(30);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${idToken}`,
                "x-tenant-id": selectedTenant?.id ?? "",
            },
        });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || "Error al cargar datos");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/storage-efficiency?tenantId=${selectedTenant.id}&days=${days}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Analizando eficiencia de almacenamiento...</p>
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

    if (!data) return null;

    const tiers: Record<string, { percent: number; gb: number; cost: number }> = data.tiers || {};
    const tierKeys = ["hot", "cool", "cold", "archive"] as const;

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {data.mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <span className="font-bold mr-2 px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 rounded text-xs">{tm("badge")}</span>
                        {tm("description")}
                    </div>
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t("costPerGb")}</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                        {format(data.costPerGb ?? 0, { fractionDigits: 5 })}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">por GB / mes</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t("totalGb")}</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                        {(data.totalGb ?? 0).toLocaleString()} GB
                    </p>
                    <p className="text-xs text-slate-400 mt-1">almacenamiento total</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Costo Total</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                        {format(data.totalCost ?? 0)}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">últimos {days} días</p>
                </div>
            </div>

            {/* Stacked Bar + Distribution */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-blue-500" />
                    {t("distribution")}
                </h3>
                {/* Stacked bar */}
                <div className="flex h-10 rounded-lg overflow-hidden mb-6">
                    {tierKeys.map((tier) => {
                        const pct = tiers[tier]?.percent ?? 0;
                        return pct > 0 ? (
                            <div
                                key={tier}
                                className={`${TIER_COLORS[tier]} flex items-center justify-center text-white text-xs font-bold transition-all`}
                                style={{ width: `${pct}%` }}
                                title={`${tier}: ${pct}%`}
                            >
                                {pct > 8 ? `${pct}%` : ""}
                            </div>
                        ) : null;
                    })}
                </div>
                {/* Legend + table */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {tierKeys.map((tier) => {
                        const d = tiers[tier] || { percent: 0, gb: 0, cost: 0 };
                        return (
                            <div key={tier} className="rounded-lg border border-gray-100 dark:border-slate-800 p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className={`w-3 h-3 rounded-sm ${TIER_COLORS[tier]}`} />
                                    <span className={`text-xs font-bold uppercase ${TIER_TEXT_COLORS[tier]}`}>{t(tier as "hot" | "cool" | "cold" | "archive")}</span>
                                </div>
                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{d.gb.toLocaleString()} GB</p>
                                <p className="text-xs text-slate-500">{format(d.cost)}</p>
                                <p className="text-xs text-slate-400">{d.percent}%</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Recommendation */}
            {data.recommendation && (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-2">
                        <TrendingDown className="w-4 h-4" />
                        {t("recommendation")}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">GB movibles</p>
                            <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{data.recommendation.movableGb.toLocaleString()} GB</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                                De <span className="font-semibold uppercase">{data.recommendation.fromTier}</span> → <span className="font-semibold uppercase">{data.recommendation.toTier}</span>
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t("potentialSavings")}</p>
                            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{format(data.recommendation.potentialSavings)}</p>
                            <p className="text-xs text-slate-500 mt-0.5">ahorro mensual estimado</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t("description")}</p>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                                Mover datos de acceso infrecuente a niveles de menor costo reduce el gasto sin impacto operativo.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

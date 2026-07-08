"use client";
import React from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { Loader2, Cpu, TrendingDown, TrendingUp, AlertCircle, Info } from "lucide-react";
import { isMockTenant } from '@/lib/mockData';

export default function ComputeEfficiencyDashboard() {
    const t = useTranslations("ComputeEfficiency");
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();

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
            ? `/api/intelligence/compute-cost-per-core?tenantId=${selectedTenant.id}&days=30`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Calculando costo por núcleo...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const vssBenchmark = data.costPerCore < data.benchmark;
    const delta = Math.abs(data.costPerCore - data.benchmark).toFixed(2);
    const trendData: { month: string; costPerCore: number }[] = data.trend || [];

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

            {/* Hero KPI */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{t("costPerCore")}</p>
                        <p className="text-4xl font-bold text-slate-900 dark:text-white">
                            {format(data.costPerCore)}
                            <span className="text-base font-normal text-slate-500 dark:text-slate-400 ml-1">/core</span>
                        </p>
                        <div className="flex items-center gap-1 mt-2">
                            {vssBenchmark ? (
                                <TrendingDown className="w-4 h-4 text-emerald-500" />
                            ) : (
                                <TrendingUp className="w-4 h-4 text-red-500" />
                            )}
                            <span className={`text-sm font-semibold ${vssBenchmark ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                                {format(Number(delta))} {vssBenchmark ? "bajo" : "sobre"} benchmark
                            </span>
                            <span className="text-xs text-slate-400 ml-1">(benchmark: {format(data.benchmark)})</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        <div className="text-center">
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t("totalCores")}</p>
                            <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{data.totalCores}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-slate-500 dark:text-slate-400">{t("effective")}</p>
                            <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{format(data.effectiveCost)}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-slate-500 dark:text-slate-400">Sin compromisos</p>
                            <p className="text-xl font-bold text-slate-600 dark:text-slate-400">{format(data.costPerCoreNoCommitments)}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-slate-500 dark:text-slate-400">Ahorro compromisos</p>
                            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{data.savingsFromCommitments}%</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Trend sparkline */}
            {trendData.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-indigo-500" />
                        {t("trend")}
                    </h3>
                    <div className="flex items-end gap-2 h-16">
                        {(() => {
                            const max = Math.max(...trendData.map((d) => d.costPerCore));
                            return trendData.map((d, i) => (
                                <div key={i} className="flex flex-col items-center flex-1 gap-1">
                                    <div
                                        className="w-full bg-indigo-400 dark:bg-indigo-500 rounded-t transition-all"
                                        style={{ height: `${max > 0 ? (d.costPerCore / max) * 48 : 0}px` }}
                                        title={`${d.month}: ${format(d.costPerCore)}`}
                                    />
                                    <span className="text-[10px] text-slate-400 truncate">{d.month.slice(5)}</span>
                                </div>
                            ));
                        })()}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* By Region */}
                {data.byRegion?.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("byRegion")}</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-2 font-semibold">Región</th>
                                        <th className="px-4 py-2 font-semibold text-right">Cores</th>
                                        <th className="px-4 py-2 font-semibold text-right">$/Core</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                    {data.byRegion.map((r: { region: string; cores: number; costPerCore: number }, i: number) => (
                                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                            <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">{r.region}</td>
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{r.cores}</td>
                                            <td className="px-4 py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{format(r.costPerCore)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* By SKU */}
                {data.bySku?.length > 0 && (
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("bySku")}</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-2 font-semibold">SKU</th>
                                        <th className="px-4 py-2 font-semibold text-right">Cores</th>
                                        <th className="px-4 py-2 font-semibold text-right">Costo</th>
                                        <th className="px-4 py-2 font-semibold text-right">$/Core</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                    {data.bySku.map((s: { sku: string; cores: number; cost: number; costPerCore: number }, i: number) => (
                                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                            <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{s.sku}</td>
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{s.cores}</td>
                                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-400">{format(s.cost)}</td>
                                            <td className="px-4 py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{format(s.costPerCore)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

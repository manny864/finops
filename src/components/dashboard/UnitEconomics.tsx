"use client";
import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { Loader2, TrendingDown, TrendingUp, Users, Activity, Settings2 } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { useCurrency } from '@/components/CurrencyProvider';
import { isMockTenant } from '@/lib/mockData';
import { useTranslations } from 'next-intl';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import { useProviderTranslations } from "@/lib/useProviderTranslations";

export default function UnitEconomics() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const t = useProviderTranslations("UnitEconomics");
    const [dauInput, setDauInput] = useState('');
    const [savingDau, setSavingDau] = useState(false);
    const [showDauForm, setShowDauForm] = useState(false);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ['User.Read']);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || t("fetch_error"));
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/intelligence/unit-economics?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const saveDau = async () => {
        const dau = parseInt(dauInput, 10);
        if (!dau || dau <= 0 || !selectedTenant) return;
        setSavingDau(true);
        try {
            const account = accounts[0];
            const idToken = account ? await getFreshIdToken(instance, account, ['User.Read']) : null;
            await fetch('/api/intelligence/unit-economics', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
                },
                body: JSON.stringify({ tenantId: selectedTenant.id, estimatedDau: dau })
            });
            setShowDauForm(false);
            setDauInput('');
            await mutate();
        } catch (e) {
            console.error('Error saving DAU', e);
        }
        setSavingDau(false);
    };

    const metrics = useMemo(() => {
        const rawData = data?.data?.rows;
        if (!rawData || rawData.length === 0) return null;

        const totalCost = rawData.reduce((acc: number, curr: any) => acc + (curr.cost || 0), 0);
        const dauRows = rawData.filter((d: any) => d.dau != null && d.dau > 0);
        const hasDau = dauRows.length > 0;

        let avgCostPerUser = 0;
        let trendPercent = 0;

        if (hasDau) {
            const totalDauSum = dauRows.reduce((acc: number, curr: any) => acc + curr.dau, 0);
            const totalCostWithDau = dauRows.reduce((acc: number, curr: any) => acc + curr.cost, 0);
            avgCostPerUser = totalDauSum > 0 ? totalCostWithDau / totalDauSum : 0;

            const half = Math.floor(dauRows.length / 2);
            if (half > 0) {
                const firstH = dauRows.slice(0, half);
                const secondH = dauRows.slice(half);
                const cpuFirst = firstH.reduce((a: number, c: any) => a + c.cost, 0) / Math.max(1, firstH.reduce((a: number, c: any) => a + (c.dau || 0), 0));
                const cpuSecond = secondH.reduce((a: number, c: any) => a + c.cost, 0) / Math.max(1, secondH.reduce((a: number, c: any) => a + (c.dau || 0), 0));
                if (cpuFirst > 0) trendPercent = ((cpuSecond - cpuFirst) / cpuFirst) * 100;
            }
        }

        const chartData = rawData.map((d: any) => ({
            ...d,
            costDisplay: Number((d.cost || 0).toFixed(2)),
            costPerUserDollars: d.costPerUser != null ? Number((d.costPerUser).toFixed(4)) : null,
        }));

        return {
            avgCostPerUser, trendPercent, totalCost, hasDau, chartData,
            estimatedDau: data?.data?.estimatedDau || 0
        };
    }, [data]);

    if (!selectedTenant || selectedTenant.id === 'default') return null;

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
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="Unit Economics" />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold">{t("processing_error_title")}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!metrics) {
        return (
            <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">{t("no_data")}</p>
            </div>
        );
    }

    const isTrendGood = metrics.trendPercent <= 0;

    return (
        <div className="w-full space-y-6">

            {/* Banner cuando no hay DAU configurado */}
            {!metrics.hasDau && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3">
                    <Settings2 className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="font-semibold text-amber-800 dark:text-amber-300 text-sm">{t("dau_not_configured_title")}</p>
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                            {t("dau_not_configured_desc")}
                        </p>
                        {!showDauForm ? (
                            <button onClick={() => setShowDauForm(true)} className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300 underline">
                                {t("configure_dau_cta")}
                            </button>
                        ) : (
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                                <input
                                    type="number" min={1} value={dauInput}
                                    onChange={e => setDauInput(e.target.value)}
                                    placeholder={t("dau_input_placeholder")}
                                    className="border border-amber-300 rounded-lg px-3 py-1.5 text-sm w-32 dark:bg-slate-800 dark:border-amber-700 dark:text-white"
                                />
                                <span className="text-xs text-amber-700 dark:text-amber-400">{t("users_per_day")}</span>
                                <button
                                    onClick={saveDau} disabled={savingDau || !dauInput}
                                    className="bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50"
                                >
                                    {savingDau ? t("saving") : t("save")}
                                </button>
                                <button onClick={() => setShowDauForm(false)} className="text-xs text-amber-600 underline">{t("cancel")}</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Users className="w-16 h-16 text-brand-deep" />
                    </div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{t("avg_cost_per_user")}</p>
                    {metrics.hasDau ? (
                        <>
                            <p className="text-3xl font-black text-gray-900 dark:text-white z-10">{format(metrics.avgCostPerUser)}</p>
                            <div className="mt-4 flex items-center text-sm z-10">
                                <span className={`flex items-center font-bold px-2 py-0.5 rounded-full ${isTrendGood ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                                    {isTrendGood ? <TrendingDown className="w-4 h-4 mr-1" /> : <TrendingUp className="w-4 h-4 mr-1" />}
                                    {Math.abs(metrics.trendPercent).toFixed(1)}%
                                </span>
                                <span className="ml-2 text-gray-500 dark:text-gray-400">{isTrendGood ? t("efficient_trend") : t("inefficient_alert")}</span>
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 z-10">
                                <Settings2 className="w-3 h-3" />
                                {t("estimated_dau_label", { value: metrics.estimatedDau.toLocaleString() })}
                                <button onClick={() => setShowDauForm(true)} className="underline">{t("edit")}</button>
                            </div>
                        </>
                    ) : (
                        <p className="text-lg font-bold text-gray-400 mt-2">{t("no_dau_configured")}</p>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{t("total_cost_30d")}</p>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{format(metrics.totalCost)}</p>
                </div>
            </div>

            {/* Chart */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
                    <Activity className="w-5 h-5 text-brand-deep" />
                    {t("chart_title")}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    {metrics.hasDau
                        ? t("chart_desc_with_dau")
                        : t("chart_desc_no_dau")}
                </p>
                <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={metrics.chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                            <XAxis dataKey="date" tickFormatter={(v) => v.split('-').slice(1).join('/')} stroke="#9CA3AF" tick={{ fill: '#6B7280', fontSize: 12 }} />
                            <YAxis yAxisId="left" tickFormatter={(v) => format(v, { compact: true })} stroke="#9CA3AF" tick={{ fill: '#6B7280', fontSize: 12 }} />
                            {metrics.hasDau && (
                                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}¢`} stroke="#9CA3AF" tick={{ fill: '#6B7280', fontSize: 12 }} />
                            )}
                            <Tooltip
                                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                formatter={(value: any, name: any) => {
                                    if (name === t("series_cloud_cost")) return [format(value), name];
                                    if (name === t("series_cost_per_user_cents")) return [format(value), name];
                                    return [value, name];
                                }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Bar yAxisId="left" dataKey="costDisplay" name={t("series_cloud_cost")} fill="#E0E7FF" radius={[4, 4, 0, 0]} />
                            {metrics.hasDau && (
                                <Line yAxisId="right" type="monotone" dataKey="costPerUserDollars" name={t("series_cost_per_user_cents")} stroke="#0054A6" strokeWidth={3} dot={{ r: 3, fill: '#0054A6', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} connectNulls={false} />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

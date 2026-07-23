"use client";
import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { Loader2, Target, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { hasAccess } from '@/lib/tierLogic';
import PremiumBanner from '@/components/PremiumBanner';
import { isMockTenant } from '@/lib/mockData';

const CATEGORY_COLORS: Record<string, string> = {
    Cost: '#00aeef',
    Performance: '#a855f7',
    Reliability: '#f59e0b',
    Security: '#ef4444',
};

export default function CoinDashboard() {
    const t = useTranslations('IntelligenceOptimizationIndex');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';
    const isPro = hasAccess(tier, 'Professional');

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ['User.Read']);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || t('errorLoading'));
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (isPro && selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/intelligence/kpis/coin?tenantId=${selectedTenant.id}&days=90`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const gaugeColor = useMemo(() => {
        const c = data?.coin ?? 0;
        if (c >= 70) return '#10b981';
        if (c >= 40) return '#f59e0b';
        return '#ef4444';
    }, [data?.coin]);

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (!isPro) {
        return (
            <PremiumBanner
                title={t('title')}
                description={t('premiumDescription')}
                requiredTier="Professional"
                icon="zap"
            />
        );
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500">{t('calculating')}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100">
                <p className="font-bold">{t('errorLabel', { message: error.message })}</p>
            </div>
        );
    }

    if (!data || data.total === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-8 text-center">
                <Target className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('noManagedRecommendationsTitle')}</h3>
                <p className="text-gray-500 mt-2">{t('noManagedRecommendationsDescription')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Gauge / score principal */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm flex flex-col items-center justify-center">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400 mb-3">
                        <Target className="w-5 h-5" />
                    </div>
                    <p className="text-6xl font-extrabold" style={{ color: gaugeColor }}>{data.coin}%</p>
                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 mt-2">{t('coinLastDays', { days: data.windowDays })}</p>
                    <p className="text-xs text-gray-400 mt-1">{t('implementedOfTotal', { implemented: data.implemented, total: data.total })}</p>
                </div>

                {/* Breakdown de estados */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{t('recommendationsStatus')}</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="text-center">
                            <p className="text-2xl font-bold text-emerald-600">{data.implemented}</p>
                            <p className="text-xs text-gray-500 mt-1">{t('statusImplemented')}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-2xl font-bold text-blue-600">{data.accepted}</p>
                            <p className="text-xs text-gray-500 mt-1">{t('statusAccepted')}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-2xl font-bold text-amber-600">{data.suppressed}</p>
                            <p className="text-xs text-gray-500 mt-1">{t('statusSuppressed')}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-2xl font-bold text-gray-400">{data.dismissed}</p>
                            <p className="text-xs text-gray-500 mt-1">{t('statusDismissed')}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Breakdown por categoría */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">{t('coinByCategory')}</h3>
                <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.breakdown} layout="vertical" margin={{ left: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#374151" opacity={0.15} />
                            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12, fill: '#6B7280' }} tickFormatter={(v) => `${v}%`} />
                            <YAxis type="category" dataKey="category" width={90} tick={{ fontSize: 12, fill: '#6B7280' }} />
                            <Tooltip formatter={(v: any, _n: any, p: any) => [`${v}% (${p.payload.implemented}/${p.payload.total})`, 'COIN']} />
                            <Bar dataKey="coin" radius={[0, 6, 6, 0]} barSize={22}>
                                {(data.breakdown || []).map((entry: any) => (
                                    <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category] || '#94a3b8'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Tendencia mensual */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-brand-deep" />
                    {t('monthlyTrend')}
                </h3>
                <div className="h-[240px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.monthly}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.2} />
                            <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6B7280' }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#6B7280' }} tickFormatter={(v) => `${v}%`} />
                            <Tooltip formatter={(v: any, _n: any, p: any) => [`${v}% (${p.payload.implemented}/${p.payload.total})`, 'COIN']} />
                            <Line type="monotone" dataKey="coin" stroke="#00aeef" strokeWidth={3} dot={{ r: 4, fill: '#00aeef' }} activeDot={{ r: 6 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect, useCallback } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { ShieldCheck, DollarSign, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DefenderPage() {
    const t = useTranslations('Defender');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState<string>('');
    const [togglingKey, setTogglingKey] = useState<string | null>(null);

    const authFetch = useCallback(async (url: string, init?: RequestInit) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${idToken}` } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || t('toast_load_error'));
        return json;
    }, [accounts, instance, t]);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const json = await authFetch(`/api/intelligence/defender?tenantId=${selectedTenant.id}`);
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [authFetch, selectedTenant.id]);

    useEffect(() => {
        if (selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        load();
    }, [selectedTenant.id, accounts.length, load]);

    if (selectedTenant.id === 'default') return null;

    if (error) {
        const requiredTier = parseTierRequiredError(error);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('page_title')} />;
        }
    }

    if (loading) {
        return (
            <div className="p-6 max-w-5xl mx-auto flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t('loading')}</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">{t('load_error')}</div>;

    const plans = data.plans || [];
    const byPlan: Record<string, any[]> = {};
    for (const p of plans) {
        byPlan[p.planName] = byPlan[p.planName] || [];
        byPlan[p.planName].push(p);
    }

    async function toggle(p: any) {
        const key = `${p.subscriptionId}/${p.planName}`;
        const nextTier = p.pricingTier === 'Standard' ? 'Free' : 'Standard';
        setTogglingKey(key);
        try {
            await authFetch('/api/intelligence/defender', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: selectedTenant.id, subscriptionId: p.subscriptionId, planName: p.planName, pricingTier: nextTier }),
            });
            toast.success(t('toast_updated'));
            await load();
        } catch (e: any) {
            toast.error(e.message || t('toast_update_error'));
        } finally {
            setTogglingKey(null);
        }
    }

    return (
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <ShieldCheck className="w-8 h-8 text-brand-deep" />
                    {t('page_title')}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{t('page_subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><DollarSign className="w-4 h-4" />{t('kpi_total_cost')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(data.totalMonthlyCost || 0)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Layers className="w-4 h-4" />{t('kpi_standard_plans')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{data.standardPlanCount || 0}</p>
                </div>
            </div>

            {Object.keys(byPlan).length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center shadow-sm">
                    <ShieldCheck className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('empty_title')}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{t('empty_desc')}</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t('table_title')}</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_plan')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_subscription')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_tier')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_action')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {plans.map((p: any) => {
                                    const key = `${p.subscriptionId}/${p.planName}`;
                                    return (
                                        <tr key={key} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{p.planName}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 font-mono">{p.subscriptionId}</td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${p.pricingTier === 'Standard' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400'}`}>{p.pricingTier}</span>
                                            </td>
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-right">
                                                {!isMockTenant(selectedTenant.id) && (
                                                    <button
                                                        onClick={() => toggle(p)}
                                                        disabled={togglingKey === key}
                                                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                                                    >
                                                        {togglingKey === key ? t('toggling') : (p.pricingTier === 'Standard' ? t('action_disable') : t('action_enable'))}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {!data.costBreakdownAvailable && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-3">{t('cost_unavailable_note')}</p>
                    )}
                </div>
            )}
        </div>
    );
}

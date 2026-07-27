"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { ScrollText, DollarSign, Zap, Database, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import Pagination, { usePagination } from '@/components/Pagination';
import PinButton from '@/components/dashboard/PinButton';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REC_BADGE: Record<string, string> = {
    'commitment-tier': 'bg-brand-soft text-brand-deep dark:bg-brand-deep/30 dark:text-brand-bright',
    'reduce-retention': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'set-daily-cap': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'ok': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export default function LogAnalyticsPage() {
    const t = useTranslations('LogAnalytics');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(data?.workspaces);

    useEffect(() => {
        if (selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const url = new URL(`/api/intelligence/log-analytics`, window.location.origin);
                url.searchParams.set('tenantId', selectedTenant.id);
                const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
                const json = await res.json();
                if (cancelled) return;
                if (res.ok) setData(json);
                else toast.error(json.error || t('toast_load_error'));
            } catch (e: any) {
                if (cancelled) return;
                console.error(e);
                toast.error(t('toast_network_error'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTenant.id, accounts.length, instance, t]);

    if (selectedTenant.id === 'default') return null;

    if (loading) {
        return (
            <div className="p-6 max-w-6xl mx-auto flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">{t('loading')}</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">{t('load_error')}</div>;

    if (data.empty || (data.workspaces || []).length === 0) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <ScrollText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('empty_title')}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{data.message || t('empty_desc')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <ScrollText className="w-8 h-8 text-brand-deep" />
                    {t('page_title')}
                    <PinButton widgetKey="intelligence.log-analytics" />
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{t('page_subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><DollarSign className="w-4 h-4" />{t('kpi_total_cost')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt.format(data.totalMonthlyCost || 0)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Zap className="w-4 h-4 text-amber-500" />{t('kpi_potential_saving')}</h3>
                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{fmt.format(data.totalPotentialSaving || 0)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Database className="w-4 h-4" />{t('kpi_commitment_candidates')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{data.commitmentTierCandidates || 0}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{t('kpi_uncapped')}</h3>
                    <p className="text-2xl font-black text-gray-900 dark:text-white">{data.uncappedWorkspaces || 0}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">{t('table_title')}</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_workspace')}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_sku')}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_retention')}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_ingestion')}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_monthly_cost')}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_recommendation')}</th>
                                <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t('col_saving')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paged.map((w: any) => (
                                <tr key={`${w.resourceGroup}/${w.name}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">
                                        {w.name}
                                        <span className="block text-[11px] text-gray-400">{w.resourceGroup}</span>
                                    </td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{w.sku}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 text-right whitespace-nowrap">
                                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{w.retentionDays} {t('days')}</span>
                                    </td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 text-right whitespace-nowrap">
                                        ~{w.estMonthlyIngestionGb} {t('gb_month')}
                                        {w.dailyQuotaGb === null && <span className="block text-[10px] text-red-500">{t('no_cap')}</span>}
                                    </td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{fmt.format(w.monthlyCost)}</td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm">
                                        <span className={`text-[11px] px-2 py-0.5 rounded ${REC_BADGE[w.recommendation] || REC_BADGE.ok}`}>
                                            {t(`rec_${w.recommendation.replace(/-/g, '_')}`)}
                                            {w.recommendedTierGb ? ` (${w.recommendedTierGb} GB/${t('day')})` : ''}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-emerald-600 dark:text-emerald-400 text-right">{w.potentialSaving > 0 ? fmt.format(w.potentialSaving) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-3">{t('estimate_note')}</p>
            </div>
        </div>
    );
}

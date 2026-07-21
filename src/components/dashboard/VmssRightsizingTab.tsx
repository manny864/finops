"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Server, TrendingDown, Info } from 'lucide-react';
import Pagination, { usePagination } from '@/components/Pagination';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

function MockBanner({ t }: { t: ReturnType<typeof useTranslations> }) {
    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-sm mb-4">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span><b>{t('demoLabel')}:</b> {t('demoMessage')}</span>
        </div>
    );
}

export default function VmssRightsizingTab() {
    const t = useTranslations('RightsizingVmss');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [search, setSearch] = useState('');

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error(t('errors.noAuthenticatedAccount'));
        const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error || t('errors.loadFailed')); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant?.id && selectedTenant.id !== 'default' && accounts.length > 0
            ? `/api/rightsizing/vmss?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const items: any[] = data?.items || [];
    const filtered = items.filter(r =>
        !search || [r.vmssName, r.resourceGroup, r.currentSku].join(' ').toLowerCase().includes(search.toLowerCase())
    );
    const { page, setPage, pageSize, setPageSize, paged: pagedFiltered } = usePagination(filtered);

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading) return (
        <div className="flex items-center justify-center py-16">
            <Loader2 className="w-7 h-7 animate-spin text-brand-deep mr-3" />
            <span className="text-gray-500">{t('loading')}</span>
        </div>
    );

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('featureName')} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-4 rounded-lg border border-red-200">
                <b>{t('errors.errorLabel')}:</b> {error.message}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {data?.mock && <MockBanner t={t} />}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-900/40">
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wide">{t('stats.vmssAnalyzed')}</p>
                    <p className="text-2xl font-bold text-blue-800 dark:text-blue-200 mt-1">{items.length}</p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 border border-emerald-100 dark:border-emerald-900/40">
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide">{t('stats.estimatedSavingsPerMonth')}</p>
                    <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200 mt-1">${(data?.totalSavings || 0).toLocaleString()}</p>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 border border-purple-100 dark:border-purple-900/40">
                    <p className="text-xs text-purple-600 dark:text-purple-400 font-semibold uppercase tracking-wide">{t('stats.withAutoscale')}</p>
                    <p className="text-2xl font-bold text-purple-800 dark:text-purple-200 mt-1">{items.filter(r => r.hasAutoscale).length}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-3">
                <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={t('searchPlaceholder')}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3 font-semibold">{t('table.vmss')}</th>
                            <th className="px-4 py-3 font-semibold">{t('table.currentSku')}</th>
                            <th className="px-4 py-3 font-semibold text-center">{t('table.currentCapacity')}</th>
                            <th className="px-4 py-3 font-semibold text-center">{t('table.recommendedCapacity')}</th>
                            <th className="px-4 py-3 font-semibold text-center">{t('table.avgCpu')}</th>
                            <th className="px-4 py-3 font-semibold text-center">{t('table.autoscale')}</th>
                            <th className="px-4 py-3 font-semibold text-right">{t('table.costPerMonth')}</th>
                            <th className="px-4 py-3 font-semibold text-right">{t('table.savings')}</th>
                            <th className="px-4 py-3 font-semibold">{t('table.reason')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                        {pagedFiltered.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                    <div className="flex items-center gap-2">
                                        <Server className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                        <span className="truncate max-w-[160px]" title={r.vmssName}>{r.vmssName}</span>
                                    </div>
                                    <div className="text-xs text-slate-400 mt-0.5 font-mono">{r.resourceGroup}</div>
                                </td>
                                <td className="px-4 py-3 text-xs font-mono text-slate-600 dark:text-slate-300">{r.currentSku}</td>
                                <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-300">{r.currentCapacity}</td>
                                <td className="px-4 py-3 text-center">
                                    <span className={`font-bold ${r.recommendedCapacity < r.currentCapacity ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600'}`}>
                                        {r.recommendedCapacity}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.avgCpuPercent < 20 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : r.avgCpuPercent < 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                                        {r.avgCpuPercent}%
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-center text-xs">
                                    {r.hasAutoscale
                                        ? <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full font-semibold">{t('yes')}</span>
                                        : <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full font-semibold">{t('no')}</span>}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">${r.monthlyCost.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right">
                                    <span className="flex items-center justify-end gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                                        <TrendingDown className="w-3.5 h-3.5" />${r.estimatedSavings.toLocaleString()}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 max-w-[200px]" title={r.reason}>{r.reason}</td>
                            </tr>
                        ))}
                        {filtered.length === 0 && (
                            <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">{t('emptyState')}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <Pagination
                page={page}
                setPage={setPage}
                pageSize={pageSize}
                setPageSize={setPageSize}
                total={filtered.length}
                totalPages={Math.max(1, Math.ceil(filtered.length / pageSize))}
            />
        </div>
    );
}

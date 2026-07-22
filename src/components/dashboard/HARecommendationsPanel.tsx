"use client";
import React from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, ShieldAlert, Info } from 'lucide-react';
import Pagination, { usePagination } from '@/components/Pagination';
import PinButton from '@/components/dashboard/PinButton';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

function MockBanner({ tMock }: { tMock: (k: string) => string }) {
    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-sm mb-4">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span><b>{tMock('badge')}:</b> {tMock('description')}</span>
        </div>
    );
}

const SEV_STYLES: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-900/50',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50',
    low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

export default function HARecommendationsPanel() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations('HA');
    const tMock = useTranslations('Mock');

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant?.id && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/governance/ha?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const items: any[] = data?.items || [];
    const counts = data?.counts || { critical: 0, high: 0, medium: 0, low: 0 };
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(items, 10);

    if (!selectedTenant || selectedTenant.id === 'default') return null;
    if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-brand-deep mr-3" /><span className="text-gray-500">{t('loading')}</span></div>;
    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('tierLockedFeatureName')} />;
        }
        return <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-4 rounded-lg"><b>{t('errorPrefix')}</b> {error.message}</div>;
    }

    return (
        <div className="space-y-4">
            {data?.mock && <MockBanner tMock={tMock} />}

            <div className="flex items-center justify-end">
                <PinButton widgetKey="governance.ha-breakdown" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(['critical', 'high', 'medium', 'low'] as const).map(sev => (
                    <div key={sev} className={`rounded-xl p-4 border ${SEV_STYLES[sev]}`}>
                        <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t(`severities.${sev}`)}</p>
                        <p className="text-2xl font-bold mt-1">{counts[sev] || 0}</p>
                    </div>
                ))}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3 font-semibold">{t('resource')}</th>
                            <th className="px-4 py-3 font-semibold">{t('resourceType')}</th>
                            <th className="px-4 py-3 font-semibold">{t('issue')}</th>
                            <th className="px-4 py-3 font-semibold">{t('severity')}</th>
                            <th className="px-4 py-3 font-semibold">{t('risk')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                        {paged.map((it, i) => {
                            const shortType = (() => {
                                const seg = (it.resourceType || '').split('/').pop() || it.resourceType || '';
                                return seg.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c: string) => c.toUpperCase());
                            })();
                            return (
                                <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                        <div className="flex items-center gap-2">
                                            <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                            <span className="truncate max-w-[220px]" title={it.resourceName}>{it.resourceName}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-xs" title={it.resourceType}>
                                        <span className="inline-block px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full font-medium">{shortType}</span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{t(`issueTypes.${it.issueType}`)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${SEV_STYLES[it.severity] || SEV_STYLES.low}`}>
                                            {t(`severities.${it.severity}`)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 max-w-[300px]">{it.estimatedRisk}</td>
                                </tr>
                            );
                        })}
                        {items.length === 0 && (
                            <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">{t('noIssues')}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
        </div>
    );
}

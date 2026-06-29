"use client";
import React from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, KeyRound, Info } from 'lucide-react';
import Pagination, { usePagination } from '@/components/Pagination';

function MockBanner({ tMock }: { tMock: (k: string) => string }) {
    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-sm mb-4">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span><b>{tMock('badge')}:</b> {tMock('description')}</span>
        </div>
    );
}

function severityFromDays(d: number): 'critical' | 'high' | 'medium' | 'low' {
    if (d <= 7) return 'critical';
    if (d <= 30) return 'high';
    if (d <= 90) return 'medium';
    return 'low';
}

const SEV_STYLES: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export default function ExpiringCredentialsPanel() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations('Credentials');
    const tMock = useTranslations('Mock');

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");
        const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` } });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error || "Error"); }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant?.id && selectedTenant.id !== 'default' && accounts.length > 0
            ? `/api/governance/expiring-credentials?tenantId=${selectedTenant.id}&daysAhead=90`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const items: any[] = data?.items || [];
    const counts = data?.counts || { critical: 0, high: 0, medium: 0 };

    // Hooks ANTES de cualquier return (Rules of Hooks).
    const { paged, ...paginationProps } = usePagination(items, 10);

    if (!selectedTenant || selectedTenant.id === 'default') return null;
    if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-brand-deep mr-3" /><span className="text-gray-500">Cargando...</span></div>;
    if (error) return <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-4 rounded-lg"><b>Error:</b> {error.message}</div>;

    return (
        <div className="space-y-4">
            {data?.mock && <MockBanner tMock={tMock} />}

            <div className="grid grid-cols-3 gap-3">
                <div className={`rounded-xl p-4 border ${SEV_STYLES.critical} border-red-200 dark:border-red-900/50`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('severityCritical')}</p>
                    <p className="text-2xl font-bold mt-1">{counts.critical || 0}</p>
                </div>
                <div className={`rounded-xl p-4 border ${SEV_STYLES.high} border-orange-200 dark:border-orange-900/50`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('severityHigh')}</p>
                    <p className="text-2xl font-bold mt-1">{counts.high || 0}</p>
                </div>
                <div className={`rounded-xl p-4 border ${SEV_STYLES.medium} border-amber-200 dark:border-amber-900/50`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('severityMedium')}</p>
                    <p className="text-2xl font-bold mt-1">{counts.medium || 0}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3 font-semibold">{t('app')}</th>
                            <th className="px-4 py-3 font-semibold">{t('type')}</th>
                            <th className="px-4 py-3 font-semibold">{t('expiresAt')}</th>
                            <th className="px-4 py-3 font-semibold text-right">{t('daysLeft')}</th>
                            <th className="px-4 py-3 font-semibold">App ID</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                        {paged.map((it, i) => {
                            const sev = it.severity || severityFromDays(it.daysTillExpiry);
                            return (
                                <tr key={`${it.appId}-${it.credentialId}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                        <div className="flex items-center gap-2">
                                            <KeyRound className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                            <span className="truncate max-w-[220px]" title={it.displayName}>{it.displayName}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-xs font-semibold">
                                            {t(`types.${it.credentialType}`)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">{(it.expiresAt || '').slice(0, 10)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEV_STYLES[sev]}`}>
                                            {it.daysTillExpiry} días
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-400 font-mono">{it.appId?.slice(0, 18)}…</td>
                                </tr>
                            );
                        })}
                        {items.length === 0 && (
                            <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">{t('noExpiring')}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <Pagination {...paginationProps} />
        </div>
    );
}

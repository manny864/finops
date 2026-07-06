"use client";
import React from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, KeyRound, Info } from 'lucide-react';
import Pagination, { usePagination } from '@/components/Pagination';
import PinButton from '@/components/dashboard/PinButton';

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

/**
 * Estado explícito de la credencial (más allá de los días restantes):
 * vencida (< 0 días), próxima a vencer (≤ 30 días) o habilitada/vigente.
 */
function statusFromDays(d: number): 'expired' | 'expiring' | 'active' {
    if (d < 0) return 'expired';
    if (d <= 30) return 'expiring';
    return 'active';
}

const SEV_STYLES: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const STATUS_STYLES: Record<string, string> = {
    expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50',
    expiring: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50',
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50',
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
            // daysAhead amplio: trae también las vigentes para poder clasificar
            // vencida / próxima a vencer / habilitada (no solo las que expiran pronto).
            ? `/api/governance/expiring-credentials?tenantId=${selectedTenant.id}&daysAhead=3650`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const items: any[] = data?.items || [];
    const statusCounts = items.reduce(
        (acc: { expired: number; expiring: number; active: number }, it: any) => {
            acc[statusFromDays(Number(it.daysTillExpiry ?? 0))]++;
            return acc;
        },
        { expired: 0, expiring: 0, active: 0 }
    );

    // Hooks ANTES de cualquier return (Rules of Hooks).
    const { paged, ...paginationProps } = usePagination(items, 10);

    if (!selectedTenant || selectedTenant.id === 'default') return null;
    if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-brand-deep mr-3" /><span className="text-gray-500">Cargando...</span></div>;
    if (error) return <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-4 rounded-lg"><b>Error:</b> {error.message}</div>;

    return (
        <div className="space-y-4">
            {data?.mock && <MockBanner tMock={tMock} />}

            <div className="flex items-center justify-end">
                <PinButton widgetKey="governance.expiring-credentials" />
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div className={`rounded-xl p-4 border ${STATUS_STYLES.expired}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('statusExpired')}</p>
                    <p className="text-2xl font-bold mt-1">{statusCounts.expired}</p>
                </div>
                <div className={`rounded-xl p-4 border ${STATUS_STYLES.expiring}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('statusExpiring')}</p>
                    <p className="text-2xl font-bold mt-1">{statusCounts.expiring}</p>
                </div>
                <div className={`rounded-xl p-4 border ${STATUS_STYLES.active}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{t('statusActive')}</p>
                    <p className="text-2xl font-bold mt-1">{statusCounts.active}</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3 font-semibold">{t('app')}</th>
                            <th className="px-4 py-3 font-semibold">{t('type')}</th>
                            <th className="px-4 py-3 font-semibold">{t('status')}</th>
                            <th className="px-4 py-3 font-semibold">{t('expiresAt')}</th>
                            <th className="px-4 py-3 font-semibold text-right">{t('daysLeft')}</th>
                            <th className="px-4 py-3 font-semibold">App ID</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                        {paged.map((it, i) => {
                            const days = Number(it.daysTillExpiry ?? 0);
                            const sev = it.severity || severityFromDays(days);
                            const status = statusFromDays(days);
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
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[status]}`}>
                                            {status === 'expired' ? t('statusExpired') : status === 'expiring' ? t('statusExpiring') : t('statusActive')}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">{(it.expiresAt || '').slice(0, 10)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEV_STYLES[sev]}`}>
                                            {days} días
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-400 font-mono">{it.appId?.slice(0, 18)}…</td>
                                </tr>
                            );
                        })}
                        {items.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">{t('noExpiring')}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <Pagination {...paginationProps} />
        </div>
    );
}

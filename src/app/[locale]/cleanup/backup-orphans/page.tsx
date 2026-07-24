"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { ShieldAlert, Info } from 'lucide-react';
import { toast } from 'sonner';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

export default function BackupOrphansPage() {
    const t = useTranslations('BackupOrphans');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        if (selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const url = new URL(`/api/cleanup/backup-orphans`, window.location.origin);
                url.searchParams.set('tenantId', selectedTenant.id);
                const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${idToken}` } });
                const json = await res.json();
                if (cancelled) return;
                if (res.ok) setData(json);
                else setError(json.error || t('toast_load_error'));
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

    const items = data.items || [];

    return (
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <ShieldAlert className="w-8 h-8 text-brand-deep" />
                    {t('page_title')}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">{t('page_subtitle')}</p>
            </div>

            {items.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center shadow-sm">
                    <ShieldAlert className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('empty_title')}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{t('empty_desc')}</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <div className="mb-4 flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 p-3 rounded-lg text-sm">
                        <Info className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{t('review_disclaimer')}</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_item')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_vault')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_type')}</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">{t('col_state')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">{item.itemName}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{item.vaultName}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{item.backupManagementType}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400">{item.protectionState}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

"use client";
import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Server, Database, TrendingDown, Info, Cpu } from 'lucide-react';
import Pagination, { usePagination } from '@/components/Pagination';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

export default function HybridBenefitCard() {
    const t = useTranslations('IntelligenceHybridBenefit');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';
    const [showAll, setShowAll] = useState(false);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || t('errorLoading'));
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/intelligence/hybrid-benefit?tenantId=${selectedTenant.id}&tier=${tier}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const payload = data?.data;
    const { page, setPage, pageSize, setPageSize, total, totalPages, paged: pagedEligibleResources } = usePagination(payload?.eligibleResources);

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t('scanning')}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={tier} featureName="Hybrid Benefit" />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <p className="text-sm font-bold">{t('processingError', { message: error.message })}</p>
            </div>
        );
    }

    if (!payload || payload.eligibleResources.length === 0) {
        return (
            <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
                <p className="text-gray-500 dark:text-gray-400">{t('emptyState')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-6 text-white shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Cpu className="w-32 h-32" />
                </div>
                <h3 className="text-sm font-medium text-green-100 uppercase tracking-widest mb-1">{t('potentialMonthlySavings')}</h3>
                <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black">${payload.totalPotentialSavings.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    <span className="text-green-100 font-medium">{t('perMonth')}</span>
                </div>
                <p className="mt-4 text-sm text-green-50 max-w-lg">
                    {t('reuseLicensesDescription')}
                </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="p-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
                    <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <TrendingDown className="w-5 h-5 text-brand-deep" />
                        {t('eligibleInventory')}
                    </h4>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-slate-800/50 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-800">
                                <th className="p-4 font-semibold uppercase text-[11px] tracking-wider">{t('colResource')}</th>
                                <th className="p-4 font-semibold uppercase text-[11px] tracking-wider">{t('colType')}</th>
                                <th className="p-4 font-semibold uppercase text-[11px] tracking-wider text-right">{t('colCurrentCost')}</th>
                                <th className="p-4 font-semibold uppercase text-[11px] tracking-wider text-right">{t('colAhbCost')}</th>
                                <th className="p-4 font-semibold uppercase text-[11px] tracking-wider text-right text-green-600 dark:text-green-400">{t('colEstimatedSavings')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800 text-gray-700 dark:text-gray-300">
                            {pagedEligibleResources.map((res: any) => (
                                <tr key={res.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                                    <td className="p-4 font-medium">{res.name}</td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            {res.type.includes('SQL') ? <Database className="w-4 h-4 text-blue-500" /> : <Server className="w-4 h-4 text-gray-500" />}
                                            {res.type}
                                        </div>
                                    </td>
                                    <td className="p-4 text-right">${res.currentCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="p-4 text-right">${res.ahbCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                    <td className="p-4 text-right font-bold text-green-600 dark:text-green-400">-${res.savings.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
            </div>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg flex items-start gap-3 border border-blue-100 dark:border-blue-900/50">
                <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <p className="text-sm text-blue-800 dark:text-blue-300">
                    <strong>{t('actionStepLabel')}</strong> {t('actionStepDescription')}
                </p>
            </div>
        </div>
    );
}

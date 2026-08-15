"use client";
import React from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Server, DollarSign, Box, RotateCw } from 'lucide-react';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function AksIntelligence() {
    const t = useTranslations('IntelligenceAks');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [refreshing, setRefreshing] = React.useState(false);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || t('fetchError'));
        }

        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/intelligence/aks?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const handleRefresh = async () => {
        if (!selectedTenant?.id) return;
        setRefreshing(true);
        try {
            await mutate(fetcher(`/api/intelligence/aks?tenantId=${selectedTenant.id}&bust=1`));
        } finally {
            setRefreshing(false);
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t('loading')}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="AKS Chargeback" />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold">{t('queryErrorTitle')}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    const clusters: any[] = data?.data || [];
    const totalAksSpend = clusters.reduce((acc, curr) => acc + (curr.totalCost || 0), 0);

    return (
        <div className="w-full space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white font-heading">
                        Inventario & Supervisión de Clústeres AKS
                    </h2>
                </div>
                <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing || isLoading}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 border border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300 transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                >
                    <RotateCw className={`w-3.5 h-3.5 ${refreshing || isLoading ? 'animate-spin text-[#0054A6] dark:text-blue-400' : ''}`} />
                    <span>Actualizar</span>
                </button>
            </div>

            {/* Top Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-brand-soft flex items-center justify-center text-brand-deep shrink-0">
                        <DollarSign className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{t('totalSpendLabel')}</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                            {currencyFormatter.format(totalAksSpend)}
                        </p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 shrink-0">
                        <Server className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{t('managedClustersLabel')}</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                            {clusters.length}
                        </p>
                    </div>
                </div>
            </div>

            {/* Clusters List */}
            {clusters.length === 0 ? (
                <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm">
                    <Box className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                    <p className="text-slate-500 dark:text-slate-400 text-lg">{t('emptyState')}</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                    <div className="p-5 border-b border-gray-100 dark:border-slate-800">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('breakdownTitle')}</h3>
                        <p className="text-xs text-gray-500 mt-1">
                            {t('breakdownSubtitle')}
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="px-5 py-4 font-semibold">{t('clusterCol')}</th>
                                    <th className="px-5 py-4 font-semibold">{t('resourceGroupCol')}</th>
                                    <th className="px-5 py-4 font-semibold">{t('nodeResourceGroupCol')}</th>
                                    <th className="px-5 py-4 font-semibold text-right">{t('nodesCol')}</th>
                                    <th className="px-5 py-4 font-semibold text-right">{t('controlPlaneCol')}</th>
                                    <th className="px-5 py-4 font-semibold text-right">{t('totalCostCol')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                {clusters.map((cluster, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors group">
                                        <td className="px-5 py-4">
                                            <div className="font-bold text-slate-800 dark:text-slate-200">{cluster.name}</div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">{cluster.location}</div>
                                        </td>
                                        <td className="px-5 py-4 text-slate-600 dark:text-slate-300">{cluster.resourceGroup}</td>
                                        <td className="px-5 py-4 text-slate-600 dark:text-slate-300 font-mono text-xs">
                                            {cluster.nodeResourceGroup || <span className="text-gray-400 italic">{t('unknown')}</span>}
                                        </td>
                                        <td className="px-5 py-4 text-right text-slate-700 dark:text-slate-300 tabular-nums">
                                            {currencyFormatter.format(cluster.nodeRgCost || 0)}
                                        </td>
                                        <td className="px-5 py-4 text-right text-slate-700 dark:text-slate-300 tabular-nums">
                                            {currencyFormatter.format(cluster.controlPlaneCost || 0)}
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <span className="font-bold text-slate-800 dark:text-slate-200 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 rounded-md tabular-nums">
                                                {currencyFormatter.format(cluster.totalCost)}
                                            </span>
                                        </td>
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

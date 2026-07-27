"use client";
import React from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, CheckCircle, XCircle, Clock, Server, Trash2, ArrowDownCircle } from 'lucide-react';
import { toast } from 'sonner';
import Pagination, { usePagination } from '@/components/Pagination';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

export default function RemediationApprovals() {
    const t = useTranslations('RemediationApprovals');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || t('loadError'));
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id))) 
            ? `/api/remediation/workflow?tenantId=${selectedTenant.id}` 
            : null,
        fetcher
    );

    const requests = data?.data || [];
    const pendingRequests = requests.filter((r: any) => r.status === 'Pending');
    const resolvedRequests = requests.filter((r: any) => r.status !== 'Pending');
    const { paged: pagedResolved, ...resolvedPaginationProps } = usePagination(resolvedRequests, 10);

    const handleAction = async (id: number, action: 'Approved' | 'Rejected') => {
        // Optimistic UI Update
        if (data && data.data) {
            const updatedData = data.data.map((req: any) => 
                req.id === id ? { ...req, status: action } : req
            );
            mutate({ ...data, data: updatedData }, false);
        }

        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);

            const res = await fetch(`/api/remediation/workflow`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ id, status: action, tenantId: selectedTenant?.id })
            });

            if (!res.ok) {
                throw new Error(t('actionFailed'));
            }

            toast.success(action === 'Approved' ? t('actionApprovedToast') : t('actionRejectedToast'));
            mutate(); // Re-fetch to sync
        } catch (e: any) {
            toast.error(e.message);
            mutate(); // Rollback on error
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t('loadingWorkflow')}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('featureName')} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <p className="text-sm font-bold">{t('processingError', { message: error.message })}</p>
            </div>
        );
    }

    return (
        <div className="w-full space-y-8">
            {/* Header KPI */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-amber-200/60 dark:border-amber-900/40 rounded-2xl p-6 shadow-md hover:shadow-lg transition-all duration-300 flex items-center justify-between group">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">{t('kpiPending')}</p>
                        <p className="text-4xl font-black text-amber-600 dark:text-amber-500">{pendingRequests.length}</p>
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/50 dark:border-amber-800/40 flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform">
                        <Clock className="w-7 h-7" />
                    </div>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-emerald-200/60 dark:border-emerald-900/40 rounded-2xl p-6 shadow-md hover:shadow-lg transition-all duration-300 flex items-center justify-between group">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">{t('kpiApproved')}</p>
                        <p className="text-4xl font-black text-emerald-600 dark:text-emerald-500">
                            {resolvedRequests.filter((r:any) => r.status === 'Approved').length}
                        </p>
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/50 dark:border-emerald-800/40 flex items-center justify-center text-emerald-500 group-hover:scale-110 transition-transform">
                        <CheckCircle className="w-7 h-7" />
                    </div>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-indigo-200/60 dark:border-indigo-900/40 rounded-2xl p-6 shadow-md hover:shadow-lg transition-all duration-300 flex items-center justify-between group">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">{t('kpiReleasedSavings')}</p>
                        <p className="text-4xl font-black text-brand-deep dark:text-brand-bright">
                            ${resolvedRequests.filter((r:any) => r.status === 'Approved').reduce((acc: number, r: any) => acc + Number(r.estimated_savings), 0).toFixed(2)}
                        </p>
                    </div>
                    <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/50 dark:border-indigo-800/40 flex items-center justify-center text-indigo-500 group-hover:scale-110 transition-transform">
                        <Server className="w-7 h-7" />
                    </div>
                </div>
            </div>

            {/* Kanban / List Board */}
            <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{t('pendingRequestsHeading')}</h3>
                {pendingRequests.length === 0 ? (
                    <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 border-dashed">
                        <CheckCircle className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
                        <p className="text-gray-500 dark:text-gray-400">{t('emptyQueue')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {pendingRequests.map((req: any) => (
                            <div key={req.id} className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-2">
                                        {req.action_type.toLowerCase().includes('delete') ? 
                                            <Trash2 className="w-5 h-5 text-red-500" /> : 
                                            <ArrowDownCircle className="w-5 h-5 text-brand-deep" />
                                        }
                                        <h4 className="font-bold text-gray-900 dark:text-white truncate" title={req.resource_name}>{req.resource_name}</h4>
                                    </div>
                                </div>
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('actionLabel')} <span className="font-bold text-brand-deep dark:text-brand-bright">{req.action_type}</span></p>
                                <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 mb-4">
                                    <span>{t('requestedByLabel')} <span className="truncate block max-w-[150px]">{req.requested_by}</span></span>
                                    <span className="font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
                                        {t('monthlySavingsValue', { amount: Number(req.estimated_savings).toFixed(2) })}
                                    </span>
                                </div>
                                <div className="flex gap-2 mt-auto">
                                    <button
                                        onClick={() => handleAction(req.id, 'Approved')}
                                        className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-2 px-3 rounded flex items-center justify-center gap-1 transition-colors"
                                    >
                                        <CheckCircle className="w-4 h-4" /> {t('approveAndExecute')}
                                    </button>
                                    <button
                                        onClick={() => handleAction(req.id, 'Rejected')}
                                        className="bg-transparent hover:bg-red-50 text-red-600 dark:hover:bg-red-900/30 dark:text-red-400 text-sm font-bold py-2 px-3 rounded border border-red-200 dark:border-red-900/50 flex items-center justify-center gap-1 transition-colors"
                                    >
                                        <XCircle className="w-4 h-4" /> {t('reject')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Resolved Log */}
            {resolvedRequests.length > 0 && (
                <div className="mt-12">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{t('decisionHistoryHeading')}</h3>
                    <div className="overflow-x-auto bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                            <thead className="bg-gray-50 dark:bg-slate-800/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('columnResource')}</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('columnAction')}</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('columnSavings')}</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('columnStatus')}</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('columnResolvedBy')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                {pagedResolved.map((req: any) => (
                                    <tr key={req.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{req.resource_name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{req.action_type}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">${Number(req.estimated_savings).toFixed(2)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${req.status === 'Approved' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}>
                                                {req.status === 'Approved' ? t('statusApproved') : t('statusRejected')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" title={req.resolved_by}>{req.resolved_by.split('@')[0]}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {resolvedRequests.length > 0 && <Pagination {...resolvedPaginationProps} />}
                </div>
            )}
        </div>
    );
}

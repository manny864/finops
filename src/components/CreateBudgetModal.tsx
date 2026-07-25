"use client";
import React, { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import KillSwitchConfig from '@/components/budgets/KillSwitchConfig';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useCloudProvider } from '@/context/ProviderContext';
import { useProviderTranslations } from '@/lib/useProviderTranslations';

interface CreateBudgetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    subscriptionId: string;
    tenantId: string;
}

export default function CreateBudgetModal({ isOpen, onClose, onSuccess, subscriptionId, tenantId }: CreateBudgetModalProps) {
    const t = useProviderTranslations('Budgets');
    const { activeProvider } = useCloudProvider();
    // En AWS el presupuesto se crea solo en la plataforma: escribirlo tambien en
    // AWS Budgets exigiria budgets:CreateBudget, un permiso de escritura que el
    // rol de solo lectura del onboarding no pide a proposito (menor privilegio).
    const isAws = activeProvider === 'aws';
    const { instance, accounts } = useMsal();
    const [budgetName, setBudgetName] = useState('');
    const [amount, setAmount] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [alertThreshold, setAlertThreshold] = useState('80');
    const [timeGrain, setTimeGrain] = useState('BillingMonth');
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!budgetName || !amount || !contactEmail) {
            toast.error(t('createModalMissingFields'));
            return;
        }

        setLoading(true);
        try {
            if (isMockTenant(tenantId)) {
                toast.success(t('createModalSuccess'));
                onSuccess();
                onClose();
                setBudgetName('');
                setAmount('');
                setContactEmail('');
                setLoading(false);
                return;
            }

            const idToken = await getFreshIdToken(instance, accounts[0]);

            if (isAws) {
                const localRes = await fetch('/api/budgets', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        tenantId,
                        costCenter: budgetName,
                        monthlyLimit: parseFloat(amount),
                        alertThreshold: parseFloat(alertThreshold)
                    })
                });
                if (localRes.ok) {
                    toast.success(t('createModalSuccess'));
                    onSuccess();
                    onClose();
                    setBudgetName('');
                    setAmount('');
                    setContactEmail('');
                } else {
                    toast.error(t('createModalFailed'));
                }
                setLoading(false);
                return;
            }

            // First save/create budget in Azure via API
            const res = await fetch('/api/budgets/create', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    subscriptionId,
                    budgetName,
                    amount: parseFloat(amount),
                    contactEmail,
                    alertThreshold: parseFloat(alertThreshold),
                    tenantId,
                    timeGrain
                })
            });

            const json = await res.json();
            if (res.ok) {
                // Also upsert local database budget so it shows up instantly in the local dashboard list
                await fetch('/api/budgets', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        tenantId,
                        costCenter: budgetName,
                        monthlyLimit: parseFloat(amount),
                        alertThreshold: parseFloat(alertThreshold)
                    })
                });

                toast.success(t('createModalSuccess'));
                onSuccess();
                onClose();
                setBudgetName('');
                setAmount('');
                setContactEmail('');
            } else {
                toast.error(json.details || json.error || t('createModalFailed'));
            }
        } catch (e: any) {
            console.error("Error creating Azure budget:", e);
            toast.error(t('createModalConnError', { message: e.message }));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('createModalTitle')}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('createModalNameLabel')}</label>
                        <input
                            type="text"
                            value={budgetName}
                            onChange={(e) => setBudgetName(e.target.value)}
                            placeholder={t('createModalNamePlaceholder')}
                            required
                            disabled={loading}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-500 dark:placeholder-gray-400"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('createModalAmountLabel')}</label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder={t('createModalAmountPlaceholder')}
                            required
                            disabled={loading}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-500 dark:placeholder-gray-400"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('createModalEmailLabel')}</label>
                        <input
                            type="email"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            placeholder={t('createModalEmailPlaceholder')}
                            required
                            disabled={loading}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-500 dark:placeholder-gray-400"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('createModalThresholdLabel')}</label>
                        <input
                            type="number"
                            value={alertThreshold}
                            onChange={(e) => setAlertThreshold(e.target.value)}
                            placeholder={t('createModalThresholdPlaceholder')}
                            min="1"
                            max="1000"
                            required
                            disabled={loading}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-500 dark:placeholder-gray-400"
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('createModalFrequencyLabel')}</label>
                        <select
                            value={timeGrain}
                            onChange={(e) => setTimeGrain(e.target.value)}
                            disabled={loading}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="BillingMonth">{t('createModalFreqMonthly')}</option>
                            <option value="BillingQuarter">{t('createModalFreqQuarterly')}</option>
                            <option value="BillingAnnual">{t('createModalFreqAnnual')}</option>
                        </select>
                    </div>

                    {/* El kill-switch apaga los recursos de un resource group,
                        que en AWS no existe; su equivalente exigiria permisos de
                        escritura sobre EC2 que el rol de lectura no tiene. */}
                    {!isAws && <KillSwitchConfig subscriptionId={subscriptionId} />}
                    
                    <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 -mx-6 -mb-6 flex justify-end gap-3 mt-6">
                        <button 
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="px-4 py-2 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                        >
                            {t('platformCancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-md disabled:opacity-50 transition-colors"
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            {loading ? t('createModalCreating') : t('createModalCreate')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

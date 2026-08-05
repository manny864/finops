"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { Loader2, X, ChevronDown } from 'lucide-react';
import KillSwitchConfig from '@/components/budgets/KillSwitchConfig';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useProviderTranslations } from '@/lib/useProviderTranslations';

interface CreateBudgetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    subscriptionId: string;
    tenantId: string;
}

interface BudgetData {
    id: number;
    costCenter: string;
    monthlyLimit: number;
    alertThreshold: number;
}

export default function CreateBudgetModal({ isOpen, onClose, onSuccess, subscriptionId, tenantId }: CreateBudgetModalProps) {
    const t = useProviderTranslations('Budgets');
    const { instance, accounts } = useMsal();
    const [budgetName, setBudgetName] = useState('');
    const [amount, setAmount] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [alertThreshold, setAlertThreshold] = useState('80');
    const [timeGrain, setTimeGrain] = useState('BillingMonth');
    const [loading, setLoading] = useState(false);
    const [existingBudgets, setExistingBudgets] = useState<BudgetData[]>([]);
    const [selectedBudgetId, setSelectedBudgetId] = useState<number | null>(null);
    const [mode, setMode] = useState<'create' | 'edit'>('create');
    const [loadingBudgets, setLoadingBudgets] = useState(false);

    useEffect(() => {
        if (!isOpen || isMockTenant(tenantId)) return;
        (async () => {
            setLoadingBudgets(true);
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);
                const res = await fetch(`/api/budgets?tenantId=${tenantId}`, {
                    headers: { Authorization: `Bearer ${idToken}` }
                });
                const json = await res.json();
                setExistingBudgets(json.budgets || []);
            } catch (e) {
                console.error("Failed to load budgets:", e);
            } finally {
                setLoadingBudgets(false);
            }
        })();
    }, [isOpen, tenantId, instance, accounts]);

    useEffect(() => {
        if (selectedBudgetId && mode === 'edit') {
            const budget = existingBudgets.find(b => b.id === selectedBudgetId);
            if (budget) {
                setBudgetName(budget.costCenter);
                setAmount(String(budget.monthlyLimit));
                setAlertThreshold(String(budget.alertThreshold));
            }
        }
    }, [selectedBudgetId, mode, existingBudgets]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!budgetName || !amount || (mode === 'create' && !contactEmail)) {
            toast.error(t('createModalMissingFields'));
            return;
        }

        setLoading(true);
        try {
            if (isMockTenant(tenantId)) {
                toast.success(mode === 'create' ? t('createModalSuccess') : 'Budget updated');
                onSuccess();
                onClose();
                resetForm();
                return;
            }

            const idToken = await getFreshIdToken(instance, accounts[0]);

            if (mode === 'create') {
                // Create new budget in Azure
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
                    // Also upsert local database budget
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
                    resetForm();
                } else {
                    toast.error(json.details || json.error || t('createModalFailed'));
                }
            } else {
                // Update existing budget
                const res = await fetch('/api/budgets', {
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

                const json = await res.json();
                if (res.ok) {
                    toast.success('Budget updated successfully');
                    onSuccess();
                    onClose();
                    resetForm();
                } else {
                    toast.error(json.error || 'Failed to update budget');
                }
            }
        } catch (e: any) {
            console.error("Error:", e);
            toast.error(e.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setBudgetName('');
        setAmount('');
        setContactEmail('');
        setAlertThreshold('80');
        setTimeGrain('BillingMonth');
        setSelectedBudgetId(null);
        setMode('create');
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                        {mode === 'create' ? t('createModalTitle') : 'Edit Budget'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Mode Tabs */}
                {existingBudgets.length > 0 && (
                    <div className="px-6 py-3 border-b border-gray-200 dark:border-slate-800 flex gap-2">
                        <button
                            onClick={() => { setMode('create'); resetForm(); }}
                            className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                                mode === 'create'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            Create New
                        </button>
                        <button
                            onClick={() => setMode('edit')}
                            className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                                mode === 'edit'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            Edit Existing
                        </button>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {mode === 'edit' && existingBudgets.length > 0 && (
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                Select Budget
                            </label>
                            <select
                                value={selectedBudgetId || ''}
                                onChange={(e) => setSelectedBudgetId(Number(e.target.value))}
                                required
                                disabled={loading}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="">Choose a budget...</option>
                                {existingBudgets.map(b => (
                                    <option key={b.id} value={b.id}>
                                        {b.costCenter} (${b.monthlyLimit.toFixed(2)})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('createModalNameLabel')}</label>
                        <input
                            type="text"
                            value={budgetName}
                            onChange={(e) => setBudgetName(e.target.value)}
                            placeholder={t('createModalNamePlaceholder')}
                            required
                            disabled={loading || (mode === 'edit' && !selectedBudgetId)}
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
                            disabled={loading || (mode === 'edit' && !selectedBudgetId)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-500 dark:placeholder-gray-400"
                        />
                    </div>

                    {mode === 'create' && (
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
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('createModalThresholdLabel')}</label>
                        <input
                            type="number"
                            value={alertThreshold}
                            onChange={(e) => setAlertThreshold(e.target.value)}
                            min="0"
                            max="100"
                            required
                            disabled={loading || (mode === 'edit' && !selectedBudgetId)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    {mode === 'create' && (
                        <KillSwitchConfig
                            timeGrain={timeGrain}
                            onTimeGrainChange={setTimeGrain}
                        />
                    )}

                    <button
                        type="submit"
                        disabled={loading || (mode === 'edit' && !selectedBudgetId)}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {mode === 'create' ? t('createModalCreateBtn') : 'Update Budget'}
                    </button>
                </form>
            </div>
        </div>
    );
}

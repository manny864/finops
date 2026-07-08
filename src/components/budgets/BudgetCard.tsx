"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useTranslations } from 'next-intl';
import { Loader2, DollarSign, Bell } from 'lucide-react';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMsal } from '@azure/msal-react';
import CreateBudgetModal from '@/components/CreateBudgetModal';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function BudgetCard() {
    const { selectedTenant } = useTenant();
    const t = useTranslations('Budgets');
    
    const [loading, setLoading] = useState(false);
    const [budgetData, setBudgetData] = useState<any>(null);
    const [budgetsBySub, setBudgetsBySub] = useState<Record<string, { budget: number, actual: number }>>({});
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeSubscriptionForModal, setActiveSubscriptionForModal] = useState<string>('');

    const { selectedSubscription, subscriptions } = useSubscription();
    const { instance, accounts } = useMsal();

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id)) || subscriptions.length === 0) {
            setBudgetData(null);
            return;
        }

        let isMounted = true;
        setLoading(true);

        const fetchData = async () => {
            try {
                const idToken = await getFreshIdToken(instance, accounts[0]);

                const subIds = selectedSubscription !== 'All'
                    ? selectedSubscription
                    : subscriptions.map(s => s.id).join(',');

                if (!subIds) {
                    if (isMounted) setLoading(false);
                    return;
                }

                const res = await fetch(`/api/budgets/burn?tenantId=${selectedTenant.id}&subscriptionId=${subIds}`, {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });
                const json = await res.json();

                if (isMounted) {
                    if (json.burnData && json.burnData.length > 0) {
                        const totalBudget = json.burnData.reduce((acc: number, curr: any) => acc + (curr.budget || 0), 0);
                        const totalActual = json.burnData.reduce((acc: number, curr: any) => acc + (curr.actual || 0), 0);
                        
                        const subGrouped: Record<string, { budget: number, actual: number }> = {};
                        json.burnData.forEach((item: any) => {
                            if (!subGrouped[item.subscriptionId]) subGrouped[item.subscriptionId] = { budget: 0, actual: 0 };
                            subGrouped[item.subscriptionId].budget += (item.budget || 0);
                            subGrouped[item.subscriptionId].actual += (item.actual || 0);
                        });

                        setBudgetData({
                            budget_usd: totalBudget,
                            actual_spend: totalActual,
                            alert_threshold: 80.00 // Default threshold
                        });
                        setBudgetsBySub(subGrouped);
                    } else {
                        setBudgetData(null);
                        setBudgetsBySub({});
                    }
                }
            } catch (e) {
                console.error("Error fetching native budgets for BudgetCard:", e);
                if (isMounted) setBudgetData(null);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();

        return () => {
            isMounted = false;
        };
    }, [selectedTenant, selectedSubscription, subscriptions, accounts, instance]);

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    return (
        <div className="w-full">
            {/* Global Tenant Budget Summary */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg shadow-sm p-6 mb-6">
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">Presupuesto Consolidado del Tenant</h3>
                
                {loading ? (
                    <div className="animate-pulse flex flex-col gap-4 mt-6">
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4"></div>
                        <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-1/2 mt-2"></div>
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-5/6"></div>
                    </div>
                ) : budgetData && budgetData.budget_usd > 0 ? (
                    <div className="mt-6 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-brand-soft rounded-full text-brand-deep">
                                <DollarSign className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{t('assigned_budget')}</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {currencyFormatter.format(budgetData.budget_usd)}
                                </p>
                            </div>
                        </div>
                        
                        <div className="mt-4">
                            <div className="flex justify-between text-xs mb-1">
                                <span className="font-semibold text-gray-600 dark:text-gray-300">Consumo Total Actual</span>
                                <span className="font-bold text-gray-800 dark:text-white">
                                    {((budgetData.actual_spend / budgetData.budget_usd) * 100).toFixed(1)}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2.5">
                                <div 
                                    className={`h-2.5 rounded-full ${budgetData.budget_usd > 0 && (budgetData.actual_spend / budgetData.budget_usd) * 100 >= budgetData.alert_threshold ? 'bg-red-500' : 'bg-brand-deep'}`}
                                    style={{ width: `${Math.min((budgetData.actual_spend / budgetData.budget_usd) * 100, 100)}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="mt-6 text-sm text-gray-400 h-32 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-100 dark:border-slate-800 rounded-lg">
                        <p className="mb-3">{t('no_budget_configured')}</p>
                        <button 
                            onClick={() => {
                                setActiveSubscriptionForModal(subscriptions[0]?.id || '');
                                setIsModalOpen(true);
                            }}
                            className="px-4 py-2 bg-brand-deep text-white rounded-md text-xs font-bold hover:bg-brand-bright transition-colors"
                        >
                            {t('configure_btn')}
                        </button>
                    </div>
                )}
            </div>

            {/* Subscriptions Grid */}
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">Desglose por Suscripción</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {subscriptions.map(sub => {
                    const subData = budgetsBySub[sub.id] || { budget: 0, actual: 0 };
                    const realBudget = subData.budget;
                    const realSpend = subData.actual;
                    const spendPercentage = realBudget > 0 ? (realSpend / realBudget) * 100 : 0;
                    
                    return (
                        <div key={sub.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg shadow-sm p-5 flex flex-col justify-between">
                            <div>
                                <h4 className="font-bold text-gray-900 dark:text-white truncate" title={sub.name}>{sub.name}</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">{sub.id}</p>
                                
                                <div className="flex justify-between items-end mb-2">
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">Asignado</p>
                                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{currencyFormatter.format(realBudget)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">Consumido</p>
                                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{currencyFormatter.format(realSpend)}</p>
                                    </div>
                                </div>

                                <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1.5 mb-4">
                                    <div 
                                        className={`h-1.5 rounded-full ${spendPercentage >= 90 ? 'bg-red-500' : spendPercentage >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${Math.min(spendPercentage, 100)}%` }}
                                    ></div>
                                </div>
                            </div>
                            
                            <button 
                                onClick={() => {
                                    setActiveSubscriptionForModal(sub.id);
                                    setIsModalOpen(true);
                                }}
                                className="w-full py-2 bg-gray-50 dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 rounded-md text-xs font-bold text-brand-deep transition-colors"
                            >
                                Configurar / Editar Presupuesto
                            </button>
                        </div>
                    );
                })}
            </div>
            <CreateBudgetModal 
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={() => {
                    window.location.reload();
                }}
                subscriptionId={activeSubscriptionForModal}
                tenantId={selectedTenant.id}
            />
        </div>
    );
}

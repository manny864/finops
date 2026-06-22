"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useTranslations } from 'next-intl';
import { Loader2, DollarSign, Bell } from 'lucide-react';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMsal } from '@azure/msal-react';

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function BudgetCard() {
    const { selectedTenant } = useTenant();
    const t = useTranslations('Budgets');
    
    const [loading, setLoading] = useState(false);
    const [budgetData, setBudgetData] = useState<any>(null);

    const { selectedSubscription, subscriptions } = useSubscription();
    const { instance, accounts } = useMsal();

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0 || subscriptions.length === 0) {
            setBudgetData(null);
            return;
        }

        let isMounted = true;
        setLoading(true);

        const fetchData = async () => {
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });

                const subIds = selectedSubscription !== 'All' 
                    ? selectedSubscription 
                    : subscriptions.map(s => s.id).join(',');

                if (!subIds) {
                    if (isMounted) setLoading(false);
                    return;
                }

                const res = await fetch(`/api/budgets/burn?tenantId=${selectedTenant.id}&subscriptionId=${subIds}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();

                if (isMounted) {
                    if (json.burnData && json.burnData.length > 0) {
                        const totalBudget = json.burnData.reduce((acc: number, curr: any) => acc + (curr.budget || 0), 0);
                        const totalActual = json.burnData.reduce((acc: number, curr: any) => acc + (curr.actual || 0), 0);
                        
                        setBudgetData({
                            budget_usd: totalBudget,
                            actual_spend: totalActual,
                            alert_threshold: 80.00 // Default threshold
                        });
                    } else {
                        setBudgetData(null);
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
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mt-6 max-w-lg">
            <h3 className="text-lg font-bold text-gray-800 mb-2">{t('card_title')}</h3>
            
            {loading ? (
                // Skeleton Loader
                <div className="animate-pulse flex flex-col gap-4 mt-6">
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-8 bg-gray-200 rounded w-1/2 mt-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                </div>
            ) : budgetData ? (
                <div className="mt-6 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-brand-soft rounded-full text-brand-deep">
                            <DollarSign className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 font-medium">{t('assigned_budget')}</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {currencyFormatter.format(budgetData.budget_usd)}
                            </p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 mt-2">
                        <div className="p-3 bg-amber-50 rounded-full text-amber-500">
                            <Bell className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 font-medium">{t('alert_threshold')}</p>
                            <p className="text-lg font-bold text-gray-900">
                                {budgetData.alert_threshold}%
                            </p>
                        </div>
                    </div>
                    
                    {/* Progress Bar (Mocked Spend) */}
                    <div className="mt-4">
                        <div className="flex justify-between text-xs mb-1">
                            <span className="font-semibold text-gray-600">Consumo Actual</span>
                            <span className="font-bold text-gray-800">
                                {budgetData.budget_usd > 0 ? ((budgetData.actual_spend / budgetData.budget_usd) * 100).toFixed(1) : 0}%
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div 
                                className={`h-2.5 rounded-full ${budgetData.budget_usd > 0 && (budgetData.actual_spend / budgetData.budget_usd) * 100 >= budgetData.alert_threshold ? 'bg-red-500' : 'bg-brand-deep'}`}
                                style={{ width: `${budgetData.budget_usd > 0 ? Math.min((budgetData.actual_spend / budgetData.budget_usd) * 100, 100) : 0}%` }}
                            ></div>
                        </div>
                    </div>

                </div>
            ) : (
                <div className="mt-6 text-sm text-gray-400 h-32 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-100 rounded-lg">
                    <p className="mb-3">{t('no_budget_configured')}</p>
                    <button className="px-4 py-2 bg-brand-deep text-white rounded-md text-xs font-bold hover:bg-brand-bright transition-colors">
                        {t('configure_btn')}
                    </button>
                </div>
            )}
        </div>
    );
}

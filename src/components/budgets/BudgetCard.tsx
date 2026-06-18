"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useTranslations } from 'next-intl';
import { Loader2, DollarSign, Bell } from 'lucide-react';

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function BudgetCard() {
    const { selectedTenant } = useTenant();
    const t = useTranslations('Budgets');
    
    const [loading, setLoading] = useState(false);
    const [budgetData, setBudgetData] = useState<any>(null);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default') {
            setBudgetData(null);
            return;
        }

        let isMounted = true;
        setLoading(true);

        // Mockeo temporal de la API
        const fetchMockData = async () => {
            // Simulamos retraso de red
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            if (isMounted) {
                // TODO: Conectar a API real /api/intelligence/budgets
                // Simulamos que el tenant tiene un presupuesto o no de manera aleatoria
                const hasBudget = Math.random() > 0.3;
                
                if (hasBudget) {
                    setBudgetData({
                        budget_usd: 5000.00,
                        alert_threshold: 80.00
                    });
                } else {
                    setBudgetData(null);
                }
                setLoading(false);
            }
        };

        fetchMockData();

        return () => {
            isMounted = false;
        };
    }, [selectedTenant]);

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
                            <span className="font-semibold text-gray-600">Consumo Simulado</span>
                            <span className="font-bold text-gray-800">
                                {budgetData.budget_usd > 0 ? ((2500 / budgetData.budget_usd) * 100).toFixed(1) : 0}%
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div 
                                className={`h-2.5 rounded-full ${budgetData.budget_usd > 0 && (2500 / budgetData.budget_usd) * 100 >= budgetData.alert_threshold ? 'bg-red-500' : 'bg-brand-deep'}`}
                                style={{ width: `${budgetData.budget_usd > 0 ? Math.min((2500 / budgetData.budget_usd) * 100, 100) : 0}%` }}
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

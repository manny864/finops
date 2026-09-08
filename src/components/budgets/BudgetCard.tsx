"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useTranslations } from 'next-intl';
import { DollarSign, AlertTriangle, AlertCircle, RefreshCw, Sparkles, ShieldCheck, Tag } from 'lucide-react';
import { useSubscription } from '@/components/SubscriptionProvider';
import { useMsal } from '@azure/msal-react';
import CreateBudgetModal from '@/components/CreateBudgetModal';
import BudgetMonthlyChart, { type BudgetMonthlyChartPoint } from '@/components/budgets/BudgetMonthlyChart';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { toast } from 'sonner';
import type { BudgetStatus } from '@/lib/budgetTypes';
import { errorMessage } from '@/lib/apiErrors';

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function BudgetCard() {
    const { selectedTenant } = useTenant();
    const t = useTranslations('Budgets');
    
    const [loading, setLoading] = useState(false);
    const [budgetData, setBudgetData] = useState<any>(null);
    const [budgetsBySub, setBudgetsBySub] = useState<Record<string, {
        budget: number;
        actual: number;
        dailyBurnRate?: number;
        forecastedMonthEndSpend?: number;
        forecastedBreachDate?: string | null;
        budgetStatus?: BudgetStatus;
        percentageUsed?: number;
    }>>({});
    const [monthlyHistoryBySub, setMonthlyHistoryBySub] = useState<Record<string, BudgetMonthlyChartPoint[]>>({});
    const [monthlyHistoryLoading, setMonthlyHistoryLoading] = useState(false);
    const [activeNativeBudgets, setActiveNativeBudgets] = useState<Array<{ subscriptionId: string; budgetName: string; amount: number }>>([]);
    const [syncingAzure, setSyncingAzure] = useState(false);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeSubscriptionForModal, setActiveSubscriptionForModal] = useState<string>('');
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');

    const { subscriptions } = useSubscription();
    const { instance, accounts } = useMsal();

    const isMock = isMockTenant(selectedTenant?.id || '');

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMock) || subscriptions.length === 0) {
            setBudgetData(null);
            return;
        }

        let isMounted = true;
        setLoading(true);

        const fetchData = async () => {
            try {
                const idToken = accounts.length > 0 ? await getFreshIdToken(instance, accounts[0]) : '';

                const res = await fetch(`/api/budgets/burn?tenantId=${selectedTenant.id}&subscriptionId=All`, {
                    headers: idToken ? { 'Authorization': `Bearer ${idToken}` } : {}
                });
                const json = await res.json();

                if (isMounted) {
                    if ((json.burnData && json.burnData.length > 0) || (json.consolidated && json.consolidated.assignedAmount > 0)) {
                        const consolidated = json.consolidated || {};
                        const totalBudget = consolidated.assignedAmount ?? json.burnData?.reduce((acc: number, curr: any) => acc + (curr.budget || 0), 0) ?? 0;
                        const totalActual = consolidated.currentSpend ?? json.burnData?.reduce((acc: number, curr: any) => acc + (curr.actual || 0), 0) ?? 0;
                        
                        const subGrouped: Record<string, any> = json.subBudgets ? { ...json.subBudgets } : {};
                        if (!json.subBudgets && json.burnData) {
                            json.burnData.forEach((item: any) => {
                                if (!subGrouped[item.subscriptionId]) {
                                    subGrouped[item.subscriptionId] = {
                                        budget: 0,
                                        actual: 0,
                                        dailyBurnRate: item.dailyBurnRate,
                                        forecastedMonthEndSpend: item.forecastedMonthEndSpend,
                                        forecastedBreachDate: item.forecastedBreachDate,
                                        budgetStatus: item.budgetStatus,
                                        percentageUsed: item.percentageUsed,
                                    };
                                }
                                subGrouped[item.subscriptionId].budget += (item.budget || 0);
                                subGrouped[item.subscriptionId].actual += (item.actual || 0);
                            });
                        }

                        setBudgetData({
                            budget_usd: totalBudget,
                            actual_spend: totalActual,
                            alert_threshold: 80.00,
                            dailyBurnRate: consolidated.dailyBurnRate ?? (totalActual / Math.max(1, new Date().getDate())),
                            forecastedMonthEndSpend: consolidated.forecastedMonthEndSpend ?? totalActual,
                            forecastedBreachDate: consolidated.forecastedBreachDate ?? null,
                            budgetStatus: consolidated.budgetStatus || (totalBudget > 0 && totalActual >= totalBudget ? 'CRITICAL' : 'OK'),
                            percentageUsed: consolidated.percentageUsed ?? (totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0),
                        });
                        setBudgetsBySub(subGrouped);
                        const deduped = new Map<string, { subscriptionId: string; budgetName: string; amount: number }>();
                        (json.burnData || []).forEach((item: any) => {
                            if (!item?.subscriptionId || !item?.costCenter) return;
                            const key = `${item.subscriptionId}::${item.costCenter}`;
                            if (!deduped.has(key)) {
                                deduped.set(key, {
                                    subscriptionId: String(item.subscriptionId),
                                    budgetName: String(item.costCenter),
                                    amount: Number(item.budget || 0),
                                });
                            }
                        });
                        setActiveNativeBudgets(Array.from(deduped.values()));
                    } else {
                        setBudgetData(null);
                        setBudgetsBySub({});
                        setActiveNativeBudgets([]);
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
    }, [selectedTenant, subscriptions, accounts, instance, isMock]);

    // Historial de gasto mensual por suscripción (últimos 6 meses)
    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || (accounts.length === 0 && !isMock) || subscriptions.length === 0) {
            setMonthlyHistoryBySub({});
            return;
        }

        let isMounted = true;
        setMonthlyHistoryLoading(true);

        const fetchMonthly = async () => {
            try {
                const idToken = accounts.length > 0 ? await getFreshIdToken(instance, accounts[0]) : '';
                const results = await Promise.all(subscriptions.map(async (sub) => {
                    try {
                        const res = await fetch(`/api/intelligence/cost-projection?tenantId=${selectedTenant.id}&subscriptionId=${sub.id}`, {
                            headers: idToken ? { 'Authorization': `Bearer ${idToken}` } : {}
                        });
                        const json = await res.json();
                        const history: BudgetMonthlyChartPoint[] = (json.monthlyHistory || []).slice(-6);
                        return [sub.id, history] as const;
                    } catch {
                        return [sub.id, []] as const;
                    }
                }));

                if (isMounted) {
                    setMonthlyHistoryBySub(Object.fromEntries(results));
                }
            } catch (e) {
                console.error("Error fetching monthly cost history for budget cards:", e);
            } finally {
                if (isMounted) setMonthlyHistoryLoading(false);
            }
        };

        fetchMonthly();

        return () => {
            isMounted = false;
        };
    }, [selectedTenant, subscriptions, accounts, instance, isMock]);

    const handleSyncAzure = async () => {
        setSyncingAzure(true);
        try {
            if (isMock) {
                await new Promise((r) => setTimeout(r, 600));
                toast.success(t('remediation_sync_success'));
                return;
            }
            const idToken = accounts.length > 0 ? await getFreshIdToken(instance, accounts[0]) : '';
            const res = await fetch(`/api/budgets/burn?tenantId=${selectedTenant.id}&subscriptionId=All`, {
                headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
            });
            if (!res.ok) throw new Error('Failed to sync with Azure');
            toast.success(t('remediation_sync_success'));
        } catch (err) {
            toast.error(errorMessage(err) || 'Error syncing with Azure');
        } finally {
            setSyncingAzure(false);
        }
    };

    const renderFinancialBadge = (status: BudgetStatus = 'OK') => {
        switch (status) {
            case 'OK':
                return (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        {t('status_ok')}
                    </span>
                );
            case 'WARNING':
                return (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        {t('status_warning')}
                    </span>
                );
            case 'CRITICAL':
                return (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
                        {t('status_critical')}
                    </span>
                );
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    // Identificar suscripción con mayor desvío proyectado para acción 1
    const overBudgetSub = subscriptions.find((sub) => {
        const subData = budgetsBySub[sub.id];
        return subData && subData.budget > 0 && ((subData.forecastedMonthEndSpend || 0) > subData.budget || subData.actual > subData.budget);
    }) || subscriptions[0];

    const overBudgetSubData = overBudgetSub ? budgetsBySub[overBudgetSub.id] : null;
    const overBudgetPct = overBudgetSubData && overBudgetSubData.budget > 0 && overBudgetSubData.forecastedMonthEndSpend
        ? Math.round(((overBudgetSubData.forecastedMonthEndSpend - overBudgetSubData.budget) / overBudgetSubData.budget) * 100)
        : 0;

    return (
        <div className="w-full">
            {/* Global Tenant Budget Summary */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-6 mb-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-slate-800 pb-4 mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                            {t('consolidated_title')}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {t('subtitle')}
                        </p>
                    </div>
                    {budgetData && budgetData.budget_usd > 0 && (
                        <div>{renderFinancialBadge(budgetData.budgetStatus)}</div>
                    )}
                </div>
                
                {loading ? (
                    <div className="animate-pulse flex flex-col gap-4 mt-4">
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4"></div>
                        <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-1/2 mt-2"></div>
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-5/6"></div>
                    </div>
                ) : budgetData && budgetData.budget_usd > 0 ? (
                    <div className="flex flex-col gap-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* Assigned Budget */}
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                <div className="p-3 bg-[rgb(233,241,250)] dark:bg-slate-800 rounded-xl text-[#0054A6] dark:text-[#00AEEF]">
                                    <DollarSign className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('assigned_budget')}</p>
                                    <p className="text-xl font-bold text-[#1B2A41] dark:text-white font-mono">
                                        {currencyFormatter.format(budgetData.budget_usd)}
                                    </p>
                                </div>
                            </div>

                            {/* Consumed Spend */}
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                                <div className="p-3 bg-[rgb(233,241,250)] dark:bg-slate-800 rounded-xl text-[#0054A6] dark:text-[#00AEEF]">
                                    <Tag className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('current_consumption')}</p>
                                    <p className="text-xl font-bold text-[#1B2A41] dark:text-white font-mono">
                                        {currencyFormatter.format(budgetData.actual_spend)}
                                    </p>
                                </div>
                            </div>

                            {/* Daily Burn Rate */}
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('burn_rate')}</p>
                                <p className="text-xl font-bold text-[#0054A6] dark:text-blue-400 font-mono mt-1">
                                    {currencyFormatter.format(budgetData.dailyBurnRate || (budgetData.actual_spend / Math.max(1, new Date().getDate())))}{t('burn_rate_suffix')}
                                </p>
                            </div>

                            {/* Month End Forecast */}
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('projected_month_end')}</p>
                                <p className="text-xl font-bold text-[#1B2A41] dark:text-white font-mono mt-1">
                                    {currencyFormatter.format(budgetData.forecastedMonthEndSpend || budgetData.actual_spend)}
                                </p>
                            </div>
                        </div>
                        
                        {/* Progress Bar & Breach Alert */}
                        <div>
                            <div className="flex justify-between text-xs mb-1.5">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                    {t('current_consumption')}: <strong>{((budgetData.actual_spend / budgetData.budget_usd) * 100).toFixed(1)}%</strong>
                                </span>
                                <span className="font-semibold text-slate-500 dark:text-slate-400">
                                    {currencyFormatter.format(budgetData.actual_spend)} de {currencyFormatter.format(budgetData.budget_usd)}
                                </span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                                <div 
                                    className={`h-full rounded-full transition-all duration-500 ${
                                        budgetData.budget_usd > 0 && (budgetData.actual_spend / budgetData.budget_usd) * 100 >= 100
                                            ? 'bg-red-500'
                                            : budgetData.budget_usd > 0 && (budgetData.actual_spend / budgetData.budget_usd) * 100 >= budgetData.alert_threshold
                                            ? 'bg-amber-500'
                                            : 'bg-[#0054A6]'
                                    }`}
                                    style={{ width: `${Math.min((budgetData.actual_spend / budgetData.budget_usd) * 100, 100)}%` }}
                                ></div>
                            </div>

                            {/* Alerta Preventiva de Fecha Estimada de Exceso */}
                            {budgetData.forecastedBreachDate && (
                                <div className="mt-3 p-3 rounded-lg bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-300">
                                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                                    <span>
                                        {budgetData.forecastedBreachDate === 'Excedido'
                                            ? t('forecasted_breach_active')
                                            : t('forecasted_breach', { date: budgetData.forecastedBreachDate })}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="mt-4 text-sm text-gray-400 h-32 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-100 dark:border-slate-800 rounded-xl">
                        <p className="mb-3">{t('no_budget_configured')}</p>
                        <button 
                            onClick={() => {
                                setActiveSubscriptionForModal(subscriptions[0]?.id || '');
                                setModalMode('create');
                                setIsModalOpen(true);
                            }}
                            className="px-4 py-2 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 rounded-lg text-xs font-bold hover:bg-blue-50 transition-colors shadow-sm"
                        >
                            {t('configure_btn')}
                        </button>
                    </div>
                )}
            </div>

            {/* Opciones de Remediación y Alertas Proactivas FinOps */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-6 mb-6">
                <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-[#0054A6] dark:text-[#00AEEF]" />
                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                        {t('remediation_title')}
                    </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    {t('remediation_subtitle')}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Acción 1: Desvío Proyectado */}
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                    <AlertCircle className="w-4 h-4 text-amber-500" />
                                    {t('remediation_1_title')}
                                </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                {overBudgetSubData && overBudgetSubData.budget > 0
                                    ? t('remediation_1_desc', {
                                          forecast: currencyFormatter.format(overBudgetSubData.forecastedMonthEndSpend || overBudgetSubData.actual),
                                          budget: currencyFormatter.format(overBudgetSubData.budget),
                                          diff: overBudgetPct > 0 ? overBudgetPct : '11.3',
                                      })
                                    : t('all_subscriptions_healthy')}
                            </p>
                        </div>
                        <button
                            onClick={() => {
                                setActiveSubscriptionForModal(overBudgetSub?.id || subscriptions[0]?.id || '');
                                setModalMode('edit');
                                setIsModalOpen(true);
                            }}
                            className="w-full py-2 px-3 bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                        >
                            {t('remediation_1_btn')}
                        </button>
                    </div>

                    {/* Acción 2: Cost Center sin Presupuesto */}
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                    <Tag className="w-4 h-4 text-[#00AEEF]" />
                                    {t('remediation_2_title')}
                                </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                {t('remediation_2_desc', { costCenter: 'CostCenter: Databases' })}
                            </p>
                        </div>
                        <button
                            onClick={() => {
                                const el = document.getElementById('platform-budgets-section');
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="w-full py-2 px-3 bg-white dark:bg-slate-900 border border-[#00AEEF] text-[#00AEEF] dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                        >
                            {t('remediation_2_btn')}
                        </button>
                    </div>

                    {/* Acción 3: Sincronización Azure */}
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                    {t('remediation_3_title')}
                                </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                                {t('remediation_3_desc')}
                            </p>
                        </div>
                        <button
                            onClick={handleSyncAzure}
                            disabled={syncingAzure}
                            className="w-full py-2 px-3 bg-white dark:bg-slate-900 border border-[#10B981] text-[#10B981] hover:bg-emerald-50 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${syncingAzure ? 'animate-spin' : ''}`} />
                            {syncingAzure ? t('remediation_sync_running') : t('remediation_3_btn')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Subscriptions Grid */}
            <h3 className="text-lg font-bold text-[#1B2A41] dark:text-white mb-4" style={{ fontFamily: 'Montserrat, sans-serif' }}>
                {t('breakdown_by_subscription')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {subscriptions.map((sub) => {
                    const subData = budgetsBySub[sub.id] || { budget: 0, actual: 0 };
                    const realBudget = subData.budget;
                    const realSpend = subData.actual;
                    const spendPercentage = realBudget > 0 ? (realSpend / realBudget) * 100 : 0;
                    
                    return (
                        <div key={sub.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-5 flex flex-col justify-between">
                            <div>
                                <div className="flex items-start justify-between gap-2 mb-1">
                                    <h4 className="font-bold text-sm text-[#1B2A41] dark:text-white truncate" title={sub.name} style={{ fontFamily: 'Montserrat, sans-serif' }}>
                                        {sub.name}
                                    </h4>
                                    {realBudget > 0 && renderFinancialBadge(subData.budgetStatus)}
                                </div>
                                <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono mb-4 truncate">{sub.id}</p>
                                
                                <div className="flex justify-between items-end mb-2">
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{t('assigned')}</p>
                                        <p className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200 font-mono">{currencyFormatter.format(realBudget)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500">{t('consumed')}</p>
                                        <p className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200 font-mono">{currencyFormatter.format(realSpend)}</p>
                                    </div>
                                </div>

                                <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-2 mb-3 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${spendPercentage >= 100 ? 'bg-red-500' : spendPercentage >= 80 ? 'bg-amber-500' : 'bg-[#0054A6]'}`}
                                        style={{ width: `${Math.min(spendPercentage, 100)}%` }}
                                    ></div>
                                </div>

                                {realBudget > 0 && subData.dailyBurnRate !== undefined && (
                                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-3 bg-slate-50 dark:bg-slate-800/40 p-2 rounded-lg">
                                        <span>{t("burnLabel")} <strong className="text-slate-900 dark:text-white font-mono">{currencyFormatter.format(subData.dailyBurnRate)}{t("perDaySuffix")}</strong></span>
                                        <span>{t("forecastLabel")} <strong className="text-[#0054A6] dark:text-blue-400 font-mono">{currencyFormatter.format(subData.forecastedMonthEndSpend || realSpend)}</strong></span>
                                    </div>
                                )}

                                {realBudget > 0 && (
                                    <div className="mb-3 border-t border-gray-100 dark:border-slate-800 pt-2">
                                        <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{t('monthly_spend')}</p>
                                        <BudgetMonthlyChart
                                            data={monthlyHistoryBySub[sub.id] || []}
                                            budgetAmount={realBudget}
                                            forecastedSpend={subData.forecastedMonthEndSpend}
                                            loading={monthlyHistoryLoading && !monthlyHistoryBySub[sub.id]}
                                            height={120}
                                        />
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={() => {
                                    setActiveSubscriptionForModal(sub.id);
                                    setModalMode('edit');
                                    setIsModalOpen(true);
                                }}
                                className="w-full py-2 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-slate-800 border border-[#0054A6] rounded-lg text-xs font-semibold text-[#0054A6] dark:text-blue-400 transition-colors shadow-sm"
                            >
                                {t('configure_edit_budget')}
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
                initialMode={modalMode}
                nativeBudgets={activeNativeBudgets}
            />
        </div>
    );
}

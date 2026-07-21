"use client";
import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Save, Plus, Trash2, PieChart } from 'lucide-react';
import toast from 'react-hot-toast';
import Pagination, { usePagination } from '@/components/Pagination';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

// Contador module-level para generar keys estables client-side (no persisten,
// no se mandan al backend — sólo identidad de React entre renders).
let ruleKeySeq = 0;
const nextRuleKey = () => `rule-${++ruleKeySeq}`;

export default function AllocationManager() {
    const t = useTranslations('IntelligenceAllocation');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';

    const [rulesByResource, setRulesByResource] = useState<Record<string, any[]>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [paginationState, setPaginationState] = useState<Record<string, { page: number; pageSize: number }>>({});

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || t('fetchError'));
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id))) 
            ? `/api/intelligence/allocation-rules?tenantId=${selectedTenant.id}&tier=${tier}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    useEffect(() => {
        if (data?.data) {
            const grouped: Record<string, any[]> = {};
            data.data.forEach((rule: any) => {
                if (!grouped[rule.resourceName]) grouped[rule.resourceName] = [];
                grouped[rule.resourceName].push({
                    // _key: identidad estable para React (no se manda al backend,
                    // ver handleSave). Sin esto, las filas usaban el índice de
                    // paginación como key — al borrar una fila del medio, React
                    // reconciliaba mal el foco/valor de los inputs no controlados
                    // de las filas siguientes.
                    _key: nextRuleKey(),
                    targetCostCenter: rule.targetCostCenter,
                    allocationPercentage: Number(rule.allocationPercentage)
                });
            });
            setRulesByResource(grouped);
        }
    }, [data]);

    if (!selectedTenant || selectedTenant.id === 'default') return null;

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
            return <TierLockedNotice requiredTier={requiredTier} currentTier={tier} featureName={t('title')} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <p className="text-sm font-bold">{t('accessError', { message: error.message })}</p>
            </div>
        );
    }

    const addNewResourceRule = () => {
        const newResName = `${t('newResourcePrefix')}-${Object.keys(rulesByResource).length + 1}`;
        setRulesByResource(prev => ({
            ...prev,
            [newResName]: [{ _key: nextRuleKey(), targetCostCenter: t('defaultCostCenter'), allocationPercentage: 100 }]
        }));
    };

    const updateResourceName = (oldName: string, newName: string) => {
        if (oldName === newName || !newName) return;
        setRulesByResource(prev => {
            const copy = { ...prev };
            copy[newName] = copy[oldName];
            delete copy[oldName];
            return copy;
        });
    };

    const addAllocation = (resourceName: string) => {
        setRulesByResource(prev => {
            const current = [...prev[resourceName]];
            current.push({ _key: nextRuleKey(), targetCostCenter: t('newCostCenter'), allocationPercentage: 0 });
            return { ...prev, [resourceName]: current };
        });
    };

    const updateAllocation = (resourceName: string, index: number, field: string, value: any) => {
        setRulesByResource(prev => {
            const current = [...prev[resourceName]];
            current[index] = { ...current[index], [field]: value };
            return { ...prev, [resourceName]: current };
        });
    };

    const removeAllocation = (resourceName: string, index: number) => {
        setRulesByResource(prev => {
            const current = [...prev[resourceName]];
            current.splice(index, 1);
            if (current.length === 0) {
                const copy = { ...prev };
                delete copy[resourceName];
                return copy;
            }
            return { ...prev, [resourceName]: current };
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);

            // Flatten rules
            const flatRules: any[] = [];
            for (const resName of Object.keys(rulesByResource)) {
                let totalPct = 0;
                for (const rule of rulesByResource[resName]) {
                    totalPct += rule.allocationPercentage;
                    flatRules.push({
                        resourceName: resName,
                        targetCostCenter: rule.targetCostCenter,
                        allocationPercentage: rule.allocationPercentage
                    });
                }
                if (Math.abs(totalPct - 100) > 0.01) {
                    toast.error(t('notSum100Error', { name: resName, pct: totalPct }));
                    setIsSaving(false);
                    return;
                }
            }

            const response = await fetch(`/api/intelligence/allocation-rules`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ tenantId: selectedTenant.id, rules: flatRules })
            });

            if (!response.ok) throw new Error(t('saveFailed'));

            toast.success(t('saveSuccess'));
            mutate();
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('title')}</h3>
                    <p className="text-sm text-gray-500">{t('description')}</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={addNewResourceRule}
                        className="px-4 py-2 bg-white dark:bg-slate-800 text-brand-deep dark:text-brand-bright font-medium text-sm rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> {t('addResourceButton')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-4 py-2 bg-brand-deep hover:bg-brand-bright text-white font-medium text-sm rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {t('saveButton')}
                    </button>
                </div>
            </div>

            {Object.keys(rulesByResource).length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 border-dashed">
                    <PieChart className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 dark:text-gray-400">{t('emptyState', { button: t('addResourceButton') })}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {Object.keys(rulesByResource).map(resName => {
                        const totalPct = rulesByResource[resName].reduce((acc, r) => acc + r.allocationPercentage, 0);
                        const isBalanced = Math.abs(totalPct - 100) < 0.01;
                        
                        // Sin entrada en paginationState todavía (recurso recién
                        // agregado): el fallback inline alcanza, no hace falta
                        // setState acá — llamarlo durante el render (como antes)
                        // fuerza un re-render extra en cada resource nuevo.
                        const { page, pageSize } = paginationState[resName] || { page: 1, pageSize: 10 };
                        const start = (page - 1) * pageSize;
                        const paged = rulesByResource[resName].slice(start, start + pageSize);
                        const totalPages = Math.max(1, Math.ceil(rulesByResource[resName].length / pageSize));

                        return (
                            <div key={resName} className={`bg-white dark:bg-slate-900 rounded-xl border ${isBalanced ? 'border-gray-200 dark:border-slate-800' : 'border-red-300 dark:border-red-800'} overflow-hidden shadow-sm`}>
                                <div className={`p-4 border-b ${isBalanced ? 'border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50' : 'border-red-200 bg-red-50 dark:bg-red-900/20'}`}>
                                    <input 
                                        type="text" 
                                        defaultValue={resName}
                                        onBlur={(e) => updateResourceName(resName, e.target.value)}
                                        className="font-bold bg-transparent border-none p-0 focus:ring-0 w-full text-gray-900 dark:text-white"
                                        placeholder={t('resourceNamePlaceholder')}
                                    />
                                    <p className={`text-xs mt-1 ${isBalanced ? 'text-green-600 dark:text-green-400' : 'text-red-500 font-bold'}`}>
                                        {t('totalAllocated', { pct: totalPct })} {isBalanced ? '✓' : t('mustSumTo100')}
                                    </p>
                                </div>
                                
                                <div className="p-4 space-y-3">
                                    {paged.map((rule, idx) => (
                                        <div key={rule._key ?? idx} className="flex gap-2 items-center">
                                            <input 
                                                type="text" 
                                                value={rule.targetCostCenter}
                                                onChange={(e) => updateAllocation(resName, start + idx, 'targetCostCenter', e.target.value)}
                                                className="flex-1 rounded border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm p-2 focus:ring-brand-deep focus:border-brand-deep"
                                                placeholder={t('costCenterPlaceholder')}
                                            />
                                            <div className="relative w-20">
                                                <input 
                                                    type="number" 
                                                    value={rule.allocationPercentage}
                                                    onChange={(e) => updateAllocation(resName, start + idx, 'allocationPercentage', Number(e.target.value))}
                                                    className="w-full rounded border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm p-2 pr-6 focus:ring-brand-deep focus:border-brand-deep"
                                                />
                                                <span className="absolute right-2 top-2 text-gray-400 text-sm">%</span>
                                            </div>
                                            <button 
                                                onClick={() => removeAllocation(resName, start + idx)}
                                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                    
                                    <button 
                                        onClick={() => addAllocation(resName)}
                                        className="text-xs font-semibold text-brand-deep dark:text-brand-bright hover:underline mt-2 inline-flex items-center gap-1"
                                    >
                                        <Plus className="w-3 h-3" /> {t('addPercentageButton')}
                                    </button>
                                </div>

                                {rulesByResource[resName].length > pageSize && (
                                    <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800">
                                        <div className="flex items-center justify-between gap-2 text-xs">
                                            <span className="text-gray-500 dark:text-gray-400">
                                                {t.rich('showingRange', {
                                                    start: start + 1,
                                                    end: Math.min(start + pageSize, rulesByResource[resName].length),
                                                    total: rulesByResource[resName].length,
                                                    strong: (chunks) => <strong>{chunks}</strong>
                                                })}
                                            </span>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => setPaginationState(prev => ({ ...prev, [resName]: { pageSize: prev[resName]?.pageSize ?? 10, page: Math.max(1, page - 1) } }))}
                                                    disabled={page <= 1}
                                                    className="px-2 py-1 rounded border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800"
                                                >
                                                    ←
                                                </button>
                                                <span className="px-2 py-1 text-gray-700 dark:text-gray-300 font-bold">{page}/{totalPages}</span>
                                                <button
                                                    onClick={() => setPaginationState(prev => ({ ...prev, [resName]: { pageSize: prev[resName]?.pageSize ?? 10, page: Math.min(totalPages, page + 1) } }))}
                                                    disabled={page >= totalPages}
                                                    className="px-2 py-1 rounded border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-800"
                                                >
                                                    →
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

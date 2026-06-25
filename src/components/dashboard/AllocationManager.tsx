"use client";
import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Save, Plus, Trash2, PieChart } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AllocationManager() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';

    const [rulesByResource, setRulesByResource] = useState<Record<string, any[]>>({});
    const [isSaving, setIsSaving] = useState(false);

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");

        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Error al cargar reglas de asignación");
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
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
                <p className="text-gray-500 dark:text-gray-400">Cargando motor de asignación de costos...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <p className="text-sm font-bold">Error de Acceso: {error.message}</p>
            </div>
        );
    }

    const addNewResourceRule = () => {
        const newResName = `RecursoCompartido-${Object.keys(rulesByResource).length + 1}`;
        setRulesByResource(prev => ({
            ...prev,
            [newResName]: [{ targetCostCenter: 'General', allocationPercentage: 100 }]
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
            current.push({ targetCostCenter: 'Nuevo Centro', allocationPercentage: 0 });
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
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });

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
                    toast.error(`El recurso ${resName} no suma 100% (${totalPct}%)`);
                    setIsSaving(false);
                    return;
                }
            }

            const response = await fetch(`/api/intelligence/allocation-rules`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify({ tenantId: selectedTenant.id, rules: flatRules })
            });

            if (!response.ok) throw new Error("Fallo al guardar reglas");
            
            toast.success("Reglas de asignación guardadas exitosamente");
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
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Motor de Asignación de Costos</h3>
                    <p className="text-sm text-gray-500">Divide los costos de recursos compartidos (ExpressRoute, AKS, LogAnalytics) porcentualmente entre los centros de costos.</p>
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={addNewResourceRule}
                        className="px-4 py-2 bg-white dark:bg-slate-800 text-brand-deep dark:text-brand-bright font-medium text-sm rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> Añadir Recurso Compartido
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-4 py-2 bg-brand-deep hover:bg-brand-bright text-white font-medium text-sm rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Guardar Reglas
                    </button>
                </div>
            </div>

            {Object.keys(rulesByResource).length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 border-dashed">
                    <PieChart className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-500 dark:text-gray-400">No hay reglas de asignación configuradas. Haz clic en "Añadir Recurso Compartido" para empezar.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {Object.keys(rulesByResource).map(resName => {
                        const totalPct = rulesByResource[resName].reduce((acc, r) => acc + r.allocationPercentage, 0);
                        const isBalanced = Math.abs(totalPct - 100) < 0.01;

                        return (
                            <div key={resName} className={`bg-white dark:bg-slate-900 rounded-xl border ${isBalanced ? 'border-gray-200 dark:border-slate-800' : 'border-red-300 dark:border-red-800'} overflow-hidden shadow-sm`}>
                                <div className={`p-4 border-b ${isBalanced ? 'border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50' : 'border-red-200 bg-red-50 dark:bg-red-900/20'}`}>
                                    <input 
                                        type="text" 
                                        defaultValue={resName}
                                        onBlur={(e) => updateResourceName(resName, e.target.value)}
                                        className="font-bold bg-transparent border-none p-0 focus:ring-0 w-full text-gray-900 dark:text-white"
                                        placeholder="Nombre del Recurso"
                                    />
                                    <p className={`text-xs mt-1 ${isBalanced ? 'text-green-600 dark:text-green-400' : 'text-red-500 font-bold'}`}>
                                        Total asignado: {totalPct}% {isBalanced ? '✓' : '(Debe sumar 100%)'}
                                    </p>
                                </div>
                                
                                <div className="p-4 space-y-3">
                                    {rulesByResource[resName].map((rule, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <input 
                                                type="text" 
                                                value={rule.targetCostCenter}
                                                onChange={(e) => updateAllocation(resName, idx, 'targetCostCenter', e.target.value)}
                                                className="flex-1 rounded border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm p-2 focus:ring-brand-deep focus:border-brand-deep"
                                                placeholder="Centro de Costos"
                                            />
                                            <div className="relative w-20">
                                                <input 
                                                    type="number" 
                                                    value={rule.allocationPercentage}
                                                    onChange={(e) => updateAllocation(resName, idx, 'allocationPercentage', Number(e.target.value))}
                                                    className="w-full rounded border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm p-2 pr-6 focus:ring-brand-deep focus:border-brand-deep"
                                                />
                                                <span className="absolute right-2 top-2 text-gray-400 text-sm">%</span>
                                            </div>
                                            <button 
                                                onClick={() => removeAllocation(resName, idx)}
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
                                        <Plus className="w-3 h-3" /> Añadir Porcentaje
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

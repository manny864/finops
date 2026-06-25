"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PoliciesAsCode() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';
    
    const [toggling, setToggling] = useState<string | null>(null);

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
            throw new Error(json.error || "Error al cargar estado de políticas");
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
            ? `/api/admin/governance-policies?tenantId=${selectedTenant.id}&tier=${tier}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const handleToggle = async (policyId: string, currentStatus: string) => {
        if (!selectedTenant) return;
        setToggling(policyId);
        
        try {
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
            
            const newAction = currentStatus === 'Active' ? 'Deactivate' : 'Activate';

            const response = await fetch(`/api/admin/governance-policies`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify({ tenantId: selectedTenant.id, policyId, action: newAction })
            });

            const resData = await response.json();
            if (!response.ok) throw new Error(resData.error || "Fallo en la inyección de la política");
            
            toast.success(resData.message);
            
            // Si es entorno Mock, hacemos mutación optimista local
            if (data?.data) {
                const newData = data.data.map((p: any) => p.id === policyId ? { ...p, status: newAction === 'Activate' ? 'Active' : 'Inactive' } : p);
                mutate({ success: true, data: newData }, false);
            } else {
                mutate();
            }
            
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setToggling(null);
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Escaneando asignaciones de Azure Policy...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <p className="text-sm font-bold">Error: {error.message}</p>
            </div>
        );
    }

    const policies = data?.data || [];

    return (
        <div className="space-y-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-xl border border-blue-100 dark:border-blue-900/50 flex gap-4 items-start">
                <ShieldAlert className="w-6 h-6 text-brand-deep dark:text-brand-bright shrink-0 mt-1" />
                <div>
                    <h3 className="font-bold text-blue-900 dark:text-blue-100 text-lg">Gobernanza Automatizada</h3>
                    <p className="text-blue-800 dark:text-blue-300 text-sm mt-1">
                        Las políticas activadas aquí se inyectarán directamente en el Management Group de tu entorno Azure a través de <i>Azure Policy</i>. Evitan el despliegue de recursos costosos en la etapa de aprovisionamiento (<i>Shift-Left</i>).
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {policies.map((policy: any) => {
                    const isActive = policy.status === 'Active';
                    const isProcessing = toggling === policy.id;

                    return (
                        <div key={policy.id} className={`flex items-center justify-between p-5 rounded-xl border transition-all ${isActive ? 'bg-white dark:bg-slate-900 border-green-200 dark:border-green-900/50 shadow-sm' : 'bg-gray-50 dark:bg-slate-900/50 border-gray-200 dark:border-slate-800'}`}>
                            <div className="flex-1 pr-6">
                                <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 text-lg">
                                    {policy.name}
                                    {isActive && <span className="text-xs font-bold px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 rounded-full uppercase tracking-widest flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Aplicada</span>}
                                </h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm mt-2 leading-relaxed">
                                    {policy.description}
                                </p>
                            </div>
                            
                            <div className="shrink-0 flex items-center gap-4 border-l border-gray-200 dark:border-slate-700 pl-6 ml-6">
                                <button 
                                    onClick={() => handleToggle(policy.id, policy.status)}
                                    disabled={isProcessing}
                                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${isActive ? 'bg-green-500' : 'bg-gray-300 dark:bg-slate-700'}`}
                                >
                                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-8' : 'translate-x-1'}`} />
                                </button>
                                {isProcessing && <Loader2 className="w-5 h-5 text-gray-400 animate-spin absolute right-8" />}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

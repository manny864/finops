"use client";
import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, DollarSign, Percent, Save, Info } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PartnerMarkup() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';

    const [markup, setMarkup] = useState<number>(0);
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
            throw new Error(json.error || "Error al cargar configuración de precios");
        }
        return res.json();
    };

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
            ? `/api/admin/billing-markup?tenantId=${selectedTenant.id}&tier=${tier}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    useEffect(() => {
        if (data && typeof data.markupPercentage === 'number') {
            setMarkup(data.markupPercentage);
        }
    }, [data]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });

            const response = await fetch(`/api/admin/billing-markup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify({ tenantId: selectedTenant.id, markupPercentage: markup })
            });

            if (!response.ok) throw new Error("Fallo al guardar margen");
            
            toast.success("Margen de ganancia actualizado");
            mutate({ success: true, markupPercentage: markup }, false);
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Cargando motor de facturación MSP...</p>
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

    // CSP no detectado: panel informativo (NO error). El módulo sigue accesible
    // pero advierte que sin contexto Partner Center el margen no se proyecta sobre
    // costos facturados reales del CSP.
    const cspDetected = data?.cspDetected !== false;
    if (!cspDetected) {
        return (
            <div className="max-w-2xl">
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-5 flex gap-3">
                    <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-900 dark:text-amber-200 space-y-2">
                        <p className="font-bold">Tenant sin conexión CSP detectada</p>
                        <p>
                            {data?.message ||
                                "El motor de Partner Billing requiere snapshots con contexto Partner Center (billing_profile_id en CostSnapshots). Asegúrate de tener una suscripción Microsoft Customer Agreement / Partner Center activa y de ejecutar el sync de costos al menos una vez."}
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                            Puedes igualmente configurar un margen base, pero no se reflejará en facturas hasta que llegue el contexto CSP.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-2xl">
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="p-6 border-b border-gray-200 dark:border-slate-800">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-brand-deep dark:text-brand-bright" />
                        Ajuste de Margen Global (Markup)
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        Como proveedor de servicios (MSP), puedes definir un porcentaje de ganancia. Este margen se sumará automáticamente al costo base de Azure en todos los reportes de facturación, exportaciones PDF y dashboards visibles para tu cliente final.
                    </p>
                </div>
                
                <div className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Margen de Ganancia (Porcentaje %)</label>
                        <div className="relative max-w-xs">
                            <input 
                                type="number" 
                                min="0"
                                max="200"
                                step="0.1"
                                value={markup}
                                onChange={(e) => setMarkup(Number(e.target.value))}
                                className="w-full pl-4 pr-10 py-3 rounded-lg border border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white font-bold text-lg focus:ring-brand-deep focus:border-brand-deep"
                            />
                            <Percent className="w-5 h-5 text-gray-400 absolute right-3 top-3.5" />
                        </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-lg border border-gray-100 dark:border-slate-700">
                        <h4 className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">Simulación de Facturación</h4>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Costo Base Azure (Ejemplo):</span>
                            <span className="font-medium text-gray-900 dark:text-white">$10,000.00</span>
                        </div>
                        <div className="flex items-center justify-between text-sm mt-1">
                            <span className="text-gray-600 dark:text-gray-400">Tu Margen (+{markup}%):</span>
                            <span className="font-medium text-green-600 dark:text-green-400">+${((10000 * markup) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="h-px bg-gray-200 dark:bg-slate-700 my-2"></div>
                        <div className="flex items-center justify-between font-bold">
                            <span className="text-gray-900 dark:text-white">Costo Final Cobrado al Cliente:</span>
                            <span className="text-brand-deep dark:text-brand-bright">${(10000 * (1 + markup / 100)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-gray-50 dark:bg-slate-800/80 border-t border-gray-200 dark:border-slate-800 flex justify-end">
                    <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-2 bg-brand-deep hover:bg-brand-bright text-white font-bold rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        Aplicar Margen a Todo el Tenant
                    </button>
                </div>
            </div>
        </div>
    );
}

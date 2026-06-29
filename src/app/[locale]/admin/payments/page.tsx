"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { CreditCard, ExternalLink, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getFreshIdToken } from '@/lib/msalToken';
import MockBanner from '@/components/MockBanner';

export default function PaymentsPage() {
    const { selectedTenant, userRole } = useTenant();
    const { instance, accounts } = useMsal();
    
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;
        
        const loadBilling = async () => {
            setLoading(true);
            try {
                const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
                
                const res = await fetch(`/api/billing/portal?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                
                if (res.ok) {
                    setData(json);
                } else {
                    setData({ error: json.error || "Error al cargar la información de pagos." });
                }
            } catch (e) {
                console.error("Error loading billing:", e);
                setData({ error: "Error de conexión." });
            }
            setLoading(false);
        };
        loadBilling();
    }, [selectedTenant.id, accounts, instance]);

    if (userRole !== 'Admin') {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <ShieldCheck className="w-12 h-12 text-gray-400 mb-4" />
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Acceso Denegado</h2>
                <p className="text-sm text-gray-500 mt-2">Solo los administradores pueden gestionar la suscripción.</p>
            </div>
        );
    }

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <CreditCard className="w-12 h-12 text-gray-400 mb-4" />
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Selecciona un entorno</h2>
                <p className="text-sm text-gray-500 mt-2">Por favor selecciona un Tenant en el menú superior para ver su facturación.</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-8 border-b border-gray-200 dark:border-gray-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <CreditCard className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                    Suscripción y Pagos
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Gestiona el plan actual de {selectedTenant.name}, actualiza tus métodos de pago o cancela la suscripción.
                </p>
            </div>

            {loading ? (
                <div className="flex justify-center items-center h-32">
                    <Loader2 className="w-8 h-8 animate-spin text-[#0054A6]" />
                </div>
            ) : data?.error ? (
                <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-xl p-6 flex items-start">
                    <AlertCircle className="w-6 h-6 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
                    <div>
                        <h3 className="text-lg font-bold text-red-800 dark:text-red-400">Atención</h3>
                        <p className="text-sm text-red-600 dark:text-red-300 mt-1">{data.error}</p>
                    </div>
                </div>
            ) : data?.isEnterprise ? (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-8 text-center">
                    <ShieldCheck className="w-12 h-12 text-[#0054A6] mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">Plan Enterprise Activo</h3>
                    <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
                        Tu cuenta está gestionada mediante facturación corporativa manual (Invoicing). Contacta a tu ejecutivo de cuenta para realizar cambios en tu suscripción.
                    </p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-8">
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">Estado de la Suscripción</h3>
                        <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${data.status === 'active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                            {data.status === 'active' ? 'Activa' : data.status || 'Desconocido'}
                        </span>
                    </div>
                    <div className="p-6">
                        <div className="mb-8">
                            <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Plan Actual</h4>
                            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{data.tier || 'Essential'}</p>
                        </div>

                        {data.managementUrls ? (
                            <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-gray-100 dark:border-slate-800">
                                {data.managementUrls.update_payment_method && (
                                    <a 
                                        href={data.managementUrls.update_payment_method} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="flex-1 flex justify-center items-center px-4 py-2.5 bg-[#0054A6] text-white rounded-md shadow-sm text-sm font-semibold hover:bg-[#004080] transition-colors"
                                    >
                                        <CreditCard className="w-4 h-4 mr-2" />
                                        Actualizar Método de Pago
                                        <ExternalLink className="w-3.5 h-3.5 ml-2 opacity-70" />
                                    </a>
                                )}
                                {data.managementUrls.cancel && (
                                    <a 
                                        href={data.managementUrls.cancel} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="flex-1 flex justify-center items-center px-4 py-2.5 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 rounded-md shadow-sm text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                                    >
                                        Cancelar Suscripción
                                        <ExternalLink className="w-3.5 h-3.5 ml-2 opacity-70" />
                                    </a>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">Los enlaces de gestión no están disponibles en este momento.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

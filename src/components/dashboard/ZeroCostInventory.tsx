"use client";
import React from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Box, Info } from 'lucide-react';

export default function ZeroCostInventory() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const fetcher = async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");

        const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["User.Read"],
            account: account
        });

        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${tokenResponse.idToken}`
            }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.details || json.error || "Error al cargar inventario");
        }

        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
            ? `/api/intelligence/zero-cost?tenantId=${selectedTenant.id}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Escaneando inventario de costo cero en Azure...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold">Error en la consulta KQL</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    const resources: any[] = data?.data || [];

    // Grouping
    const freeSkus = resources.filter(r => r.Motivo === "Capa Gratuita (Free SKU)");
    const archServices = resources.filter(r => r.Motivo === "Servicio de Gestión / Arquitectura (Sin costo base)");

    return (
        <div className="w-full space-y-8">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 flex gap-3 rounded-xl border border-blue-100 dark:border-blue-900/50 text-blue-800 dark:text-blue-300">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                    <p className="font-bold mb-1">Inventario de Costo Cero (Zero-Cost FinOps)</p>
                    <p>Estos recursos corren actualmente en tu infraestructura sin generar cargos en tu facturación, ya sea porque pertenecen a una capa gratuita promocional o porque son servicios de red/arquitectura que no tienen un costo base inherente. Mantener visibilidad de ellos es crucial para una gestión completa.</p>
                </div>
            </div>

            {resources.length === 0 ? (
                <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
                    <p className="text-slate-500 dark:text-slate-400">No se han detectado recursos de costo cero en las suscripciones conectadas.</p>
                </div>
            ) : (
                <>
                    <section>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                            <span className="p-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-md">
                                <Box className="w-4 h-4" />
                            </span>
                            Capa Gratuita (Free SKU)
                            <span className="ml-2 text-xs font-bold px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-500 rounded-full">{freeSkus.length}</span>
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {freeSkus.map((r, i) => (
                                <div key={i} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-4 shadow-sm hover:shadow transition-shadow">
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 truncate pr-2" title={r.name}>{r.name}</h3>
                                        <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full whitespace-nowrap">
                                            {r.skuName}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 truncate" title={r.type}>{r.type.split('/').pop()}</p>
                                    <p className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate" title={r.resourceGroup}>RG: {r.resourceGroup}</p>
                                </div>
                            ))}
                            {freeSkus.length === 0 && <p className="text-sm text-slate-500 col-span-full">No hay recursos en capa gratuita.</p>}
                        </div>
                    </section>

                    <section>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                            <span className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-md">
                                <Box className="w-4 h-4" />
                            </span>
                            Servicios de Arquitectura / Sin costo base
                            <span className="ml-2 text-xs font-bold px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-500 rounded-full">{archServices.length}</span>
                        </h2>
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">Recurso</th>
                                            <th className="px-4 py-3 font-semibold">Tipo</th>
                                            <th className="px-4 py-3 font-semibold">Resource Group</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                        {archServices.map((r, i) => (
                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                                <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{r.name}</td>
                                                <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">{r.type.split('/').pop()}</td>
                                                <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">{r.resourceGroup}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {archServices.length === 0 && <p className="text-sm text-slate-500 p-4">No hay servicios de arquitectura sin costo base.</p>}
                            </div>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}

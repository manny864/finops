"use client";
import React, { useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { BookOpen, Box, Loader2, CloudUpload } from 'lucide-react';
import { toast } from 'sonner';

export default function WorkbooksPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    
    const [subIdCost, setSubIdCost] = useState('');
    const [rgCost, setRgCost] = useState('');
    const [loadingCost, setLoadingCost] = useState(false);

    const [subIdZombie, setSubIdZombie] = useState('');
    const [rgZombie, setRgZombie] = useState('');
    const [loadingZombie, setLoadingZombie] = useState(false);

    const handleDeploy = async (type: string, subscriptionId: string, resourceGroupName: string, setLoading: (s: boolean) => void) => {
        if (!subscriptionId || !resourceGroupName) {
            toast.error("Por favor ingresa Subscription ID y Resource Group.");
            return;
        }
        if (accounts.length === 0) {
            toast.error("No hay cuenta de Azure activa.");
            return;
        }

        setLoading(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });

            const res = await fetch(`/api/admin/workbooks`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ subscriptionId, resourceGroupName })
            });
            
            const json = await res.json();
            if (res.ok && json.success) {
                toast.success(`Artefacto desplegado correctamente en ${resourceGroupName}`);
            } else {
                toast.error(json.error || "Error al desplegar el artefacto");
            }
        } catch (e) {
            console.error(e);
            toast.error("Ocurrió un error inesperado al desplegar.");
        }
        setLoading(false);
    };

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para inyectar artefactos.</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-slate-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <BookOpen className="w-8 h-8 mr-3 text-[#0054A6]" />
                    Artefactos y Workbooks
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Inyecta tableros de control y reportes directamente en el entorno de Azure del cliente.</p>
            </div>

            <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 flex items-center">
                    <Box className="w-5 h-5 mr-2 text-gray-500" />
                    Artefactos Disponibles
                </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Cost Optimization Workbook */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col">
                    <div className="h-2 bg-[#0054A6]"></div>
                    <div className="p-6 flex-1">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">FinOps Cost Optimization Workbook</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Tablero completo basado en Azure Monitor para visualizar gastos, anomalías y predicciones de costos.</p>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Subscription ID</label>
                                <input 
                                    type="text" 
                                    value={subIdCost}
                                    onChange={e => setSubIdCost(e.target.value)}
                                    placeholder="ej. xxxx-xxxx-xxxx-xxxx"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Resource Group de Destino</label>
                                <input 
                                    type="text" 
                                    value={rgCost}
                                    onChange={e => setRgCost(e.target.value)}
                                    placeholder="ej. rg-finops-management"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm focus:ring-[#0054A6] focus:border-[#0054A6] sm:text-sm"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-800">
                        <button 
                            onClick={() => handleDeploy('cost', subIdCost, rgCost, setLoadingCost)}
                            disabled={loadingCost}
                            className="w-full flex justify-center items-center px-4 py-2 bg-[#0054A6] hover:bg-blue-800 text-white rounded-md shadow-sm text-sm font-semibold transition-colors disabled:opacity-50"
                        >
                            {loadingCost ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CloudUpload className="w-4 h-4 mr-2" />}
                            {loadingCost ? 'Desplegando...' : 'Desplegar en Azure'}
                        </button>
                    </div>
                </div>

                {/* Zombie Resources Tracker */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col">
                    <div className="h-2 bg-emerald-500"></div>
                    <div className="p-6 flex-1">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Zombie Resources Tracker</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Herramienta especializada para identificar IPs públicas sin uso, discos huérfanos y NSGs desasociados.</p>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Subscription ID</label>
                                <input 
                                    type="text" 
                                    value={subIdZombie}
                                    onChange={e => setSubIdZombie(e.target.value)}
                                    placeholder="ej. xxxx-xxxx-xxxx-xxxx"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Resource Group de Destino</label>
                                <input 
                                    type="text" 
                                    value={rgZombie}
                                    onChange={e => setRgZombie(e.target.value)}
                                    placeholder="ej. rg-finops-management"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-800">
                        <button 
                            onClick={() => handleDeploy('zombie', subIdZombie, rgZombie, setLoadingZombie)}
                            disabled={loadingZombie}
                            className="w-full flex justify-center items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md shadow-sm text-sm font-semibold transition-colors disabled:opacity-50"
                        >
                            {loadingZombie ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CloudUpload className="w-4 h-4 mr-2" />}
                            {loadingZombie ? 'Desplegando...' : 'Desplegar en Azure'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

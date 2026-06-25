"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Calculator, Play, Network, HardDrive, Cpu, ShieldCheck } from 'lucide-react';
import RoleAssignmentBanner from '@/components/RoleAssignmentBanner';
import { hasAccess } from '@/lib/tierLogic';
import { toast } from 'sonner';

export default function SimulatorPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const isEnterprise = hasAccess(selectedTenant.tier || 'Essential', 'Enterprise');
    
    const [networkIncrease, setNetworkIncrease] = useState(0);
    const [computeScale, setComputeScale] = useState(100);
    const [storageScale, setStorageScale] = useState(100);
    const [applyAhb, setApplyAhb] = useState(false);
    
    const [loading, setLoading] = useState(false);
    const [simulationData, setSimulationData] = useState<any>(null);

    const handleSimulate = async () => {
        if (!isEnterprise) return;
        setLoading(true);
        try {
            const account = accounts[0];
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: account
            });

            const res = await fetch('/api/intelligence/simulator', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    scenario: {
                        baseCost: 25000, // starting mock baseline
                        networkIncrease,
                        computeScale: computeScale / 100,
                        storageScale: storageScale / 100,
                        applyAhb
                    }
                })
            });

            const json = await res.json();
            if (res.ok) {
                setSimulationData(json.simulation);
                toast.success("Simulación completada.");
            } else {
                toast.error(json.error || "Fallo en simulación.");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error al conectar con la API de Simulación.");
        } finally {
            setLoading(false);
        }
    };

    if (selectedTenant.id === 'default') return null;

    if (!isEnterprise) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Calculator className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Simulador de Escenarios (What-If)</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        Proyecta costos futuros basados en cambios de arquitectura, incrementos de tráfico o migraciones a gran escala.
                        Esta característica está disponible exclusivamente en el plan <b>Enterprise</b>.
                    </p>
                    <button className="px-6 py-3 bg-brand-deep text-white font-bold rounded-lg shadow hover:bg-brand-bright transition-colors">
                        Actualizar Plan
                    </button>
                </div>
            </div>
        );
    }

    const chartData = simulationData ? [
        {
            name: 'Actual',
            Compute: 25000 * 0.6,
            Storage: 25000 * 0.25,
            Network: 25000 * 0.15,
        },
        {
            name: 'Proyectado',
            Compute: simulationData.breakdown.compute,
            Storage: simulationData.breakdown.storage,
            Network: simulationData.breakdown.network,
        }
    ] : [];

    return (
        <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <Calculator className="w-8 h-8 text-indigo-500" />
                    Simulador de Escenarios
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Modela el impacto financiero de cambios arquitectónicos antes de ejecutarlos.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Controles */}
                <div className="lg:col-span-1 flex flex-col gap-6">
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 border-b border-gray-100 dark:border-slate-800 pb-3">
                            Variables del Escenario
                        </h3>

                        <div className="flex flex-col gap-6">
                            {/* Compute */}
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                    <Cpu className="w-4 h-4 text-brand-deep" />
                                    Crecimiento de Cómputo (VMs/AKS)
                                </label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" min="50" max="300" step="10" 
                                        value={computeScale} onChange={(e) => setComputeScale(parseInt(e.target.value))}
                                        className="w-full accent-brand-deep"
                                    />
                                    <span className="text-sm font-bold w-12 text-right">{computeScale}%</span>
                                </div>
                            </div>

                            {/* Network */}
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                    <Network className="w-4 h-4 text-emerald-500" />
                                    Aumento Egress de Red
                                </label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" min="-50" max="200" step="10" 
                                        value={networkIncrease} onChange={(e) => setNetworkIncrease(parseInt(e.target.value))}
                                        className="w-full accent-emerald-500"
                                    />
                                    <span className="text-sm font-bold w-12 text-right">{networkIncrease > 0 ? '+' : ''}{networkIncrease}%</span>
                                </div>
                            </div>

                            {/* Storage */}
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                    <HardDrive className="w-4 h-4 text-amber-500" />
                                    Expansión de Almacenamiento
                                </label>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" min="50" max="500" step="25" 
                                        value={storageScale} onChange={(e) => setStorageScale(parseInt(e.target.value))}
                                        className="w-full accent-amber-500"
                                    />
                                    <span className="text-sm font-bold w-12 text-right">{storageScale}%</span>
                                </div>
                            </div>

                            {/* AHB */}
                            <div className="flex items-center justify-between border-t border-gray-100 dark:border-slate-800 pt-4 mt-2">
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className="w-5 h-5 text-indigo-500" />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Aplicar Licencias (AHB)</span>
                                        <span className="text-[10px] text-gray-500">Trae tus propias licencias de Win/SQL</span>
                                    </div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" checked={applyAhb} onChange={() => setApplyAhb(!applyAhb)} />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-500"></div>
                                </label>
                            </div>

                            <button 
                                onClick={handleSimulate}
                                disabled={loading}
                                className="mt-4 w-full py-3 bg-brand-deep hover:bg-brand-bright text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {loading ? <span className="animate-pulse">Calculando...</span> : <><Play className="w-4 h-4" /> Ejecutar Simulación</>}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Resultados */}
                <div className="lg:col-span-2">
                    {simulationData ? (
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col h-full animate-in zoom-in-95 duration-300">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Impacto Financiero Proyectado</h3>
                            
                            <div className="grid grid-cols-2 gap-4 mb-8">
                                <div className="p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-100 dark:border-slate-700">
                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Costo Base (Actual)</p>
                                    <p className="text-3xl font-black text-gray-800 dark:text-gray-100">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(simulationData.baseCost)}
                                    </p>
                                </div>
                                <div className={`p-4 rounded-lg border ${simulationData.projectedCost > simulationData.baseCost ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50'}`}>
                                    <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${simulationData.projectedCost > simulationData.baseCost ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                        Costo Proyectado
                                    </p>
                                    <div className="flex items-end gap-3">
                                        <p className={`text-3xl font-black ${simulationData.projectedCost > simulationData.baseCost ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(simulationData.projectedCost)}
                                        </p>
                                        <p className={`text-sm font-bold mb-1 ${simulationData.projectedCost > simulationData.baseCost ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            {simulationData.projectedCost > simulationData.baseCost ? '+' : ''}
                                            {(((simulationData.projectedCost - simulationData.baseCost) / simulationData.baseCost) * 100).toFixed(1)}%
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 min-h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontWeight: 600 }} />
                                        <YAxis tickFormatter={(v) => `$${v/1000}k`} axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                                        <Tooltip 
                                            formatter={(value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                        <Bar dataKey="Compute" stackId="a" fill="#0054A6" radius={[0, 0, 4, 4]} />
                                        <Bar dataKey="Storage" stackId="a" fill="#F59E0B" />
                                        <Bar dataKey="Network" stackId="a" fill="#10B981" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col items-center justify-center h-full min-h-[400px] text-center">
                            <Calculator className="w-16 h-16 text-gray-300 dark:text-gray-700 mb-4" />
                            <h3 className="text-xl font-bold text-gray-500 dark:text-gray-400 mb-2">Listo para Simular</h3>
                            <p className="text-gray-400 dark:text-gray-500 max-w-sm">
                                Ajusta los parámetros en el panel izquierdo y haz clic en "Ejecutar Simulación" para ver el impacto financiero.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { TrendingDown, Loader2, Target, DollarSign, PiggyBank } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function HistoricalProgressPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any[]>([]);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                const res = await fetch(`/api/intelligence/history`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.data) {
                    setData(json.data);
                }
            } catch (e) {
                console.error(e);
            }
            setLoading(false);
        };
        fetchData();
    }, [selectedTenant, accounts, instance]);

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para ver su progreso.</p>
            </div>
        );
    }

    let achievedSavings = 0;
    if (data.length > 1) {
        const first = data[0].total_wasted_usd;
        const last = data[data.length - 1].total_wasted_usd;
        achievedSavings = first - last;
    }

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-slate-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <TrendingDown className="w-8 h-8 mr-3 text-emerald-500" />
                    Progreso Histórico de Ahorros
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Visualiza la evolución de los costos desperdiciados y la eficiencia a lo largo del tiempo.</p>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-emerald-500" />
                    Analizando historia de costos...
                </div>
            ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm">
                    <TrendingDown className="w-16 h-16 text-gray-300 dark:text-slate-600 mb-4" />
                    <h2 className="text-xl font-bold text-gray-500 dark:text-gray-400 mb-2">Sin datos históricos</h2>
                    <p className="text-sm text-gray-400 dark:text-gray-500 text-center max-w-md">
                        Aún no se han registrado escaneos de optimización para este Tenant.
                        Los datos se generarán automáticamente a medida que se ejecuten auditorías de costos.
                    </p>
                </div>
            ) : (
                <>
                    {/* Summary Metric Card */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl shadow-lg border border-emerald-600 p-6 flex flex-col items-center justify-center text-white transform hover:scale-[1.02] transition-transform">
                            <PiggyBank className="w-8 h-8 mb-3 opacity-80" />
                            <h3 className="text-emerald-100 text-sm font-medium uppercase tracking-wider mb-1">Ahorro Total Logrado</h3>
                            <div className="flex items-baseline">
                                <span className="text-3xl font-bold">${achievedSavings > 0 ? achievedSavings.toFixed(2) : '0.00'}</span>
                            </div>
                        </div>
                        
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col items-center justify-center">
                            <DollarSign className="w-8 h-8 mb-3 text-gray-400" />
                            <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium uppercase tracking-wider mb-1">Costo Desperdiciado Actual</h3>
                            <div className="flex items-baseline">
                                <span className="text-3xl font-bold text-rose-500 dark:text-rose-400">
                                    ${data.length > 0 ? data[data.length - 1].total_wasted_usd.toFixed(2) : '0.00'}
                                </span>
                            </div>
                        </div>
                        
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col items-center justify-center">
                            <Target className="w-8 h-8 mb-3 text-gray-400" />
                            <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium uppercase tracking-wider mb-1">Ahorro Potencial</h3>
                            <div className="flex items-baseline">
                                <span className="text-3xl font-bold text-amber-500 dark:text-amber-400">
                                    ${data.length > 0 ? data[data.length - 1].potential_savings_usd.toFixed(2) : '0.00'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Line Chart */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Curva de Optimización</h2>
                        <div className="h-96 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
                                    <XAxis 
                                        dataKey="scan_date" 
                                        tick={{ fill: '#64748b', fontSize: 12 }}
                                        tickMargin={10}
                                        axisLine={false}
                                    />
                                    <YAxis 
                                        tickFormatter={(val) => `$${val}`} 
                                        tick={{ fill: '#64748b', fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                                        itemStyle={{ color: '#f8fafc' }}
                                        formatter={(value: any) => [`$${Number(value).toFixed(2)}`, '']}
                                    />
                                    <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                    <Line 
                                        type="monotone" 
                                        dataKey="total_wasted_usd" 
                                        name="Desperdicio Total" 
                                        stroke="#f43f5e" 
                                        strokeWidth={3}
                                        dot={{ r: 4, strokeWidth: 2 }}
                                        activeDot={{ r: 6 }}
                                    />
                                    <Line 
                                        type="monotone" 
                                        dataKey="potential_savings_usd" 
                                        name="Ahorro Potencial" 
                                        stroke="#f59e0b" 
                                        strokeWidth={3}
                                        strokeDasharray="5 5"
                                        dot={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

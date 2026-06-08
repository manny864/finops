"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { TrendingUp, Loader2, MapPin, BarChart3, Check, Ruler, Moon, Flag } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

    const formatYAxis = (tickItem: any) => {
        if (tickItem >= 1000) {
            return `$${(tickItem / 1000).toFixed(1)}k`;
        }
        return `$${tickItem}`;
    };

    const CustomDot = (props: any) => {
        const { cx, cy, index } = props;
        if (index === data.length - 1) {
            return (
                <circle cx={cx} cy={cy} r={6} stroke="#10b981" strokeWidth={3} fill="#ffffff" />
            );
        }
        return null;
    };

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <div className="flex items-center">
                        <div className="bg-blue-600 rounded-lg p-2 mr-3 text-white">
                            <TrendingUp className="w-5 h-5" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Progreso Histórico</h1>
                    </div>
                    <p className="text-sm text-slate-500 mt-1 ml-12">Evolución histórica del gasto y del ahorro capturado en el tenant.</p>
                </div>
                <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-sm">
                    <MapPin className="w-3 h-3 mr-1 text-red-500 fill-red-500" />
                    Tenant completo
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-emerald-500" />
                    Cargando datos...
                </div>
            ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm">
                    <BarChart3 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
                    <h2 className="text-lg font-bold text-slate-500 dark:text-slate-400">Sin datos históricos</h2>
                    <p className="text-sm text-slate-400 text-center max-w-md">
                        Aún no hay datos para mostrar.
                    </p>
                </div>
            ) : (
                <>
                    {/* Summary Metric Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 flex flex-col justify-center">
                            <h3 className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Ahorro Mensual Capturado</h3>
                            <div className="text-3xl font-extrabold text-emerald-500">
                                ${achievedSavings > 0 ? achievedSavings.toFixed(0) : '0'}
                            </div>
                        </div>
                        
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 flex flex-col justify-center">
                            <h3 className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Proyección De Ahorro Anual</h3>
                            <div className="text-3xl font-extrabold text-blue-600">
                                ${(achievedSavings * 12 > 0) ? (achievedSavings * 12).toFixed(0) : '0'}
                            </div>
                        </div>
                        
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 flex flex-col justify-center">
                            <h3 className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Reducción Del Gasto</h3>
                            <div className="text-3xl font-extrabold text-amber-500">
                                0.0%
                            </div>
                        </div>
                    </div>

                    {/* Chart */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6 mb-6">
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center text-slate-700 dark:text-slate-300 font-semibold text-sm">
                                <BarChart3 className="w-4 h-4 mr-2 text-slate-400" />
                                Gasto mensual · últimos 12 meses
                            </div>
                            <div className="text-xs text-slate-400 font-medium">
                                Tenant completo · USD
                            </div>
                        </div>
                        <div className="h-72 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorGasto" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                                    <XAxis 
                                        dataKey="scan_date" 
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                        tickMargin={10}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis 
                                        tickFormatter={formatYAxis} 
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        itemStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                                        formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Gasto']}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="total_wasted_usd" 
                                        stroke="#10b981" 
                                        strokeWidth={3}
                                        fillOpacity={1} 
                                        fill="url(#colorGasto)" 
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                        dot={<CustomDot />}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Hitos */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center text-slate-700 dark:text-slate-300 font-bold text-sm bg-white dark:bg-slate-900">
                            <Flag className="w-4 h-4 mr-2 text-slate-500" />
                            Hitos
                        </div>
                        <div className="divide-y divide-gray-50 dark:divide-slate-800">
                            {/* Hito 1 */}
                            <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded-lg mr-4 mt-1">
                                    <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Onboarding del tenant</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Conexión vía Entra ID y primera línea base de gasto establecida.</p>
                                </div>
                            </div>
                            {/* Hito 2 */}
                            <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <div className="bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg mr-4 mt-1 border border-blue-100 dark:border-blue-800/50">
                                    <Ruler className="w-5 h-5 text-blue-500 dark:text-blue-400" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Programa de rightsizing</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Revisión continua de SKUs sobre métricas P95.</p>
                                </div>
                            </div>
                            {/* Hito 3 */}
                            <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <div className="bg-amber-50 dark:bg-amber-900/30 p-2 rounded-lg mr-4 mt-1 border border-amber-100 dark:border-amber-800/50">
                                    <Moon className="w-5 h-5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Apagado automático en no-productivos</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Power schedules activos en QA y DEV.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

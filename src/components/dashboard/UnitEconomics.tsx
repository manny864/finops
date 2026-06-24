"use client";
import React, { useMemo } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, TrendingDown, TrendingUp, Users, DollarSign, Activity } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

export default function UnitEconomics() {
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
            throw new Error(json.details || json.error || "Error al cargar métricas");
        }

        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
            ? `/api/intelligence/unit-economics?tenantId=${selectedTenant.id}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const metrics = useMemo(() => {
        if (!data || !data.data || data.data.length === 0) return null;
        
        const rawData = data.data;
        const totalCost = rawData.reduce((acc: number, curr: any) => acc + curr.cost, 0);
        const totalDau = rawData.reduce((acc: number, curr: any) => acc + curr.dau, 0);
        const avgCostPerUser = totalDau > 0 ? totalCost / totalDau : 0;

        // Tendencia sencilla comparando la primera y segunda mitad del mes
        const half = Math.floor(rawData.length / 2);
        const firstHalf = rawData.slice(0, half);
        const secondHalf = rawData.slice(half);

        const cpuFirst = firstHalf.reduce((acc: number, curr: any) => acc + curr.cost, 0) / firstHalf.reduce((acc: number, curr: any) => acc + curr.dau, 1);
        const cpuSecond = secondHalf.reduce((acc: number, curr: any) => acc + curr.cost, 0) / secondHalf.reduce((acc: number, curr: any) => acc + curr.dau, 1);

        let trendPercent = 0;
        if (cpuFirst > 0) {
            trendPercent = ((cpuSecond - cpuFirst) / cpuFirst) * 100;
        }

        return {
            avgCostPerUser,
            trendPercent,
            chartData: rawData.map((d: any) => ({
                ...d,
                // Convertir a centavos para una mejor legibilidad en el gráfico secundario
                costPerUserCents: Number((d.costPerUser * 100).toFixed(2)),
                costDisplay: Number(d.cost.toFixed(2))
            }))
        };
    }, [data]);

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Analizando economía unitaria (Costo vs Valor de Negocio)...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold">Error de Procesamiento</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!metrics) {
        return (
            <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">No hay datos suficientes para calcular economía unitaria en este tenant.</p>
            </div>
        );
    }

    const isTrendGood = metrics.trendPercent <= 0;

    return (
        <div className="w-full space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Users className="w-16 h-16 text-brand-deep" />
                    </div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Costo Promedio por Usuario (DAU)</p>
                    <div className="flex items-end gap-3 z-10">
                        <p className="text-3xl font-black text-gray-900 dark:text-white">
                            ${metrics.avgCostPerUser.toFixed(4)}
                        </p>
                    </div>
                    <div className="mt-4 flex items-center text-sm z-10">
                        <span className={`flex items-center font-bold px-2 py-0.5 rounded-full ${isTrendGood ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {isTrendGood ? <TrendingDown className="w-4 h-4 mr-1" /> : <TrendingUp className="w-4 h-4 mr-1" />}
                            {Math.abs(metrics.trendPercent).toFixed(1)}%
                        </span>
                        <span className="ml-2 text-gray-500 dark:text-gray-400">
                            {isTrendGood ? 'Excelente eficiencia' : 'Alerta de ineficiencia'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Composite Chart */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Activity className="w-5 h-5 text-brand-deep" />
                            Gasto Nube vs Costo por Transacción (30 días)
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Las barras representan el gasto absoluto en Azure. La línea representa tu verdadero margen de eficiencia (Costo por Usuario).
                        </p>
                    </div>
                </div>

                <div className="h-[400px] w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={metrics.chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" className="dark:stroke-gray-700" />
                            <XAxis 
                                dataKey="date" 
                                tickFormatter={(val) => val.split('-').slice(1).join('/')} 
                                stroke="#9CA3AF" 
                                tick={{ fill: '#6B7280', fontSize: 12 }} 
                            />
                            
                            {/* Eje Y Izquierdo: Costo Absoluto ($) */}
                            <YAxis 
                                yAxisId="left" 
                                tickFormatter={(val) => `$${val}`} 
                                stroke="#9CA3AF" 
                                tick={{ fill: '#6B7280', fontSize: 12 }}
                            />
                            
                            {/* Eje Y Derecho: Costo por Usuario en Centavos (¢) */}
                            <YAxis 
                                yAxisId="right" 
                                orientation="right" 
                                tickFormatter={(val) => `${val}¢`} 
                                stroke="#9CA3AF" 
                                tick={{ fill: '#6B7280', fontSize: 12 }}
                            />
                            
                            <Tooltip 
                                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                labelStyle={{ color: '#374151', fontWeight: 'bold', marginBottom: '8px' }}
                                formatter={(value: any, name: any) => {
                                    if (name === "Costo Nube ($)") return [`$${value.toFixed(2)}`, name];
                                    if (name === "Costo por Usuario (Centavos)") return [`${value}¢`, name];
                                    return [value, name];
                                }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            
                            <Bar 
                                yAxisId="left" 
                                dataKey="costDisplay" 
                                name="Costo Nube ($)" 
                                fill="#E0E7FF" 
                                radius={[4, 4, 0, 0]} 
                            />
                            
                            <Line 
                                yAxisId="right" 
                                type="monotone" 
                                dataKey="costPerUserCents" 
                                name="Costo por Usuario (Centavos)" 
                                stroke="#0054A6" 
                                strokeWidth={3}
                                dot={{ r: 3, fill: "#0054A6", strokeWidth: 2, stroke: "#fff" }}
                                activeDot={{ r: 6 }}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

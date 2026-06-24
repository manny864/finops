"use client";
import React, { useMemo } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, TrendingUp, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip
} from 'recharts';

export default function Commitments() {
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
            ? `/api/intelligence/commitments?tenantId=${selectedTenant.id}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const metrics = useMemo(() => {
        if (!data || !data.data) return null;
        return data.data;
    }, [data]);

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Analizando Descuentos por Compromiso...</p>
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

    if (!metrics) return null;

    const utilizationColor = metrics.utilization >= 80 ? '#10B981' : (metrics.utilization >= 70 ? '#F59E0B' : '#EF4444');
    const utilizationData = [
        { name: 'Utilizado', value: metrics.utilization },
        { name: 'Desperdicio', value: 100 - metrics.utilization }
    ];

    const coverageColor = metrics.coverage >= 60 ? '#3B82F6' : '#6366F1';
    const coverageData = [
        { name: 'Cubierto por Reserva', value: metrics.coverage },
        { name: 'Pago por Uso (On-Demand)', value: 100 - metrics.coverage }
    ];

    return (
        <div className="w-full space-y-6">
            
            {/* Top Section: Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Utilización */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col items-center">
                    <div className="w-full flex justify-between items-start mb-2">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-green-500" />
                                Utilización de Reservas
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Target >80%. Porcentaje de la reserva pagada que realmente estás usando.</p>
                        </div>
                    </div>
                    
                    <div className="h-48 w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={utilizationData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    startAngle={90}
                                    endAngle={-270}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    <Cell fill={utilizationColor} />
                                    <Cell fill="#E5E7EB" className="dark:fill-slate-700" />
                                </Pie>
                                <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                            <span className="text-3xl font-black text-gray-900 dark:text-white" style={{ color: utilizationColor }}>
                                {metrics.utilization.toFixed(1)}%
                            </span>
                        </div>
                    </div>
                    {metrics.utilization < 70 && (
                        <div className="mt-2 w-full flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-2 rounded text-sm font-medium">
                            <AlertCircle className="w-4 h-4" /> Alerta: Estás perdiendo dinero en reservas ociosas.
                        </div>
                    )}
                </div>

                {/* Cobertura */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col items-center">
                    <div className="w-full flex justify-between items-start mb-2">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-blue-500" />
                                Cobertura de Cómputo
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Porcentaje de infraestructura total corriendo bajo tarifas con descuento.</p>
                        </div>
                    </div>
                    
                    <div className="h-48 w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={coverageData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    startAngle={90}
                                    endAngle={-270}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    <Cell fill={coverageColor} />
                                    <Cell fill="#E5E7EB" className="dark:fill-slate-700" />
                                </Pie>
                                <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                            <span className="text-3xl font-black text-gray-900 dark:text-white" style={{ color: coverageColor }}>
                                {metrics.coverage.toFixed(1)}%
                            </span>
                        </div>
                    </div>
                </div>

            </div>

            {/* Bottom Section: Data Table */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Oportunidades de Compra</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Recomendaciones sugeridas por Azure basadas en tu consumo de los últimos 30 días.</p>

                {metrics.recommendations.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No hay recomendaciones de compra disponibles actualmente.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                            <thead className="bg-gray-50 dark:bg-slate-800/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Servicio</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">SKU</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Plazo</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cantidad Sugerida</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ahorro Mensual</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
                                {metrics.recommendations.map((rec: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{rec.type}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{rec.sku}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{rec.term}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-semibold">{rec.recommendedQuantity}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-400 font-bold text-right">${rec.monthlySavings.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

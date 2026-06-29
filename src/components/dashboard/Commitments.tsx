"use client";
import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, TrendingUp, ShieldCheck, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
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
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

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

    const hasReservations: boolean = Boolean(metrics.hasReservations);
    const utilizationKnown: boolean = typeof metrics.utilization === 'number' && metrics.utilization >= 0;
    const utilizationValue: number = utilizationKnown ? Number(metrics.utilization) : 0;

    const utilizationColor = !utilizationKnown
        ? '#9CA3AF'
        : utilizationValue >= 80 ? '#10B981' : (utilizationValue >= 70 ? '#F59E0B' : '#EF4444');
    const utilizationData = utilizationKnown
        ? [
            { name: 'Utilizado', value: utilizationValue },
            { name: 'Desperdicio', value: 100 - utilizationValue }
          ]
        : [{ name: 'Sin datos', value: 100 }];

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
                            <p className="text-xs text-gray-500 dark:text-gray-400">Target &gt;80%. Porcentaje de la reserva pagada que realmente estás usando.</p>
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
                                <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                            <span className="text-3xl font-black text-gray-900 dark:text-white" style={{ color: utilizationColor }}>
                                {utilizationKnown ? `${utilizationValue.toFixed(1)}%` : 'N/D'}
                            </span>
                        </div>
                    </div>
                    {!hasReservations ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-400 p-2 rounded text-sm">
                            <AlertCircle className="w-4 h-4" /> Sin reservas activas en este tenant.
                        </div>
                    ) : !utilizationKnown ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 p-2 rounded text-sm">
                            <AlertCircle className="w-4 h-4" /> Utilización no disponible: requiere permiso Billing Reader (EA/MCA).
                        </div>
                    ) : utilizationValue < 70 ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-2 rounded text-sm font-medium">
                            <AlertCircle className="w-4 h-4" /> Alerta: Estás perdiendo dinero en reservas ociosas.
                        </div>
                    ) : null}
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
                                <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
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
                    <>
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
                                {metrics.recommendations.slice((page - 1) * pageSize, page * pageSize).map((rec: any, idx: number) => (
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
                    {(() => {
                        const total = metrics.recommendations.length;
                        const totalPages = Math.max(1, Math.ceil(total / pageSize));
                        const safePage = Math.min(page, totalPages);
                        const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
                        const to = Math.min(safePage * pageSize, total);
                        return (
                            <div className="flex items-center justify-between mt-4 px-1 text-sm">
                                <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                                    <span>Mostrando <strong className="text-gray-900 dark:text-white">{from}-{to}</strong> de <strong className="text-gray-900 dark:text-white">{total}</strong></span>
                                    <select
                                        value={pageSize}
                                        onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                                        className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-2 py-1 text-xs font-semibold cursor-pointer"
                                    >
                                        <option value={5}>5 / pág</option>
                                        <option value={10}>10 / pág</option>
                                        <option value={20}>20 / pág</option>
                                        <option value={50}>50 / pág</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={safePage <= 1}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                                    </button>
                                    <span className="text-gray-700 dark:text-gray-300 font-bold px-2">Página {safePage} de {totalPages}</span>
                                    <button
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                        disabled={safePage >= totalPages}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    >
                                        Siguiente <ChevronRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                    </>
                )}
            </div>
        </div>
    );
}

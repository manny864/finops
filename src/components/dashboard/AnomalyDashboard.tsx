"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Activity, AlertTriangle, TrendingUp, CheckCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';
import { hasAccess } from '@/lib/tierLogic';
import PremiumBanner from '@/components/PremiumBanner';

export default function AnomalyDashboard() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';
    const isPro = hasAccess(tier, 'Professional');

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
            throw new Error(json.error || "Error al cargar anomalías");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (isPro && selectedTenant && selectedTenant.id !== 'default' && accounts.length > 0) 
            ? `/api/intelligence/anomalies?tenantId=${selectedTenant.id}&tier=${tier}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (!isPro) {
        return (
            <PremiumBanner 
                title="Detección de Anomalías (ML Z-Score)" 
                description="Caza picos de gasto inusuales mediante Machine Learning (Z-Score) antes de que impacten tu presupuesto mensual." 
                requiredTier="Professional" 
                icon="zap"
            />
        );
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500">Cazando anomalías mediante Machine Learning (Z-Score)...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100">
                <p className="font-bold">Error: {error.message}</p>
            </div>
        );
    }

    if (!data?.dailyCosts || data.dailyCosts.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-8 text-center">
                <Activity className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Sin datos suficientes</h3>
                <p className="text-gray-500 mt-2">El motor requiere al menos 60 días de historial de facturación de Azure para establecer una línea base estadística confiable.</p>
            </div>
        );
    }

    const mean = data.mean || 0;
    const stdDev = data.stdDev || 0;
    const upperBound = mean + (3 * stdDev);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const val = payload[0].value;
            const isSpike = val > upperBound;
            return (
                <div className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700">
                    <p className="font-bold text-gray-900 dark:text-white mb-1">{label}</p>
                    <p className={`font-mono text-lg ${isSpike ? 'text-red-500' : 'text-brand-deep dark:text-brand-bright'}`}>
                        ${val.toFixed(2)}
                    </p>
                    {isSpike && <p className="text-xs text-red-500 font-bold mt-1">¡Desviación Crítica!</p>}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Stats */}
                <div className="col-span-1 space-y-4">
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400">
                                <Activity className="w-5 h-5" />
                            </div>
                            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Gasto Base (Media)</h3>
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">${mean.toFixed(2)}</p>
                        <p className="text-xs text-gray-500 mt-1">Promedio móvil de 60 días</p>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-purple-600 dark:text-purple-400">
                                <TrendingUp className="w-5 h-5" />
                            </div>
                            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Tolerancia Z-Score (3σ)</h3>
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">±${(3 * stdDev).toFixed(2)}</p>
                        <p className="text-xs text-gray-500 mt-1">Límite de alerta: ${upperBound.toFixed(2)}</p>
                    </div>

                    {data.anomalies.length > 0 ? (
                        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-900/50 p-5 shadow-sm animate-in zoom-in">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg text-red-600 dark:text-red-400 animate-pulse">
                                    <AlertTriangle className="w-5 h-5" />
                                </div>
                                <h3 className="text-sm font-bold text-red-700 dark:text-red-400">¡Anomalía Activa!</h3>
                            </div>
                            <p className="text-2xl font-bold text-red-800 dark:text-red-300">
                                ${data.anomalies[0].amount.toFixed(2)}
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">
                                Z-Score: {data.anomalies[0].z_score.toFixed(2)} (Impacto: +${(data.anomalies[0].amount - mean).toFixed(2)})
                            </p>
                        </div>
                    ) : (
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-900/50 p-5 shadow-sm">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle className="w-5 h-5" />
                                </div>
                                <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Comportamiento Normal</h3>
                            </div>
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">No se detectaron desviaciones estadísticas en los últimos 7 días.</p>
                        </div>
                    )}
                </div>

                {/* Chart */}
                <div className="col-span-1 lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Banda de Confianza vs Costo Real</h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.dailyCosts}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.2} />
                                <XAxis 
                                    dataKey="date" 
                                    tick={{ fontSize: 12, fill: '#6B7280' }} 
                                    tickFormatter={(val) => val.split('-').slice(1).join('/')}
                                />
                                <YAxis 
                                    tick={{ fontSize: 12, fill: '#6B7280' }}
                                    tickFormatter={(val) => `$${val}`}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                
                                {/* Base Expected Band */}
                                <ReferenceArea y1={Math.max(0, mean - (3*stdDev))} y2={upperBound} fill="#3b82f6" fillOpacity={0.05} />
                                <ReferenceLine y={upperBound} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'top', value: 'Límite (3σ)', fill: '#ef4444', fontSize: 10 }} />
                                
                                <Line 
                                    type="monotone" 
                                    dataKey="amount" 
                                    stroke="#0ea5e9" 
                                    strokeWidth={3}
                                    dot={(props: any) => {
                                        const { cx, cy, value } = props;
                                        if (value > upperBound) {
                                            return <circle cx={cx} cy={cy} r={6} fill="#ef4444" stroke="#ffffff" strokeWidth={2} />;
                                        }
                                        return <circle cx={cx} cy={cy} r={0} />;
                                    }}
                                    activeDot={{ r: 6, fill: '#0ea5e9', stroke: '#ffffff', strokeWidth: 2 }} 
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
            
            {/* Anomalies List */}
            {data.anomalies.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-red-50/50 dark:bg-red-900/10">
                        <h3 className="text-md font-bold text-red-700 dark:text-red-400 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Registro de Incidentes Z-Score
                        </h3>
                    </div>
                    <div className="divide-y divide-gray-200 dark:divide-slate-800">
                        {data.anomalies.map((anomaly: any) => (
                            <div key={anomaly.id} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="px-2.5 py-1 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 text-xs font-bold rounded-full">
                                            {anomaly.status}
                                        </span>
                                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{anomaly.date}</span>
                                    </div>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white mt-2">
                                        Pico de costo en <span className="font-mono text-brand-deep dark:text-brand-bright bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">{anomaly.subscription_id}</span>
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xl font-bold text-red-600 dark:text-red-400">${anomaly.amount.toFixed(2)}</p>
                                    <p className="text-xs text-gray-500">vs Esperado: ${anomaly.expected_amount.toFixed(2)}</p>
                                    <button className="mt-3 text-sm font-bold text-brand-deep hover:text-brand-bright transition-colors">
                                        Investigar Causas Ráiz →
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

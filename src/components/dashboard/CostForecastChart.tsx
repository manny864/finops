"use client";
import React, { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '../TenantProvider';
import { useSubscription } from '../SubscriptionProvider';
import { useMetric } from '../MetricProvider';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, Loader2 } from 'lucide-react';

export default function CostForecastChart() {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { metricType } = useMetric();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [breachInfo, setBreachInfo] = useState<{ isBreachPredicted: boolean, breachDate: string | null } | null>(null);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default' || !selectedSubscription) return;
        
        const fetchForecast = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                const res = await fetch(`/api/intelligence/forecast?tenantId=${selectedTenant.id}&subscriptionId=${selectedSubscription}`, {
                    headers: { 
                        'Authorization': `Bearer ${tokenResponse.idToken}`,
                        'x-metric-type': metricType
                    }
                });
                const json = await res.json();
                if (json.data) {
                    setData(json.data);
                }

                // Call new POST API to get predictive breach warning
                try {
                    const postRes = await fetch('/api/intelligence/forecast', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tenantId: selectedTenant.id, monthlyBudget: 8000 })
                    });
                    const postJson = await postRes.json();
                    if (postJson.success) {
                        setBreachInfo({
                            isBreachPredicted: postJson.isBreachPredicted,
                            breachDate: postJson.breachDate
                        });
                    }
                } catch(e) {
                    console.error("Predictive breach API failed", e);
                }

            } catch (e) {
                console.error("Error fetching forecast:", e);
            }
            setLoading(false);
        };
        fetchForecast();
    }, [accounts, instance, selectedTenant.id, selectedSubscription, metricType]);

    if (accounts.length === 0 || selectedTenant.id === 'default') return null;

    return (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg shadow-sm p-6 h-full flex flex-col">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2 flex items-center">
                <TrendingUp className="w-5 h-5 mr-2 text-indigo-500" />
                Proyección de Costos
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Muestra el gasto actual acumulado y proyecta el cierre a fin de mes.</p>
            
            {breachInfo?.isBreachPredicted && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    ¡Atención! Se proyecta un exceso de presupuesto para el {breachInfo.breachDate}.
                </div>
            )}
            
            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center text-gray-400">
                        <Loader2 className="w-8 h-8 animate-spin mb-2 text-indigo-500" />
                        <span className="text-sm">Proyectando tendencias...</span>
                    </div>
                </div>
            ) : data.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm text-gray-400 text-center">
                    Sin datos de proyección disponibles para esta suscripción.
                </div>
            ) : (
                <div className="flex-1 w-full min-w-0" style={{ minHeight: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <defs>
                                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                            <XAxis 
                                dataKey="date" 
                                tickFormatter={(val: string) => {
                                    const parts = val.split('-');
                                    if(parts.length===3) return `${parts[2]}/${parts[1]}`;
                                    return val;
                                }}
                                tick={{ fontSize: 12, fill: '#6b7280' }} 
                            />
                            <YAxis 
                                tickFormatter={(val: any) => `$${val}`} 
                                tick={{ fontSize: 12, fill: '#6b7280' }} 
                            />
                            <Tooltip 
                                formatter={(val: any, name: any) => [`$${Number(val).toFixed(2)}`, name === 'actualCost' ? 'Gasto Actual' : 'Gasto Proyectado']}
                                labelFormatter={(label: any) => `Fecha: ${label}`}
                            />
                            <Legend />
                            <Area 
                                type="monotone" 
                                dataKey="actualCost" 
                                name="Gasto Actual" 
                                stroke="#0ea5e9" 
                                strokeWidth={3}
                                fillOpacity={1} 
                                fill="url(#colorActual)" 
                                connectNulls
                            />
                            <Area 
                                type="monotone" 
                                dataKey="forecastCost" 
                                name="Gasto Proyectado" 
                                stroke="#8b5cf6" 
                                strokeDasharray="5 5" 
                                strokeWidth={2}
                                fillOpacity={0}
                                connectNulls
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

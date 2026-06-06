"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Activity, AlertTriangle, ArrowDownToLine, Loader2, Search } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { toast } from 'sonner';

export default function NetworkAnalyticsPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<any[]>([]);
    const [subscriptionId, setSubscriptionId] = useState('');
    const [hasAnalyzed, setHasAnalyzed] = useState(false);
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const [loadingSubs, setLoadingSubs] = useState(false);

    useEffect(() => {
        if (!selectedTenant || selectedTenant.id === 'default' || accounts.length === 0) return;

        const fetchSubscriptions = async () => {
            setLoadingSubs(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                const res = await fetch(`/api/subscriptions?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.subscriptions) {
                    setSubscriptions(json.subscriptions);
                    if (json.subscriptions.length > 0) {
                        setSubscriptionId(json.subscriptions[0].id);
                    }
                }
            } catch (e) {
                console.error("Error fetching subscriptions:", e);
                toast.error("Error al cargar las suscripciones del tenant.");
            }
            setLoadingSubs(false);
        };
        fetchSubscriptions();
        setHasAnalyzed(false);
        setData([]);
    }, [selectedTenant.id, accounts, instance]);

    const handleAnalyze = async () => {
        if (!subscriptionId) {
            toast.error("Por favor selecciona una suscripción.");
            return;
        }
        if (accounts.length === 0 || selectedTenant.id === 'default') {
            toast.error("Selecciona un Tenant y asegúrate de estar autenticado.");
            return;
        }

        setLoading(true);
        setHasAnalyzed(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            const res = await fetch(`/api/intelligence/network?subscriptionId=${subscriptionId}`, {
                headers: { 
                    'Authorization': `Bearer ${tokenResponse.idToken}`,
                    'x-tenant-id': selectedTenant.id
                }
            });
            const json = await res.json();
            if (res.ok && json.data) {
                setData(json.data);
                toast.success("Análisis de red completado.");
            } else {
                toast.error(json.message || "Error al analizar la red.");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error inesperado en el análisis de red.");
        }
        setLoading(false);
    };

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para ver la analítica.</p>
            </div>
        );
    }

    // Grouping by subCategory for PieChart
    const pieDataMap = data.reduce((acc, curr) => {
        acc[curr.subCategory] = (acc[curr.subCategory] || 0) + curr.cost;
        return acc;
    }, {} as Record<string, number>);
    
    const pieData = Object.keys(pieDataMap).map(k => ({ name: k, value: pieDataMap[k] }));
    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

    // Grouping by Resource Group for Table
    const rgDataMap = data.reduce((acc, curr) => {
        if (!acc[curr.resourceGroup]) {
            acc[curr.resourceGroup] = { resourceGroup: curr.resourceGroup, totalCost: 0, subCategories: new Set<string>() };
        }
        acc[curr.resourceGroup].totalCost += curr.cost;
        acc[curr.resourceGroup].subCategories.add(curr.subCategory);
        return acc;
    }, {} as Record<string, any>);

    const tableData = Object.values(rgDataMap)
        .map((rg: any) => ({ ...rg, subCategories: Array.from(rg.subCategories).join(", ") }))
        .sort((a: any, b: any) => b.totalCost - a.totalCost)
        .slice(0, 5); // Top 5

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-slate-800 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                        <Activity className="w-8 h-8 mr-3 text-indigo-500" />
                        Análisis de Red y Egress
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">Identifica y optimiza los costos ocultos de transferencia de datos cruzada y de salida.</p>
                </div>
                <div className="flex items-center gap-2">
                    <select 
                        value={subscriptionId}
                        onChange={e => setSubscriptionId(e.target.value)}
                        disabled={loadingSubs || subscriptions.length === 0}
                        className="w-64 px-3 py-2 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                        {loadingSubs ? (
                            <option value="">Cargando suscripciones...</option>
                        ) : subscriptions.length === 0 ? (
                            <option value="">Sin suscripciones</option>
                        ) : (
                            subscriptions.map(sub => (
                                <option key={sub.id} value={sub.id}>{sub.displayName || sub.id}</option>
                            ))
                        )}
                    </select>
                    <button 
                        onClick={handleAnalyze}
                        disabled={loading}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md shadow-sm text-sm font-semibold transition-colors disabled:opacity-50 flex items-center"
                    >
                        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {!loading && <Search className="w-4 h-4 mr-2" />}
                        <span>Analizar</span>
                    </button>
                </div>
            </div>

            {/* Recommendation Alert */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 p-4 mb-8 rounded-r-md shadow-sm">
                <div className="flex">
                    <div className="flex-shrink-0">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                    </div>
                    <div className="ml-3">
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                            <strong>Recomendación FinOps:</strong> Considera desplegar <em>Azure Private Link</em> o evaluar el enrutamiento de tráfico cruzado (Cross-Region) para reducir significativamente los costos de ancho de banda y salida (Egress).
                        </p>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
                    Obteniendo métricas de ancho de banda...
                </div>
            ) : hasAnalyzed ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Pie Chart Card */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center">
                            <ArrowDownToLine className="w-5 h-5 mr-2 text-gray-500" />
                            Distribución de Costos de Red
                        </h2>
                        {pieData.length > 0 ? (
                            <div className="flex-1 w-full h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={80}
                                            outerRadius={110}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {pieData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                                        <Legend verticalAlign="bottom" height={36} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-400">Sin datos de red recientes.</div>
                        )}
                    </div>

                    {/* Top 5 Table Card */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 overflow-hidden flex flex-col">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">
                            Top 5 Resource Groups por Egress
                        </h2>
                        <div className="overflow-x-auto flex-1">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-800">
                                <thead>
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Resource Group</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tipo de Tráfico</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Costo Estimado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                                    {tableData.length > 0 ? tableData.map((rg: any, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">
                                                {rg.resourceGroup}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={rg.subCategories}>
                                                {rg.subCategories}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-bold text-indigo-600 dark:text-indigo-400">
                                                ${rg.totalCost.toFixed(2)}
                                            </td>
                                        </tr>
                                    )) : (
                                        <tr>
                                            <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                                                No se encontró tráfico relevante.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-lg">
                    <Activity className="w-12 h-12 text-gray-400 mb-4" />
                    <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm">Ingresa el Subscription ID y presiona Analizar para descubrir costos ocultos de red.</p>
                </div>
            )}
        </div>
    );
}

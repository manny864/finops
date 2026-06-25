"use client";
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Server, Layers, Cpu, Database } from 'lucide-react';
import { hasAccess } from '@/lib/tierLogic';
import { toast } from 'sonner';

export default function AksChargebackPage() {
    const { selectedTenant } = useTenant();
    const isEnterprise = hasAccess(selectedTenant.tier || 'Essential', 'Enterprise');
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!isEnterprise || selectedTenant.id === 'default') {
            setLoading(false);
            return;
        }

        const fetchData = async () => {
            try {
                const res = await fetch(`/api/intelligence/aks-chargeback?tenantId=${selectedTenant.id}`);
                const json = await res.json();
                if (res.ok) {
                    setData(json);
                } else {
                    toast.error(json.error || "Fallo al cargar datos de AKS.");
                }
            } catch (e) {
                console.error(e);
                toast.error("Error de red al conectar con AKS API.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [selectedTenant, isEnterprise]);

    if (selectedTenant.id === 'default') return null;

    if (!isEnterprise) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Server className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Kubernetes Chargeback (OpenCost)</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        Desglosa los costos de tus clústeres de AKS por Namespace, Pods y Deployments basados en reservas de CPU y RAM.
                        Esta característica está disponible exclusivamente en el plan <b>Enterprise</b>.
                    </p>
                    <button className="px-6 py-3 bg-brand-deep text-white font-bold rounded-lg shadow hover:bg-brand-bright transition-colors">
                        Actualizar a Enterprise
                    </button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-6 max-w-6xl mx-auto flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-semibold">Analizando métricas del Clúster...</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">Error al cargar datos.</div>;

    const COLORS = ['#0054A6', '#10B981', '#F59E0B', '#6366F1', '#EC4899', '#94A3B8'];

    const pieData = data.chargebackData.map((ns: any) => ({
        name: ns.namespace,
        value: ns.totalCost
    })).sort((a: any, b: any) => b.value - a.value);

    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    return (
        <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                    <Layers className="w-8 h-8 text-indigo-500" />
                    Distribución de Costos AKS
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                    <Server className="w-4 h-4" /> <b>Clúster:</b> {data.clusterName}
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Costo Total del Clúster</h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{formatter.format(data.totalClusterCost)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Capacidad Cómputo (Nodos)</h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                        <Cpu className="w-6 h-6 text-brand-deep" /> {data.totalClusterCpuCores} Cores
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Namespaces Activos</h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{data.chargebackData.length}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Pie Chart */}
                <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col items-center">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white w-full border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">Chargeback</h3>
                    <div className="w-full h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={90}
                                    paddingAngle={3}
                                    dataKey="value"
                                >
                                    {pieData.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <RechartsTooltip formatter={(value: number) => formatter.format(value)} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Table */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white w-full border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">Desglose por Namespace</h3>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">Namespace</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">CPU (Cores)</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">Costo Compute</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">Costo Storage</th>
                                    <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">Costo Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.chargebackData.map((ns: any, idx: number) => (
                                    <tr key={ns.namespace} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                                                {ns.namespace}
                                                {ns.namespace === 'idle-capacity' && <span className="text-[10px] bg-amber-100 text-amber-800 px-1 rounded">No Asignado</span>}
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 text-right">{ns.cpuCores}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 text-right">{formatter.format(ns.computeCost)}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 text-sm text-gray-600 dark:text-gray-400 text-right">{formatter.format(ns.storageCost)}</td>
                                        <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-bold text-sm text-brand-deep text-right">{formatter.format(ns.totalCost)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

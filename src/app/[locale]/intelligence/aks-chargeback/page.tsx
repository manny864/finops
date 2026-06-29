"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Server, Layers, Cpu, Info } from 'lucide-react';
import { hasAccess } from '@/lib/tierLogic';
import { toast } from 'sonner';
import Pagination, { usePagination } from '@/components/Pagination';
import PinButton from '@/components/dashboard/PinButton';

export default function AksChargebackPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const isEnterprise = hasAccess(selectedTenant.tier || 'Essential', 'Enterprise');
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [selectedCluster, setSelectedCluster] = useState<string>('');

    const { page, setPage, pageSize, setPageSize, total, totalPages, paged: pagedChargebackData } = usePagination(data?.chargebackData);

    useEffect(() => {
        if (!isEnterprise || selectedTenant.id === 'default' || accounts.length === 0) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        const fetchData = async () => {
            setLoading(true);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                const url = new URL(`/api/intelligence/aks-chargeback`, window.location.origin);
                url.searchParams.set('tenantId', selectedTenant.id);
                if (selectedCluster) url.searchParams.set('clusterName', selectedCluster);
                const res = await fetch(url.toString(), {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (cancelled) return;
                if (res.ok) {
                    setData(json);
                    if (!selectedCluster && json.availableClusters?.length) {
                        setSelectedCluster(json.availableClusters[0].name);
                    }
                } else {
                    toast.error(json.error || "Fallo al cargar datos de AKS.");
                }
            } catch (e: any) {
                if (cancelled) return;
                console.error(e);
                toast.error("Error de red al conectar con AKS API.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchData();
        return () => { cancelled = true; };
    }, [selectedTenant.id, isEnterprise, accounts.length, selectedCluster, instance]);

    if (selectedTenant.id === 'default') return null;

    if (!isEnterprise) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Server className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Kubernetes Chargeback (OpenCost)</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        Desglosa los costos de tus clústeres de AKS por Namespace, Pods y Deployments.
                        Disponible exclusivamente en plan <b>Enterprise</b>.
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

    if (data.empty) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Layers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">No se detectaron recursos AKS</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        No hemos encontrado ningún clúster de Azure Kubernetes Service (AKS) aprovisionado en las suscripciones vinculadas a este Tenant.
                    </p>
                </div>
            </div>
        );
    }

    const COLORS = ['#0054A6', '#10B981', '#F59E0B', '#6366F1', '#EC4899', '#94A3B8'];
    const availableClusters: any[] = data.availableClusters || [];
    const hasNamespaceBreakdown = data.namespaceBreakdownAvailable === true;

    const pieData = (data.chargebackData || []).map((ns: any) => ({
        name: ns.namespace,
        value: ns.totalCost
    })).sort((a: any, b: any) => b.value - a.value);

    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    return (
        <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
                        <Layers className="w-8 h-8 text-indigo-500" />
                        Distribución de Costos AKS
                        <PinButton widgetKey="intelligence.aks-chargeback" />
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                        <Server className="w-4 h-4" /> <b>Clúster:</b> {data.clusterName}
                    </p>
                </div>
                {availableClusters.length > 1 && (
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 dark:text-gray-400">Clúster:</label>
                        <select
                            value={selectedCluster}
                            onChange={(e) => setSelectedCluster(e.target.value)}
                            className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                        >
                            {availableClusters.map((c: any) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {!hasNamespaceBreakdown && (
                <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-4 flex gap-3 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-bold mb-1">Desglose por namespace no disponible</p>
                        <p>
                            El chargeback granular (por namespace/deployment) requiere métricas del propio clúster vía OpenCost o Prometheus
                            (no expuestas por la Azure Management API). Mostramos el costo agregado del clúster (Node RG) y la capacidad de cómputo.
                            Para activar el desglose granular, instalá OpenCost en el clúster y configurá la integración.
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Costo Total del Clúster</h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{formatter.format(data.totalClusterCost || 0)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Capacidad Cómputo (Nodos)</h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                        <Cpu className="w-6 h-6 text-brand-deep" /> {data.totalClusterCpuCores || 0} Cores
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                        {hasNamespaceBreakdown ? 'Namespaces Activos' : 'Agregado'}
                    </h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{(data.chargebackData || []).length}</p>
                </div>
            </div>

            {hasNamespaceBreakdown && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col items-center">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white w-full border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">Chargeback</h3>
                        <div className="w-full h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                                        {pieData.map((_: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip formatter={(value: any) => formatter.format(value)} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

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
                                    {pagedChargebackData.map((ns: any, idx: number) => (
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
                        <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} />
                    </div>
                </div>
            )}
        </div>
    );
}

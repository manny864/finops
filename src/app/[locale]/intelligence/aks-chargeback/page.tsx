"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Server, Layers, Cpu, Info, RotateCw } from 'lucide-react';
import { hasAccess } from '@/lib/tierLogic';
import { toast } from 'sonner';
import Pagination, { usePagination } from '@/components/Pagination';
import PinButton from '@/components/dashboard/PinButton';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';

export default function AksChargebackPage() {
    const t = useTranslations("AksChargeback");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const isEnterprise = hasAccess(selectedTenant.tier || 'Professional', 'Enterprise');
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [selectedCluster, setSelectedCluster] = useState<string>('');

    const { page, setPage, pageSize, setPageSize, total, totalPages, paged: pagedChargebackData } = usePagination(data?.chargebackData);

    const fetchData = async (bust = false) => {
        if (!isEnterprise || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const url = new URL(`/api/intelligence/aks-chargeback`, window.location.origin);
            url.searchParams.set('tenantId', selectedTenant.id);
            if (selectedCluster) url.searchParams.set('clusterName', selectedCluster);
            if (bust) url.searchParams.set('bust', '1');
            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            const json = await res.json();
            if (res.ok) {
                setData(json);
                if (!selectedCluster && json.availableClusters?.length) {
                    setSelectedCluster(json.availableClusters[0].name);
                }
            } else {
                toast.error(json.error || t("toast_load_error"));
            }
        } catch (e: any) {
            console.error(e);
            toast.error(t("toast_network_error"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [selectedTenant.id, isEnterprise, accounts.length, selectedCluster, instance]);

    if (selectedTenant.id === 'default') return null;

    if (!isEnterprise) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Server className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t("gate_title")}</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        {t("gate_desc", { plan: "Enterprise" })}
                    </p>
                    <button className="px-6 py-3 bg-brand-deep text-white font-bold rounded-lg shadow hover:bg-brand-bright transition-colors">
                        {t("gate_upgrade_btn")}
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
                    <p className="text-gray-500 font-semibold">{t("loading")}</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">{t("load_error")}</div>;

    if (data.empty) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-sm">
                    <Layers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t("empty_title")}</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        {t("empty_desc")}
                    </p>
                </div>
            </div>
        );
    }

    const COLORS = ['#0054A6', '#10B981', '#F59E0B', '#6366F1', '#EC4899', '#94A3B8'];
    const availableClusters: any[] = data.availableClusters || [];
    const hasNamespaceBreakdown = data.namespaceBreakdownAvailable === true;
    const isNodePoolBreakdown = data.breakdownType === 'nodepool';

    const hasAnyCost = (data.chargebackData || []).some((ns: any) => Number(ns.totalCost || 0) > 0);
    const pieData = (data.chargebackData || []).map((ns: any) => ({
        name: ns.namespace,
        value: hasAnyCost ? Number(ns.totalCost || 0) : Number(ns.cpuCores || 1)
    })).filter((d: any) => d.value > 0).sort((a: any, b: any) => b.value - a.value);

    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <div className="p-6 max-w-6xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3 font-heading">
                        <Layers className="w-8 h-8 text-brand-deep" />
                        {t("page_title")}
                        <PinButton widgetKey="intelligence.aks-chargeback" />
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-2">
                        <Server className="w-4 h-4 text-brand-deep" /> <b>{t("cluster_label")}</b> {data.clusterName}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {availableClusters.length > 1 && (
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-500 dark:text-gray-400">{t("cluster_label")}</label>
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
                    <button
                        type="button"
                        onClick={() => fetchData(true)}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                    >
                        <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-brand-deep' : ''}`} />
                        <span>Actualizar</span>
                    </button>
                </div>
            </div>

            {isNodePoolBreakdown && (
                <div className="mb-6 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 rounded-xl p-4 flex gap-3 text-blue-900 dark:text-blue-200 text-sm">
                    <Info className="w-5 h-5 shrink-0 mt-0.5 text-brand-deep" />
                    <div>
                        <p className="font-semibold mb-0.5">{t("nodepool_breakdown_title")}</p>
                        <p className="text-xs text-blue-800/80 dark:text-blue-300/80">
                            {t("nodepool_info_banner")}
                        </p>
                    </div>
                </div>
            )}

            {!hasNamespaceBreakdown && !isNodePoolBreakdown && (
                <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-4 flex gap-3 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-bold mb-1">{t("namespace_breakdown_unavailable_title")}</p>
                        <p>
                            {t("namespace_breakdown_unavailable_desc")}
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t("total_cluster_cost")}</h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{formatter.format(data.totalClusterCost || 0)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t("compute_capacity")}</h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                        <Cpu className="w-6 h-6 text-brand-deep" /> {data.totalClusterCpuCores || 0} {t("cores_suffix")}
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                        {isNodePoolBreakdown ? t("active_nodepools") : (hasNamespaceBreakdown ? t("active_namespaces") : t("aggregated"))}
                    </h3>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{(data.chargebackData || []).length}</p>
                </div>
            </div>

            {(hasNamespaceBreakdown || isNodePoolBreakdown) && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 flex flex-col items-center">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white w-full border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">
                            {hasAnyCost ? t("chargeback_title") : "Distribución de Capacidad"}
                        </h3>
                        <div className="w-full h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                                        {pieData.map((_: any, index: number) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip formatter={(value: any) => (hasAnyCost ? formatter.format(value) : `${value} Cores`)} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white w-full border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">
                            {isNodePoolBreakdown ? t("nodepool_breakdown_title") : t("namespace_breakdown_title")}
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase">
                                            {isNodePoolBreakdown ? t("col_nodepool") : t("col_namespace")}
                                        </th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("col_cpu_cores")}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("col_compute_cost")}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("col_storage_cost")}</th>
                                        <th className="py-3 px-4 border-b border-gray-200 dark:border-slate-700 font-bold text-xs text-gray-500 uppercase text-right">{t("col_total_cost")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagedChargebackData.map((ns: any, idx: number) => (
                                        <tr key={ns.namespace} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="py-3 px-4 border-b border-gray-100 dark:border-slate-800 font-semibold text-sm text-gray-800 dark:text-gray-200">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                                                    {ns.namespace}
                                                    {ns.namespace === 'idle-capacity' && <span className="text-[10px] bg-amber-100 text-amber-800 px-1 rounded">{t("unallocated_tag")}</span>}
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

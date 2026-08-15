"use client";
import MockBanner from '@/components/MockBanner';
import React, { useState, useEffect, useMemo } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { 
    IconLayersLinked, 
    IconCpu, 
    IconServer, 
    IconAlertTriangle, 
    IconTrendingDown, 
    IconRotateClockwise, 
    IconCopy, 
    IconCheck, 
    IconX, 
    IconSparkles, 
    IconCloudComputing, 
    IconShieldCheck, 
    IconAdjustmentsHorizontal,
    IconSearch,
    IconCurrencyDollar
} from '@tabler/icons-react';
import { hasAccess } from '@/lib/tierLogic';
import { toast } from 'sonner';
import Pagination, { usePagination } from '@/components/Pagination';
import PinButton from '@/components/dashboard/PinButton';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { useTranslations } from 'next-intl';

const COLORS = ['#0054A6', '#00AEEF', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'];

type GranularityView = 'byNamespace' | 'byNodePool' | 'byWorkload' | 'byCostCenter';
type SharedPolicy = 'proportional' | 'even_split' | 'centralized';

export default function AksChargebackPage() {
    const t = useTranslations("AksChargeback");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const isEnterprise = hasAccess(selectedTenant.tier || 'Professional', 'Enterprise');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [data, setData] = useState<any>(null);
    const [selectedCluster, setSelectedCluster] = useState<string>('');
    const [granularity, setGranularity] = useState<GranularityView>('byNamespace');
    const [sharedPolicy, setSharedPolicy] = useState<SharedPolicy>('proportional');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'costDesc' | 'costAsc' | 'idleDesc' | 'nameAsc'>('costDesc');
    const [selectedAction, setSelectedAction] = useState<any>(null);
    const [copied, setCopied] = useState(false);

    const currencyFormatter = useMemo(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }), []);

    const fetchData = async (bust = false) => {
        if (!isEnterprise || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        if (bust) setRefreshing(true);
        else setLoading(true);

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
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [selectedTenant.id, isEnterprise, accounts.length, selectedCluster, instance]);

    // Calcular filas según granularidad y política de costos compartidos
    const activeRows = useMemo(() => {
        if (!data) return [];
        let items: any[] = [];

        if (granularity === 'byNamespace') {
            const nsList = data.views?.byNamespace || data.chargebackData || [];
            items = nsList.map((ns: any) => {
                let sharedCost = 0;
                if (sharedPolicy === 'proportional') sharedCost = ns.sharedProportional || 0;
                else if (sharedPolicy === 'even_split') sharedCost = ns.sharedEven || 0;

                const baseTotal = ns.baseTotalCost || ns.totalCost || 0;
                const effectiveTotal = ns.isSystem && sharedPolicy !== 'centralized' ? 0 : baseTotal + sharedCost;

                return {
                    id: ns.namespace,
                    name: ns.namespace,
                    subtext: ns.isSystem ? 'Sistema / Compartido' : `${ns.workloadCount || 1} workloads • ${ns.costCenter || 'General'}`,
                    cpuReq: ns.cpuRequested || ns.cpuCores || 0,
                    cpuUsed: ns.cpuUsed || Number(((ns.cpuRequested || ns.cpuCores || 2) * 0.4).toFixed(1)),
                    efficiencyPct: ns.efficiencyPct || 50,
                    computeCost: ns.computeCost || 0,
                    storageCost: ns.storageCost || 0,
                    idleCost: ns.idleCost || Number(((ns.computeCost || 0) * 0.35).toFixed(2)),
                    sharedCost,
                    totalCost: effectiveTotal,
                    isSystem: ns.isSystem,
                    recommendation: ns.recommendation
                };
            });
        } else if (granularity === 'byNodePool') {
            const pools = data.views?.byNodePool || [];
            items = pools.map((p: any) => ({
                id: p.poolName,
                name: p.poolName,
                subtext: `${p.vmSize} • ${p.nodeCount || 1} nodos ${p.isSpot ? '(Spot)' : ''}`,
                cpuReq: p.cpuCores || 0,
                cpuUsed: Number(((p.cpuCores || 2) * (p.efficiencyPct / 100)).toFixed(1)),
                efficiencyPct: p.efficiencyPct || 65,
                computeCost: p.computeCost || 0,
                storageCost: p.storageCost || 0,
                idleCost: p.idleCost || 0,
                sharedCost: 0,
                totalCost: p.totalCost || 0,
                isSystem: false,
                recommendation: p.recommendation
            }));
        } else if (granularity === 'byWorkload') {
            const wls = data.views?.byWorkload || [];
            items = wls.map((w: any) => ({
                id: `${w.namespace}/${w.workloadName}`,
                name: w.workloadName,
                subtext: `${w.kind} • ns: ${w.namespace} (${w.replicas || 1} réplicas)`,
                cpuReq: w.cpuRequested || 0,
                cpuUsed: w.cpuUsed || 0,
                efficiencyPct: w.efficiencyPct || 50,
                computeCost: w.computeCost || 0,
                storageCost: 0,
                idleCost: w.idleCost || 0,
                sharedCost: 0,
                totalCost: w.totalCost || 0,
                isSystem: false,
                recommendation: w.recommendation ? { title: w.recommendation, impactUsd: w.idleCost * 0.7, patchType: 'kubectl', target: `${w.namespace}/${w.workloadName}`, script: `kubectl -n ${w.namespace} scale ${w.kind.toLowerCase()}/${w.workloadName} --replicas=${Math.max(1, (w.replicas || 2) - 1)}` } : null
            }));
        } else if (granularity === 'byCostCenter') {
            const ccs = data.views?.byCostCenter || [];
            items = ccs.map((c: any) => ({
                id: c.costCenter,
                name: c.costCenter,
                subtext: `${(c.namespaces || []).join(', ')} • ${c.allocatedPct || 0}% del clúster`,
                cpuReq: 0,
                cpuUsed: 0,
                efficiencyPct: 75,
                computeCost: c.totalCost * 0.8,
                storageCost: c.totalCost * 0.2,
                idleCost: Number((c.totalCost * 0.25).toFixed(2)),
                sharedCost: 0,
                totalCost: c.totalCost,
                isSystem: false,
                recommendation: null
            }));
        }

        // Filtro de búsqueda
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            items = items.filter(i => i.name.toLowerCase().includes(q) || i.subtext.toLowerCase().includes(q));
        }

        // Ordenación
        return items.sort((a, b) => {
            if (sortBy === 'costDesc') return b.totalCost - a.totalCost;
            if (sortBy === 'costAsc') return a.totalCost - b.totalCost;
            if (sortBy === 'idleDesc') return b.idleCost - a.idleCost;
            if (sortBy === 'nameAsc') return a.name.localeCompare(b.name);
            return 0;
        });
    }, [data, granularity, sharedPolicy, searchQuery, sortBy]);

    const { page, setPage, pageSize, setPageSize, total, totalPages, paged: pagedRows } = usePagination(activeRows);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success(t("modal_copied"));
        setTimeout(() => setCopied(false), 2500);
    };

    if (selectedTenant.id === 'default') return null;

    if (!isEnterprise) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-xs">
                    <IconServer className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-[#1B2A41] dark:text-white mb-2 font-heading">{t("gate_title")}</h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                        {t("gate_desc", { plan: "Enterprise" })}
                    </p>
                    <button className="px-6 py-3 bg-[#0054A6] hover:bg-[#003d7a] text-white font-bold rounded-lg shadow-xs transition-colors cursor-pointer">
                        {t("gate_upgrade_btn")}
                    </button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[400px]">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-[#0054A6] rounded-full animate-spin mb-4"></div>
                    <p className="text-slate-500 font-semibold">{t("loading")}</p>
                </div>
            </div>
        );
    }

    if (!data) return <div className="p-6 text-center text-red-500">{t("load_error")}</div>;

    if (data.empty) {
        return (
            <div className="p-6">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-8 text-center max-w-2xl mx-auto shadow-xs">
                    <IconLayersLinked className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-[#1B2A41] dark:text-white mb-2 font-heading">{t("empty_title")}</h2>
                    <p className="text-slate-600 dark:text-slate-400">{t("empty_desc")}</p>
                </div>
            </div>
        );
    }

    const availableClusters = data.availableClusters || [];
    const hasAnyCost = activeRows.some(r => r.totalCost > 0);
    const pieData = activeRows
        .filter(r => (hasAnyCost ? r.totalCost > 0 : r.cpuReq > 0))
        .map(r => ({
            name: r.name,
            value: hasAnyCost ? r.totalCost : r.cpuReq
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);

    const hiddenCosts = data.hiddenCosts || {
        controlPlaneCost: 73.00,
        controlPlaneTier: 'Standard (Uptime SLA)',
        loadBalancersAndNetworkCost: 18.25,
        storageVolumesCost: 12.50,
        egressCost: 5.00
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
            <MockBanner />

            {/* Header */}
            <div className="flex items-start justify-between flex-wrap gap-4 border-b border-gray-200 dark:border-slate-800 pb-5">
                <div>
                    <h1 className="text-2xl lg:text-3xl font-extrabold text-[#1B2A41] dark:text-white flex items-center gap-3 font-heading">
                        <IconLayersLinked className="w-8 h-8 text-[#0054A6]" />
                        {t("page_title")}
                        <PinButton widgetKey="intelligence.aks-chargeback" />
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t("page_subtitle")}
                    </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {availableClusters.length > 1 && (
                        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg px-3 py-1.5 shadow-xs">
                            <span className="text-xs font-semibold text-slate-500">{t("cluster_label")}</span>
                            <select
                                value={selectedCluster}
                                onChange={(e) => setSelectedCluster(e.target.value)}
                                className="bg-transparent text-xs font-bold text-[#1B2A41] dark:text-white focus:outline-none cursor-pointer"
                            >
                                {availableClusters.map((c: any) => (
                                    <option key={c.name} value={c.name} className="dark:bg-slate-900">{c.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => fetchData(true)}
                        disabled={refreshing}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 text-[#1B2A41] dark:text-slate-200 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                    >
                        <IconRotateClockwise className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#0054A6]' : ''}`} />
                        <span>{t("refresh_btn")}</span>
                    </button>
                </div>
            </div>

            {/* Top KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Total Cost & Projection */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-gray-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
                            <span>{t("total_cluster_cost")}</span>
                            <IconCurrencyDollar className="w-4 h-4 text-[#0054A6]" />
                        </div>
                        <p className="text-2xl font-black text-[#1B2A41] dark:text-white">
                            {currencyFormatter.format(data.totalClusterCost || 0)}
                        </p>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        {t("kpi_projected")} <span className="font-semibold text-slate-700 dark:text-slate-300">{currencyFormatter.format(data.projectedMonthlyCost || data.totalClusterCost || 0)}</span>
                    </p>
                </div>

                {/* Efficiency (Health Index) */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-gray-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
                            <span>{t("kpi_efficiency")}</span>
                            <IconShieldCheck className="w-4 h-4 text-[#10B981]" />
                        </div>
                        <div className="flex items-baseline gap-2">
                            <p className="text-2xl font-black text-[#1B2A41] dark:text-white">
                                {data.healthEfficiencyPct || 65}%
                            </p>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                {data.healthEfficiencyPct > 70 ? 'Óptimo' : 'Mejorable'}
                            </span>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        {t("kpi_efficiency_sub")}
                    </p>
                </div>

                {/* Idle Waste */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-gray-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">
                            <span>{t("kpi_idle_waste")}</span>
                            <IconAlertTriangle className="w-4 h-4 text-amber-500" />
                        </div>
                        <p className="text-2xl font-black text-amber-600 dark:text-amber-400">
                            {currencyFormatter.format(data.totalIdleCost || 0)}
                        </p>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        {t("kpi_idle_waste_sub")}
                    </p>
                </div>

                {/* Potential Savings */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-gray-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
                            <span>{t("kpi_potential_savings")}</span>
                            <IconSparkles className="w-4 h-4 text-emerald-500" />
                        </div>
                        <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                            {currencyFormatter.format(data.potentialSavings || 0)}
                        </p>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        {t("kpi_potential_savings_sub")}
                    </p>
                </div>
            </div>

            {/* Controls Bar: Granularity View + Shared Cost Policy */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-gray-200 dark:border-slate-800 p-4 flex items-center justify-between flex-wrap gap-4">
                {/* Granularity Tabs */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-500 mr-1">{t("view_label")}</span>
                    {(['byNamespace', 'byNodePool', 'byWorkload', 'byCostCenter'] as GranularityView[]).map((v) => (
                        <button
                            key={v}
                            onClick={() => { setGranularity(v); setPage(1); }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                granularity === v
                                    ? 'bg-[#0054A6] text-white shadow-xs'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            {v === 'byNamespace' && t("view_namespace")}
                            {v === 'byNodePool' && t("view_nodepool")}
                            {v === 'byWorkload' && t("view_workload")}
                            {v === 'byCostCenter' && t("view_costcenter")}
                        </button>
                    ))}
                </div>

                {/* Shared Cost Policy Dropdown */}
                {granularity === 'byNamespace' && (
                    <div className="flex items-center gap-2">
                        <IconAdjustmentsHorizontal className="w-4 h-4 text-[#0054A6]" />
                        <span className="text-xs font-bold text-slate-500">{t("policy_shared_label")}</span>
                        <select
                            value={sharedPolicy}
                            onChange={(e) => setSharedPolicy(e.target.value as SharedPolicy)}
                            className="bg-slate-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs font-bold text-[#1B2A41] dark:text-white focus:outline-none cursor-pointer"
                        >
                            <option value="proportional">{t("policy_proportional")}</option>
                            <option value="even_split">{t("policy_even")}</option>
                            <option value="centralized">{t("policy_centralized")}</option>
                        </select>
                    </div>
                )}
            </div>

            {/* Visual Analytics Grid: Pie Chart + Hidden & Platform Costs Card */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Distribution Donut */}
                <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-gray-200 dark:border-slate-800 p-5 flex flex-col items-center">
                    <h3 className="text-sm font-bold text-[#1B2A41] dark:text-white w-full border-b border-gray-100 dark:border-slate-800 pb-3 mb-2 font-heading">
                        {hasAnyCost ? `${t("chart_title_cost")} ${granularity.replace('by', '')}` : t("chart_title_capacity")}
                    </h3>
                    <div className="w-full h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                                    {pieData.map((_: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <RechartsTooltip formatter={(value: any) => (hasAnyCost ? currencyFormatter.format(value) : `${value} Cores`)} />
                                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Right: Hidden & Platform Costs Breakdown */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-gray-200 dark:border-slate-800 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-3 mb-4">
                            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-white font-heading">
                                {t("hidden_costs_title")}
                            </h3>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-[#0054A6] dark:bg-blue-900/30 dark:text-blue-300">
                                Total: {currencyFormatter.format(hiddenCosts.controlPlaneCost + hiddenCosts.loadBalancersAndNetworkCost + hiddenCosts.storageVolumesCost + hiddenCosts.egressCost)}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{t("hidden_control_plane")}</span>
                                    <span className="text-xs font-extrabold text-[#1B2A41] dark:text-white">{currencyFormatter.format(hiddenCosts.controlPlaneCost)}</span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">{hiddenCosts.controlPlaneTier || 'Standard SLA 99.95%'}</p>
                            </div>

                            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{t("hidden_lb_network")}</span>
                                    <span className="text-xs font-extrabold text-[#1B2A41] dark:text-white">{currencyFormatter.format(hiddenCosts.loadBalancersAndNetworkCost)}</span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Servicios Type: LoadBalancer + Public IP</p>
                            </div>

                            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{t("hidden_storage_volumes")}</span>
                                    <span className="text-xs font-extrabold text-[#1B2A41] dark:text-white">{currencyFormatter.format(hiddenCosts.storageVolumesCost)}</span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Azure Managed Disks (OS + PVCs)</p>
                            </div>

                            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{t("hidden_egress")}</span>
                                    <span className="text-xs font-extrabold text-[#1B2A41] dark:text-white">{currencyFormatter.format(hiddenCosts.egressCost)}</span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Tráfico inter-zona de disponibilidad</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Interactive FinOps Table */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-gray-200 dark:border-slate-800 overflow-hidden">
                {/* Search & Sort Header */}
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-3">
                    <div className="relative flex-1 min-w-[240px] max-w-md">
                        <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder={t("table_search_placeholder")}
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-[#0054A6]"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Ordenar por:</span>
                        <select
                            value={sortBy}
                            onChange={(e: any) => setSortBy(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#1B2A41] dark:text-white focus:outline-none cursor-pointer"
                        >
                            <option value="costDesc">Costo: Mayor a Menor</option>
                            <option value="costAsc">Costo: Menor a Mayor</option>
                            <option value="idleDesc">Desperdicio (Idle): Mayor</option>
                            <option value="nameAsc">Nombre: A - Z</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider border-b border-gray-200 dark:border-slate-800">
                            <tr>
                                <th className="py-3.5 px-4">{t("col_name")}</th>
                                <th className="py-3.5 px-4">{t("col_cpu_req_usage")}</th>
                                <th className="py-3.5 px-4">{t("col_efficiency")}</th>
                                <th className="py-3.5 px-4 text-right">{t("col_compute_cost")}</th>
                                <th className="py-3.5 px-4 text-right">{t("col_storage_cost")}</th>
                                <th className="py-3.5 px-4 text-right text-amber-600 dark:text-amber-400">{t("col_idle_waste")}</th>
                                {granularity === 'byNamespace' && sharedPolicy !== 'centralized' && (
                                    <th className="py-3.5 px-4 text-right text-blue-600 dark:text-blue-400">{t("col_shared_cost")}</th>
                                )}
                                <th className="py-3.5 px-4 text-right font-black">{t("col_total_cost")}</th>
                                <th className="py-3.5 px-4 text-center">{t("col_action")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {pagedRows.map((row: any) => (
                                <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                    <td className="py-3.5 px-4">
                                        <div className="font-bold text-[#1B2A41] dark:text-white">{row.name}</div>
                                        <div className="text-[11px] text-slate-400">{row.subtext}</div>
                                    </td>

                                    <td className="py-3.5 px-4">
                                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                                            {row.cpuReq > 0 ? `${row.cpuReq} / ${row.cpuUsed} Cores` : 'N/A'}
                                        </div>
                                    </td>

                                    <td className="py-3.5 px-4 min-w-[120px]">
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full ${row.efficiencyPct >= 70 ? 'bg-emerald-500' : row.efficiencyPct >= 45 ? 'bg-amber-500' : 'bg-red-500'}`}
                                                    style={{ width: `${Math.min(100, row.efficiencyPct)}%` }}
                                                />
                                            </div>
                                            <span className="font-bold text-[11px] text-slate-600 dark:text-slate-300">{row.efficiencyPct}%</span>
                                        </div>
                                    </td>

                                    <td className="py-3.5 px-4 text-right font-semibold text-slate-700 dark:text-slate-300">
                                        {currencyFormatter.format(row.computeCost)}
                                    </td>

                                    <td className="py-3.5 px-4 text-right text-slate-500 dark:text-slate-400">
                                        {currencyFormatter.format(row.storageCost)}
                                    </td>

                                    <td className="py-3.5 px-4 text-right font-semibold text-amber-600 dark:text-amber-400">
                                        {currencyFormatter.format(row.idleCost)}
                                    </td>

                                    {granularity === 'byNamespace' && sharedPolicy !== 'centralized' && (
                                        <td className="py-3.5 px-4 text-right font-semibold text-blue-600 dark:text-blue-400">
                                            +{currencyFormatter.format(row.sharedCost)}
                                        </td>
                                    )}

                                    <td className="py-3.5 px-4 text-right font-extrabold text-[#1B2A41] dark:text-white">
                                        {currencyFormatter.format(row.totalCost)}
                                    </td>

                                    <td className="py-3.5 px-4 text-center">
                                        {row.recommendation ? (
                                            <button
                                                onClick={() => setSelectedAction({ ...row.recommendation, resourceName: row.name })}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 text-[11px] font-bold transition-colors cursor-pointer"
                                            >
                                                <IconSparkles className="w-3 h-3" />
                                                <span>{t("action_optimize")}</span>
                                            </button>
                                        ) : (
                                            <span className="text-[11px] text-slate-400 font-medium">{t("action_none")}</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="p-4 border-t border-gray-100 dark:border-slate-800">
                    <Pagination
                        page={page}
                        setPage={setPage}
                        pageSize={pageSize}
                        setPageSize={setPageSize}
                        total={total}
                        totalPages={totalPages}
                        pageSizes={[15, 30, 45, 60]}
                    />
                </div>
            </div>

            {/* Actionable Insights Bottom Grid */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <IconSparkles className="w-5 h-5 text-[#0054A6]" />
                    <h2 className="text-lg font-bold text-[#1B2A41] dark:text-white font-heading">{t("insights_title")}</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-gray-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="p-2 rounded-lg bg-blue-50 text-[#0054A6] dark:bg-blue-900/30">
                                    <IconCpu className="w-4 h-4" />
                                </span>
                                <h3 className="font-bold text-xs text-[#1B2A41] dark:text-white">{t("insight_rightsizing_title")}</h3>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                {t("insight_rightsizing_desc")}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-gray-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
                                    <IconCloudComputing className="w-4 h-4" />
                                </span>
                                <h3 className="font-bold text-xs text-[#1B2A41] dark:text-white">{t("insight_spot_title")}</h3>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                {t("insight_spot_desc")}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-gray-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="p-2 rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/30">
                                    <IconTrendingDown className="w-4 h-4" />
                                </span>
                                <h3 className="font-bold text-xs text-[#1B2A41] dark:text-white">{t("insight_scale_title")}</h3>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                {t("insight_scale_desc")}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* 1-Click Action Modal */}
            {selectedAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-gray-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="p-5 bg-slate-50 dark:bg-slate-800/70 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
                                    <IconSparkles className="w-5 h-5" />
                                </span>
                                <div>
                                    <h3 className="font-bold text-sm text-[#1B2A41] dark:text-white font-heading">{t("modal_title")}</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{selectedAction.title}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedAction(null)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <IconX className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 space-y-4">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40">
                                <div>
                                    <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">{t("modal_target_label")}</span>
                                    <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200">{selectedAction.target || selectedAction.resourceName}</p>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">{t("modal_savings_badge")}</span>
                                    <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">+{currencyFormatter.format(selectedAction.impactUsd || 0)} / mes</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                                    {t("modal_cmd_label")}
                                </label>
                                <div className="relative">
                                    <pre className="p-4 rounded-xl bg-slate-900 text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800 leading-relaxed whitespace-pre-wrap">
                                        {selectedAction.script}
                                    </pre>
                                    <button
                                        onClick={() => handleCopy(selectedAction.script)}
                                        className="absolute right-3 top-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 border border-slate-700 shadow-xs cursor-pointer transition-colors"
                                    >
                                        {copied ? <IconCheck className="w-3.5 h-3.5 text-emerald-400" /> : <IconCopy className="w-3.5 h-3.5" />}
                                        <span>{copied ? t("modal_copied") : t("modal_copy_btn")}</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 flex justify-end">
                            <button
                                onClick={() => setSelectedAction(null)}
                                className="px-5 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors cursor-pointer"
                            >
                                {t("modal_close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

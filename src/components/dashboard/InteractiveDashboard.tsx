"use client";
import React, { useState } from 'react';
import { 
    PieChart, MapPin, DollarSign, TrendingDown, CheckSquare, 
    Calendar, Skull, Tag, BarChart3, Zap, Moon
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart as RechartsPieChart, Pie, Cell, Legend } from 'recharts';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { FocusCostEntry } from '@/modules/core/focusMapper';
import FocusCostPieChart from './FocusCostPieChart';
import FeatureGuard from '@/components/FeatureGuard';
import { useCurrency } from '@/components/CurrencyProvider';

interface InteractiveDashboardProps {
    loading: boolean;
    billingData: FocusCostEntry[] | null;
    advisorData?: any;
    zombieData?: any;
    tagsData?: any;
    appliedSavingsData?: any;
}

export default function InteractiveDashboard({
    loading,
    billingData,
    advisorData,
    zombieData,
    tagsData,
    appliedSavingsData
}: InteractiveDashboardProps) {
    const t = useTranslations('Billing');
    const locale = useLocale();
    const router = useRouter();
    const { format } = useCurrency();
    
    // Process backend JSON shapes
    // advisorData.recommendations is grouped: { Cost: [...], Security: [...], ... }
    let computedTotalSavings = 0;
    if (advisorData?.recommendations) {
        const costRecs = advisorData.recommendations.Cost || [];
        computedTotalSavings = costRecs.reduce((acc: number, curr: any) => 
            acc + parseFloat(curr.extendedProperties?.savingsAmount || '0'), 0);
    }

    // Ahorro ya materializado: suma de estimados por tipo de recurso para las
    // eliminaciones exitosas (ActionLogs.action_type='DELETE_RESOURCE') de los
    // últimos 30 días. Ver /api/intelligence/applied-savings.
    const computedAppliedSavings = appliedSavingsData?.appliedSavings ?? 0;

    const computedUntagged = tagsData?.data?.allResources ? tagsData.data.allResources.filter((r: any) => !r.isCompliant).length : undefined;
    let computedZombies: number | string = '--';
    let leakageMap: any = {};

    const fallbackSavings: Record<string, number> = {
        unattachedDisks: 15.0,
        unusedIps: 3.5,
        staleSnapshots: 5.0,
        emptyAppServicePlans: 45.0,
        elasticPools: 250.0,
        loadBalancers: 18.0,
        frontDoorWaf: 5.0,
        trafficManager: 3.0,
        appGateways: 180.0,
        natGateways: 32.0,
        privateEndpoints: 7.0,
        vnetGateways: 130.0,
        ddos: 2944.0,
        orphanedNics: 0,
        orphanedNsgs: 0,
        availabilitySets: 0,
        routeTables: 0,
        emptyVnets: 0,
        emptySubnets: 0,
        ipGroups: 0,
        privateDnsZones: 0.25,
        emptyRgs: 0,
        apiConnections: 0,
        expiredCerts: 0,
        emptySqlServers: 0,
        stoppedFlexibleServers: 25.0,
        emptyCosmosDbAccounts: 24.0,
        emptyEventHubNamespaces: 11.0,
        emptyServiceBusNamespaces: 10.0,
        emptyApiManagement: 50.0,
        unprovisionedExpressRoute: 55.0,
        unattachedWafPolicies: 5.0,
        stoppedVirtualMachines: 30.0,
        emptyAse: 300.0,
        expiredTtlResources: 10.0
    };

    const friendlyNames: Record<string, string> = {
        unattachedDisks: "Disk",
        unusedIps: "Public IP",
        staleSnapshots: "Snapshot",
        emptyAppServicePlans: "App Service Plan",
        elasticPools: "SQL Elastic Pool",
        loadBalancers: "Load Balancer",
        frontDoorWaf: "Front Door WAF",
        trafficManager: "Traffic Manager",
        appGateways: "App Gateway",
        natGateways: "NAT Gateway",
        privateEndpoints: "Private Endpoint",
        vnetGateways: "VNet Gateway",
        ddos: "DDoS Plan",
        privateDnsZones: "Private DNS",
        stoppedFlexibleServers: "Flexible Server",
        emptyCosmosDbAccounts: "Cosmos DB",
        emptyEventHubNamespaces: "Event Hub",
        emptyServiceBusNamespaces: "Service Bus",
        emptyApiManagement: "API Management",
        unprovisionedExpressRoute: "ExpressRoute",
        unattachedWafPolicies: "WAF Policy",
        stoppedVirtualMachines: "VM (Stopped)",
        emptyAse: "App Service Env",
        expiredTtlResources: "TTL Expired"
    };

    const getFriendlyName = (keyOrType: string): string => {
        if (!keyOrType) return 'Other';
        if (friendlyNames[keyOrType]) {
            return friendlyNames[keyOrType];
        }
        const lowerKey = keyOrType.toLowerCase();
        const matchedKey = Object.keys(friendlyNames).find(k => k.toLowerCase() === lowerKey);
        if (matchedKey) {
            return friendlyNames[matchedKey];
        }

        const lastPart = keyOrType.includes('/') ? keyOrType.split('/').pop() : keyOrType;
        const normalized = lastPart ? lastPart.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

        const azureTypeMappings: Record<string, string> = {
            disks: "Disk",
            publicipaddresses: "Public IP",
            snapshots: "Snapshot",
            serverfarms: "App Service Plan",
            elasticpools: "SQL Elastic Pool",
            loadbalancers: "Load Balancer",
            frontdoorwebapplicationfirewallpolicies: "Front Door WAF",
            trafficmanagerprofiles: "Traffic Manager",
            applicationgateways: "App Gateway",
            natgateways: "NAT Gateway",
            privateendpoints: "Private Endpoint",
            virtualnetworkgateways: "VNet Gateway",
            ddosprotectionplans: "DDoS Plan",
            privatednszones: "Private DNS",
            flexibleservers: "Flexible Server",
            databaseaccounts: "Cosmos DB",
            apimanagementservices: "API Management",
            expressroutecircuits: "ExpressRoute",
            webapplicationfirewallpolicies: "WAF Policy",
            virtualmachines: "VM (Stopped)",
            hostingenvironments: "App Service Env"
        };

        if (azureTypeMappings[normalized]) {
            return azureTypeMappings[normalized];
        }

        return keyOrType.charAt(0).toUpperCase() + keyOrType.slice(1);
    };

    if (zombieData?.auditResults) {
        computedZombies = Object.values(zombieData.auditResults).reduce((acc: number, arr: any) => acc + (Array.isArray(arr) ? arr.length : 0), 0) as number;
        
        Object.keys(zombieData.auditResults).forEach(key => {
            const items = zombieData.auditResults[key] || [];
            if (Array.isArray(items)) {
                items.forEach((curr: any) => {
                    const defaultCost = fallbackSavings[key] || 0;
                    const cost = curr.estimatedMonthlyCost || (curr.diskSizeGB ? curr.diskSizeGB * 0.15 : (curr.sizeGB ? curr.sizeGB * 0.05 : defaultCost)) || 0;
                    if (cost > 0) {
                        const friendlyName = getFriendlyName(key);
                        leakageMap[friendlyName] = (leakageMap[friendlyName] || 0) + cost;
                    }
                });
            }
        });
    } else {
        computedZombies = zombieData?.count !== undefined ? zombieData.count : '--';
        const leakageItems = Array.isArray(zombieData) ? zombieData : (zombieData?.data || zombieData?.items || []);
        leakageMap = leakageItems.reduce((acc: any, curr: any) => {
            const type = curr.resourceType || curr.type || 'Unknown';
            const cost = curr.monthlyCost || curr.estimatedMonthlyCost || curr.cost || 0;
            const friendlyName = getFriendlyName(type);
            if (cost > 0) {
                acc[friendlyName] = (acc[friendlyName] || 0) + cost;
            }
            return acc;
        }, {});
    }

    const totalZombiesSavings = Object.values(leakageMap).reduce((sum: any, val: any) => sum + val, 0) as number;
    const totalPotentialSavings = computedTotalSavings + totalZombiesSavings;

    if (loading || billingData === null) {
        return (
            <div className="max-w-[1400px] mx-auto p-6 rounded-2xl bg-slate-50 dark:bg-slate-900/40 animate-pulse">
                <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded w-1/4 mb-6"></div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                    {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>)}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <div className="h-72 bg-slate-200 dark:bg-slate-800 rounded-xl lg:col-span-2"></div>
                    <div className="h-72 bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
                </div>
            </div>
        );
    }

    if (billingData.length === 0) {
        return (
            <div className="max-w-[1400px] mx-auto p-12 rounded-2xl bg-slate-50 dark:bg-slate-900/40 flex flex-col items-center justify-center border border-dashed border-slate-300 dark:border-slate-700">
                <div className="text-slate-400 dark:text-slate-500 mb-2">
                    <svg className="w-12 h-12 mx-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                </div>
                <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">Sin datos de facturación</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">No se encontraron registros de costos para la suscripción o periodo seleccionado.</p>
            </div>
        );
    }

    // Aggregate FOCUS data
    const entries = billingData || [];
    const totalCost = entries.reduce((sum, e) => sum + e.EffectiveCost, 0);

    const dailyMap: Record<string, number> = {};
    entries.forEach(e => {
        if (e.UsageDate) {
            const d = e.UsageDate;
            const fmt = d.length === 8 ? `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}` : d;
            if (!dailyMap[fmt]) dailyMap[fmt] = 0;
            dailyMap[fmt] += e.EffectiveCost;
        }
    });

    const evolutionData = Object.keys(dailyMap).sort().map(date => ({
        date,
        cost: Number(dailyMap[date].toFixed(2))
    }));

    // Proyección anual: usamos el SPAN inclusivo de fechas (primera→última), NO la
    // cantidad de días con datos. Si hay días sin cargos dentro del rango, igual
    // transcurrieron, así que deben contar en el promedio diario. Dividir por
    // `evolutionData.length` (solo días con datos) inflaba el promedio y producía
    // una proyección anual exageradamente alta cuando el consumo era esporádico.
    const sortedDays = Object.keys(dailyMap).sort();
    let daysCovered = sortedDays.length;
    if (sortedDays.length >= 2) {
        const first = new Date(sortedDays[0]).getTime();
        const last = new Date(sortedDays[sortedDays.length - 1]).getTime();
        const spanDays = Math.round((last - first) / 86_400_000) + 1;
        if (Number.isFinite(spanDays) && spanDays > daysCovered) daysCovered = spanDays;
    }
    const annualProjection = daysCovered > 0 ? (totalCost / daysCovered) * 365 : 0;

    const formatYAxis = (tickItem: any) => format(tickItem, { compact: true });

    const CustomDot = (props: any) => {
        const { cx, cy, index } = props;
        if (index === evolutionData.length - 1) {
            return <circle cx={cx} cy={cy} r={6} stroke="#00aeef" strokeWidth={3} fill="var(--surface)" />;
        }
        return null;
    };

    const COLORS = ['#0054A6', '#F2A900', '#10B981', '#EF4444', '#8B5CF6', '#F43F5E', '#0EA5E9', '#F59E0B'];
    const leakagePieData = Object.keys(leakageMap)
        .map(k => ({ name: k, value: Number(leakageMap[k].toFixed(2)) }))
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value);
    return (
        <div className="max-w-[1400px] mx-auto animate-in fade-in duration-500 bg-slate-50 dark:bg-slate-900/40 p-6 rounded-2xl">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <div className="flex gap-4">
                    <div className="bg-white dark:bg-slate-900 px-5 py-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3">
                        <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-lg"><MapPin className="w-5 h-5 text-slate-600 dark:text-slate-300" /></div>
                        <div>
                            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('synced_tenant')}</div>
                            <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{t('mins_ago')}</div>
                        </div>
                    </div>
                </div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-sm">
                    <MapPin className="w-3 h-3 mr-1 text-red-500 fill-red-500" />
                    {t('full_tenant')}
                </div>
            </div>

            {/* Top Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                        <DollarSign className="w-3.5 h-3.5 mr-1 text-slate-400 dark:text-slate-500" />
                        {t('mtd_spend')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 truncate" title={format(totalCost)}>{format(totalCost)}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border-gray-100 dark:border-slate-800 p-4 border-[2px] border-amber-200 dark:border-amber-800/60 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-amber-200 to-amber-500 rounded-bl-full opacity-20 group-hover:opacity-30 transition-opacity"></div>
                    <div className="flex items-center text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 relative z-10">
                        <TrendingDown className="w-3.5 h-3.5 mr-1 text-amber-500" />
                        {t('potentialSavingsTitle', { fallback: 'Ahorro potencial' })}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 relative z-10 truncate" title={format(totalPotentialSavings)}>
                        {format(totalPotentialSavings)}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 mb-3 relative z-10">
                        {t('potentialSavingsDesc', { fallback: 'Fugas y redimensionamiento' })}
                    </div>
                    <div className="relative z-10">
                        <FeatureGuard featureName="Optimization Details" requiredTier="Professional" className="mb-0">
                            <button onClick={() => router.push(`/${locale}/advisor`)} className="w-full bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-[11px] font-bold py-1.5 rounded-lg shadow-sm transition-colors">
                                {t('viewDetails', { fallback: 'Ver Detalles' })}
                            </button>
                        </FeatureGuard>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                        <CheckSquare className="w-3.5 h-3.5 mr-1 text-emerald-500 fill-emerald-500/20" />
                        {t('applied_savings')}
                    </div>
                    <div className="text-2xl font-extrabold text-emerald-500 truncate" title={format(computedAppliedSavings)}>
                        {format(computedAppliedSavings)}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">{t('captured_percent')}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                        <Calendar className="w-3.5 h-3.5 mr-1 text-rose-400" />
                        {t('annual_projection')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 truncate" title={format(annualProjection)}>
                        {format(annualProjection)}
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                        <Skull className="w-3.5 h-3.5 mr-1 text-slate-500" />
                        {t('zombie_resources')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 truncate">
                        {computedZombies}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">{t('inactive_resources')}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                        <Tag className="w-3.5 h-3.5 mr-1 text-amber-500 fill-amber-500/20" />
                        {t('tag_compliance')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 truncate">
                        {computedUntagged !== undefined ? computedUntagged : '--'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">{t('untagged_resources')}</div>
                </div>
                {/* 4. Carbon Footprint Card */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                        <Zap className="w-3.5 h-3.5 mr-1 text-green-500" />
                        {t('environmental_impact')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 truncate">
                        {(totalCost * 0.35).toLocaleString(undefined, {maximumFractionDigits:1})}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">{t('estimated_co2e')}</div>
                </div>
            </div>

            {/* Middle Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-6">
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 md:col-span-2 lg:col-span-2 xl:col-span-2 overflow-hidden">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center text-sm font-bold text-slate-700 dark:text-slate-200">
                            <BarChart3 className="w-4 h-4 mr-2 text-rose-800 dark:text-rose-400" />
                            {t('monthly_spend_evolution')}
                        </div>
                    </div>
                    <div className="h-64 w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={evolutionData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorGasto" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#00aeef" stopOpacity={0.15}/>
                                        <stop offset="95%" stopColor="#00aeef" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid vertical={false} stroke="var(--line)" />
                                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={10} />
                                <YAxis tickFormatter={formatYAxis} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                                <RechartsTooltip
                                    contentStyle={{ borderRadius: '8px', border: '1px solid var(--line)', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', background: 'var(--surface)', color: 'inherit' }}
                                formatter={(value: any) => [format(value), t('spend_label')]}
                                />
                                <Area type="monotone" dataKey="cost" stroke="#00aeef" strokeWidth={4} fillOpacity={1} fill="url(#colorGasto)" activeDot={{ r: 8, strokeWidth: 0 }} dot={<CustomDot />} />
                            </AreaChart>
                        </ResponsiveContainer>
                        <div className="absolute bottom-[35px] left-[55px] right-[25px] border-t-2 border-dashed border-slate-300 dark:border-slate-700"></div>
                        <div className="absolute bottom-[40px] right-[25px] text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 px-1">{t('potential_label')} $38.5k</div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 md:col-span-1 lg:col-span-1 xl:col-span-1 overflow-hidden">
                    <div className="flex items-center text-sm font-bold text-slate-700 dark:text-slate-200 mb-6">
                        <PieChart className="w-4 h-4 mr-2 text-rose-800 dark:text-rose-400 fill-rose-800 dark:fill-rose-400" />
                        {t('spend_by_subscription')}
                    </div>
                    <div className="h-64 w-full relative flex items-center justify-center">
                        <FocusCostPieChart data={entries} />
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 md:col-span-1 lg:col-span-3 xl:col-span-1 overflow-hidden">
                    <div className="flex items-center text-sm font-bold text-slate-700 dark:text-slate-200 mb-6">
                        <Skull className="w-4 h-4 mr-2 text-amber-500" />
                        Distribución de fugas financieras
                    </div>
                    <div className="h-64 w-full relative flex items-center justify-center">
                        {leakagePieData.length > 0 ? (
                            <div className="flex flex-col h-full w-full">
                                <div className="h-40 w-full shrink-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RechartsPieChart>
                                            <Pie data={leakagePieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={5} dataKey="value">
                                                {leakagePieData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                            </Pie>
                                            <RechartsTooltip formatter={(v: any) => format(Number(v))} wrapperStyle={{ zIndex: 9999 }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'inherit' }} />
                                        </RechartsPieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="flex-1 overflow-y-auto mt-2 px-2 custom-scrollbar">
                                    <div className="flex flex-col gap-1.5">
                                        {leakagePieData.map((item, i) => (
                                            <div key={i} className="flex justify-between items-center text-[11px] bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                                                    <span className="text-slate-600 dark:text-slate-300 font-bold truncate max-w-[120px]">{item.name}</span>
                                                </div>
                                                <span className="font-extrabold text-slate-800 dark:text-slate-100">{format(item.value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm text-slate-400 dark:text-slate-500">Sin datos de fugas</div>
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
}

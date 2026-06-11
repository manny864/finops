"use client";
import React, { useState } from 'react';
import { 
    PieChart, MapPin, DollarSign, TrendingDown, CheckSquare, 
    Calendar, Skull, Tag, BarChart3, Zap, Moon
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { useTranslations } from 'next-intl';

import { FocusCostEntry } from '@/modules/core/focusMapper';
import FocusCostPieChart from './FocusCostPieChart';

interface InteractiveDashboardProps {
    loading: boolean;
    billingData: FocusCostEntry[] | null;
    advisorData?: any;
    zombieData?: any;
    tagsData?: any;
}

export default function InteractiveDashboard({
    loading,
    billingData,
    advisorData,
    zombieData,
    tagsData
}: InteractiveDashboardProps) {
    const t = useTranslations('Billing');
    
    // Process backend JSON shapes
    // advisorData.recommendations is grouped: { Cost: [...], Security: [...], ... }
    let computedTotalSavings = 0;
    if (advisorData?.recommendations) {
        const costRecs = advisorData.recommendations.Cost || [];
        computedTotalSavings = costRecs.reduce((acc: number, curr: any) => 
            acc + parseFloat(curr.extendedProperties?.savingsAmount || '0'), 0);
    }

    const computedAppliedSavings = 0; // Placeholder

    const computedUntagged = tagsData?.nonCompliant ? tagsData.nonCompliant.length : undefined;
    let computedZombies: number | string = '--';
    let leakageMap: any = {};

    if (zombieData?.auditResults) {
        computedZombies = Object.values(zombieData.auditResults).reduce((acc: number, arr: any) => acc + (Array.isArray(arr) ? arr.length : 0), 0) as number;
        
        Object.keys(zombieData.auditResults).forEach(key => {
            const items = zombieData.auditResults[key] || [];
            if (Array.isArray(items)) {
                items.forEach((curr: any) => {
                    const type = curr.type ? curr.type.split("/").pop() : key;
                    const cost = curr.estimatedMonthlyCost || (curr.diskSizeGB ? curr.diskSizeGB * 0.15 : 0) || 0;
                    leakageMap[type] = (leakageMap[type] || 0) + cost;
                });
            }
        });
    } else {
        computedZombies = zombieData?.count !== undefined ? zombieData.count : '--';
        const leakageItems = Array.isArray(zombieData) ? zombieData : (zombieData?.data || zombieData?.items || []);
        leakageMap = leakageItems.reduce((acc: any, curr: any) => {
            const type = curr.resourceType || curr.type || 'Unknown';
            const cost = curr.monthlyCost || curr.estimatedMonthlyCost || curr.cost || 0;
            acc[type] = (acc[type] || 0) + cost;
            return acc;
        }, {});
    }

    if (loading || billingData === null) {
        return (
            <div className="max-w-[1400px] mx-auto p-6 rounded-2xl bg-slate-50 animate-pulse">
                <div className="h-10 bg-slate-200 rounded w-1/4 mb-6"></div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                    {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 bg-slate-200 rounded-xl"></div>)}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <div className="h-72 bg-slate-200 rounded-xl lg:col-span-2"></div>
                    <div className="h-72 bg-slate-200 rounded-xl"></div>
                </div>
            </div>
        );
    }

    if (billingData.length === 0) {
        return (
            <div className="max-w-[1400px] mx-auto p-12 rounded-2xl bg-slate-50 flex flex-col items-center justify-center border border-dashed border-slate-300">
                <div className="text-slate-400 mb-2">
                    <svg className="w-12 h-12 mx-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                </div>
                <h3 className="text-lg font-bold text-slate-700">Sin datos de facturación</h3>
                <p className="text-sm text-slate-500 mt-1">No se encontraron registros de costos para la suscripción o periodo seleccionado.</p>
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

    const formatYAxis = (tickItem: any) => tickItem >= 1000 ? `$${(tickItem / 1000).toFixed(1)}k` : `$${tickItem}`;

    const CustomDot = (props: any) => {
        const { cx, cy, index } = props;
        if (index === evolutionData.length - 1) {
            return <circle cx={cx} cy={cy} r={6} stroke="#0ea5e9" strokeWidth={3} fill="#ffffff" />;
        }
        return null;
    };

    const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];
    const leakagePieData = Object.keys(leakageMap).map(k => ({ name: k, value: leakageMap[k] }));
    return (
        <div className="max-w-[1400px] mx-auto animate-in fade-in duration-500 bg-slate-50 p-6 rounded-2xl">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <div className="flex gap-4">
                    <div className="bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                        <div className="bg-slate-100 p-2 rounded-lg"><MapPin className="w-5 h-5 text-slate-600" /></div>
                        <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('synced_tenant')}</div>
                            <div className="text-sm font-bold text-slate-800">{t('mins_ago')}</div>
                        </div>
                    </div>
                </div>
                </div>
                <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-sm">
                    <MapPin className="w-3 h-3 mr-1 text-red-500 fill-red-500" />
                    {t('full_tenant')}
                </div>
            </div>

            {/* Top Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <DollarSign className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        {t('mtd_spend')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">${totalCost.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <TrendingDown className="w-3.5 h-3.5 mr-1 text-red-500" />
                        Ahorro potencial
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">
                        ${computedTotalSavings.toLocaleString(undefined, {maximumFractionDigits:0})}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-1">{t('pending_apply')}</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <CheckSquare className="w-3.5 h-3.5 mr-1 text-emerald-500 fill-emerald-500/20" />
                        Ahorro aplicado
                    </div>
                    <div className="text-2xl font-extrabold text-emerald-500">
                        ${computedAppliedSavings.toLocaleString(undefined, {maximumFractionDigits:0})}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-1">{t('captured_percent')}</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <Calendar className="w-3.5 h-3.5 mr-1 text-rose-400" />
                        {t('annual_projection')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">
                        ${((totalCost / Math.max(1, new Date().getDate())) * 365).toLocaleString(undefined, {maximumFractionDigits:0})}
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <Skull className="w-3.5 h-3.5 mr-1 text-slate-500" />
                        {t('zombie_resources')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">
                        {computedZombies}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-1">{t('inactive_resources')}</div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <Tag className="w-3.5 h-3.5 mr-1 text-amber-500 fill-amber-500/20" />
                        {t('tag_compliance')}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">
                        {computedUntagged !== undefined ? computedUntagged : '--'}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-1">{t('untagged_resources')}</div>
                </div>
                {/* 4. Carbon Footprint Card */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        <Zap className="w-3.5 h-3.5 mr-1 text-green-500" />
                        Impacto ambiental
                    </div>
                    <div className="text-2xl font-extrabold text-slate-800">
                        {(totalCost * 0.35).toLocaleString(undefined, {maximumFractionDigits:1})}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-1">kg CO2e estimado</div>
                </div>
            </div>

            {/* Middle Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 lg:col-span-2 overflow-hidden">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center text-sm font-bold text-slate-700">
                            <BarChart3 className="w-4 h-4 mr-2 text-rose-800" />
                            {t('monthly_spend_evolution')}
                        </div>
                    </div>
                    <div className="h-64 w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={evolutionData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorGasto" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.15}/>
                                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={10} />
                                <YAxis tickFormatter={formatYAxis} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                                <RechartsTooltip 
                                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    formatter={(value: any) => [`$${value}`, t('spend_label')]}
                                />
                                <Area type="monotone" dataKey="cost" stroke="#0ea5e9" strokeWidth={4} fillOpacity={1} fill="url(#colorGasto)" activeDot={{ r: 8, strokeWidth: 0 }} dot={<CustomDot />} />
                            </AreaChart>
                        </ResponsiveContainer>
                        <div className="absolute bottom-[35px] left-[55px] right-[25px] border-t-2 border-dashed border-slate-300"></div>
                        <div className="absolute bottom-[40px] right-[25px] text-[10px] font-bold text-slate-400 bg-white px-1">{t('potential_label')} $38.5k</div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 overflow-hidden">
                    <div className="flex items-center text-sm font-bold text-slate-700 mb-6">
                        <PieChart className="w-4 h-4 mr-2 text-rose-800 fill-rose-800" />
                        {t('spend_by_subscription')}
                    </div>
                    <div className="h-64 w-full relative flex items-center justify-center">
                        <div className="w-full h-full absolute inset-0">
                            <FocusCostPieChart data={entries} />
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 overflow-hidden">
                    <div className="flex items-center text-sm font-bold text-slate-700 mb-6">
                        <Skull className="w-4 h-4 mr-2 text-amber-500" />
                        Distribución de fugas financieras
                    </div>
                    <div className="h-64 w-full relative flex items-center justify-center">
                        {leakagePieData.length > 0 ? (
                            <div className="w-full h-full absolute inset-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RechartsPieChart>
                                        <Pie data={leakagePieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                            {leakagePieData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                        </Pie>
                                        <RechartsTooltip formatter={(v: any) => `$${Number(v).toFixed(2)}`} />
                                    </RechartsPieChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="text-sm text-slate-400">Sin datos de fugas</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white">
                    <div className="flex items-center text-sm font-bold text-slate-800">
                        <Zap className="w-4 h-4 mr-2 text-amber-500 fill-amber-500" />
                        {t('top_saving_opportunities')}
                    </div>
                </div>
                <div className="divide-y divide-gray-50">
                    <div className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center">
                            <div className="bg-[#FFF4E5] p-2.5 rounded-lg mr-4">
                                <Tag className="w-5 h-5 text-amber-700 fill-amber-700/20" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-800">Instancia Reservada 3 años</h4>
                                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">12× VM</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-medium">Optimización de Tarifas · <span className="text-slate-700 font-bold">PROD-Core</span></p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-emerald-600 font-extrabold text-sm mb-2">$2,100 <span className="text-[10px] font-medium text-slate-400">/mes</span></div>
                            <button className="bg-[#0088FF] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-sm transition-colors">{t('btn_apply')}</button>
                        </div>
                    </div>

                    <div className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center">
                            <div className="bg-[#FFF8E6] p-2.5 rounded-lg mr-4">
                                <Moon className="w-5 h-5 text-amber-400 fill-amber-400" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-800">Power Schedule QA</h4>
                                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">6 VMs</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-medium">Horarios de Apagado · <span className="text-slate-700 font-bold">QA-Staging</span></p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-emerald-600 font-extrabold text-sm mb-2">$1,850 <span className="text-[10px] font-medium text-slate-400">/mes</span></div>
                            <button className="bg-[#0088FF] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-sm transition-colors">{t('btn_apply')}</button>
                        </div>
                    </div>

                    <div className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center">
                            <div className="bg-[#FFF8E6] p-2.5 rounded-lg mr-4">
                                <Moon className="w-5 h-5 text-amber-400 fill-amber-400" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-800">Power Schedule DEV</h4>
                                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">8 VMs</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-medium">Horarios de Apagado · <span className="text-slate-700 font-bold">DEV-Sandbox</span></p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-emerald-600 font-extrabold text-sm mb-2">$1,620 <span className="text-[10px] font-medium text-slate-400">/mes</span></div>
                            <button className="bg-[#0088FF] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-sm transition-colors">{t('btn_apply')}</button>
                        </div>
                    </div>

                    <div className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center">
                            <div className="bg-[#FFF4E5] p-2.5 rounded-lg mr-4">
                                <Tag className="w-5 h-5 text-amber-700 fill-amber-700/20" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-slate-800">Savings Plan de cómputo</h4>
                                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded-full">SQL MI</span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-medium">Optimización de Tarifas · <span className="text-slate-700 font-bold">PROD-Data</span></p>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-emerald-600 font-extrabold text-sm mb-2">$1,450 <span className="text-[10px] font-medium text-slate-400">/mes</span></div>
                            <button className="bg-[#0088FF] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-sm transition-colors">{t('btn_apply')}</button>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
}

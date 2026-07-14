"use client";
import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { Loader2, Activity, AlertTriangle, TrendingUp, CheckCircle, Clock, DollarSign, CheckCircle2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine, BarChart, Bar, Cell } from 'recharts';
import { hasAccess } from '@/lib/tierLogic';
import PremiumBanner from '@/components/PremiumBanner';
import { useCurrency } from '@/components/CurrencyProvider';
import { isMockTenant } from '@/lib/mockData';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

type AnomalyStatus = 'Open' | 'Postponed' | 'Dismissed' | 'Completed';

interface Anomaly {
    id: number;
    date: string;
    amount: number;
    expected_amount: number;
    z_score: number;
    status: AnomalyStatus;
    subscription_id: string;
    detected_at: string;
    resolved_at: string | null;
}

const TAB_ORDER: { key: AnomalyStatus | 'All'; labelKey: string }[] = [
    { key: 'Open', labelKey: 'tabOpen' },
    { key: 'Postponed', labelKey: 'tabPostponed' },
    { key: 'Dismissed', labelKey: 'tabDismissed' },
    { key: 'Completed', labelKey: 'tabCompleted' },
    { key: 'All', labelKey: 'tabAll' },
];

const STATUS_STYLES: Record<AnomalyStatus, string> = {
    Open: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400',
    Postponed: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400',
    Dismissed: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    Completed: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400',
};

const STATUS_CHART_COLORS: Record<AnomalyStatus, string> = {
    Open: '#ef4444',
    Postponed: '#f59e0b',
    Dismissed: '#9ca3af',
    Completed: '#10b981',
};

function formatDuration(hours: number): string {
    if (hours < 24) return `${hours.toFixed(1)}h`;
    return `${(hours / 24).toFixed(1)}d`;
}

export default function AnomalyDashboard() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const t = useTranslations('Anomalies');
    const tier = (selectedTenant as any)?.tier || 'Essential';
    const isPro = hasAccess(tier, 'Professional');

    const [activeTab, setActiveTab] = useState<AnomalyStatus | 'All'>('Open');
    const [localAnomalies, setLocalAnomalies] = useState<Anomaly[] | null>(null);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ['User.Read']);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Error al cargar anomalías");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (isPro && selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/intelligence/anomalies?tenantId=${selectedTenant.id}&tier=${tier}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    // Estado local editable (Postponer/Descartar/Completar/Reabrir) sincronizado
    // con cada fetch nuevo. La persistencia real de estas transiciones requiere
    // una tabla de seguimiento en backend; por ahora el cambio de estado vive en
    // la sesión del navegador.
    useEffect(() => {
        if (data?.anomalies) {
            setLocalAnomalies(data.anomalies.map((a: any) => ({ ...a, status: (a.status as AnomalyStatus) || 'Open' })));
        }
    }, [data]);

    const updateStatus = (id: number, status: AnomalyStatus) => {
        setLocalAnomalies(prev => prev ? prev.map(a => a.id === id
            ? { ...a, status, resolved_at: status === 'Open' ? null : new Date().toISOString() }
            : a
        ) : prev);
    };

    const counts = useMemo(() => {
        const base: Record<AnomalyStatus, number> = { Open: 0, Postponed: 0, Dismissed: 0, Completed: 0 };
        (localAnomalies || []).forEach(a => { base[a.status] = (base[a.status] || 0) + 1; });
        return base;
    }, [localAnomalies]);

    const kpis = useMemo(() => {
        const list = localAnomalies || [];
        const unresolvedImpact = list
            .filter(a => a.status === 'Open' || a.status === 'Postponed')
            .reduce((sum, a) => sum + Math.max(0, a.amount - a.expected_amount), 0);
        const resolved = list.filter(a => a.resolved_at);
        const avgHours = resolved.length > 0
            ? resolved.reduce((sum, a) => sum + (new Date(a.resolved_at!).getTime() - new Date(a.detected_at).getTime()) / 36e5, 0) / resolved.length
            : 0;
        return {
            open: counts.Open,
            unresolvedImpact,
            completed: counts.Completed,
            meanTimeToAction: avgHours,
        };
    }, [localAnomalies, counts]);

    const filteredAnomalies = useMemo(() => {
        const list = localAnomalies || [];
        if (activeTab === 'All') return list;
        return list.filter(a => a.status === activeTab);
    }, [localAnomalies, activeTab]);

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
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={tier} featureName="Detección de Anomalías" />;
        }
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

    const statusChartData = (Object.keys(counts) as AnomalyStatus[]).map(status => ({
        status,
        label: t(`status${status}` as any),
        value: counts[status],
    }));

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const val = payload[0].value;
            const isSpike = val > upperBound;
            return (
                <div className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700">
                    <p className="font-bold text-gray-900 dark:text-white mb-1">{label}</p>
                    <p className={`font-mono text-lg ${isSpike ? 'text-red-500' : 'text-brand-deep dark:text-brand-bright'}`}>
                        {format(val)}
                    </p>
                    {isSpike && <p className="text-xs text-red-500 font-bold mt-1">¡Desviación Crítica!</p>}
                </div>
            );
        }
        return null;
    };

    const actionsFor = (a: Anomaly) => {
        if (a.status === 'Open') {
            return (
                <div className="flex flex-wrap gap-2 justify-end">
                    <button onClick={() => updateStatus(a.id, 'Postponed')} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-400 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                        {t('actionPostpone')}
                    </button>
                    <button onClick={() => updateStatus(a.id, 'Dismissed')} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 dark:text-gray-400 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        {t('actionDismiss')}
                    </button>
                    <button onClick={() => updateStatus(a.id, 'Completed')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-brand-deep text-white hover:brightness-110 transition-all">
                        {t('actionComplete')}
                    </button>
                </div>
            );
        }
        if (a.status === 'Postponed') {
            return (
                <div className="flex flex-wrap gap-2 justify-end">
                    <button onClick={() => updateStatus(a.id, 'Open')} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 dark:text-gray-400 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        {t('actionReopen')}
                    </button>
                    <button onClick={() => updateStatus(a.id, 'Completed')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-brand-deep text-white hover:brightness-110 transition-all">
                        {t('actionComplete')}
                    </button>
                </div>
            );
        }
        // Dismissed / Completed
        return (
            <div className="flex justify-end">
                <button onClick={() => updateStatus(a.id, 'Open')} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 dark:text-gray-400 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    {t('actionReopen')}
                </button>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-2 text-red-600 dark:text-red-400">
                        <Activity className="w-4 h-4" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wide">{t('kpiOpenAnomalies')}</h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{kpis.open}</p>
                    <p className="text-xs text-gray-500 mt-1">{t('kpiOpenAnomaliesDesc')}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-2 text-amber-600 dark:text-amber-400">
                        <DollarSign className="w-4 h-4" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wide">{t('kpiUnresolvedImpact')}</h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{format(kpis.unresolvedImpact)}</p>
                    <p className="text-xs text-gray-500 mt-1">{t('kpiUnresolvedImpactDesc')}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-2 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wide">{t('kpiCompleted')}</h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{kpis.completed}</p>
                    <p className="text-xs text-gray-500 mt-1">{t('kpiCompletedDesc')}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-2 text-brand-deep dark:text-brand-bright">
                        <Clock className="w-4 h-4" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wide">{t('kpiMeanTimeToAction')}</h3>
                    </div>
                    <p className="text-3xl font-bold text-gray-900 dark:text-white">
                        {kpis.meanTimeToAction > 0 ? formatDuration(kpis.meanTimeToAction) : '—'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{t('kpiMeanTimeToActionDesc')}</p>
                </div>
            </div>

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
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{format(mean)}</p>
                        <p className="text-xs text-gray-500 mt-1">Promedio móvil de 60 días</p>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-purple-600 dark:text-purple-400">
                                <TrendingUp className="w-5 h-5" />
                            </div>
                            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Tolerancia Z-Score (3σ)</h3>
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">±{format(3 * stdDev)}</p>
                        <p className="text-xs text-gray-500 mt-1">Límite de alerta: {format(upperBound)}</p>
                    </div>

                    {counts.Open > 0 ? (
                        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-900/50 p-5 shadow-sm animate-in zoom-in">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg text-red-600 dark:text-red-400 animate-pulse">
                                    <AlertTriangle className="w-5 h-5" />
                                </div>
                                <h3 className="text-sm font-bold text-red-700 dark:text-red-400">¡Anomalía Activa!</h3>
                            </div>
                            <p className="text-2xl font-bold text-red-800 dark:text-red-300">
                                {format((localAnomalies || []).find(a => a.status === 'Open')!.amount)}
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">
                                Z-Score: {(localAnomalies || []).find(a => a.status === 'Open')!.z_score.toFixed(2)}
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
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">No hay anomalías abiertas pendientes de revisión.</p>
                        </div>
                    )}
                </div>

                {/* Chart */}
                <div className="col-span-1 lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">{t('confidenceBand')}</h3>
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
                                    tickFormatter={(val) => format(val, { compact: true })}
                                />
                                <Tooltip content={<CustomTooltip />} />

                                {/* Base Expected Band */}
                                <ReferenceArea y1={Math.max(0, mean - (3 * stdDev))} y2={upperBound} fill="#3b82f6" fillOpacity={0.05} />
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

            {/* Status distribution chart */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">{t('statusDistribution')}</h3>
                <div className="h-[180px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={statusChartData} layout="vertical" margin={{ left: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#374151" opacity={0.15} />
                            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
                            <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 12, fill: '#6B7280' }} />
                            <Tooltip cursor={{ fill: 'rgba(148,163,184,0.1)' }} />
                            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
                                {statusChartData.map((entry) => (
                                    <Cell key={entry.status} fill={STATUS_CHART_COLORS[entry.status]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="flex flex-wrap gap-1 px-4 pt-4 border-b border-gray-200 dark:border-slate-800">
                    {TAB_ORDER.map(tab => {
                        const count = tab.key === 'All'
                            ? (localAnomalies || []).length
                            : counts[tab.key as AnomalyStatus];
                        const isActive = activeTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`px-4 py-2 rounded-t-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
                                    isActive
                                        ? 'bg-brand-soft/60 dark:bg-slate-800 text-brand-deep dark:text-brand-bright border-b-2 border-brand-deep'
                                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800/60'
                                }`}
                            >
                                {t(tab.labelKey as any)}
                                {count > 0 && (
                                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-brand-deep text-white' : 'bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300'}`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {filteredAnomalies.length > 0 ? (
                    <div className="divide-y divide-gray-200 dark:divide-slate-800">
                        {filteredAnomalies.map((anomaly) => (
                            <div key={anomaly.id} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${STATUS_STYLES[anomaly.status]}`}>
                                            {t(`status${anomaly.status}` as any)}
                                        </span>
                                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{anomaly.date}</span>
                                    </div>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white mt-2">
                                        Pico de costo en <span className="font-mono text-brand-deep dark:text-brand-bright bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">{anomaly.subscription_id}</span>
                                    </p>
                                </div>
                                <div className="text-right space-y-2">
                                    <div>
                                        <p className="text-xl font-bold text-red-600 dark:text-red-400">{format(anomaly.amount)}</p>
                                        <p className="text-xs text-gray-500">{t('vsExpected')}: {format(anomaly.expected_amount)}</p>
                                    </div>
                                    {actionsFor(anomaly)}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="py-16 text-center text-gray-400">
                        <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
                        <p className="text-sm font-medium">{t('noAnomaliesInTab')}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

"use client";
import MockBanner from '@/components/MockBanner';
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { useLocale, useTranslations } from 'next-intl';
import { TrendingUp, Loader2, MapPin, BarChart3, Flag, AlertTriangle } from 'lucide-react';
import { IconClockHour4, IconChartLine, IconPlugConnected } from '@tabler/icons-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAIContext } from '@/hooks/useAIContext';
import { isMockTenant, getMockDataForRoute } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import { translateAdvisorText } from '@/lib/advisorI18n';


export default function HistoricalProgressPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const locale = useLocale();
    const t = useTranslations("OverviewProgress");
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any[]>([]);
    const [advisorRecs, setAdvisorRecs] = useState<any[]>([]);
    const [advisorSubs, setAdvisorSubs] = useState<any[]>([]);
    const [advisorLoading, setAdvisorLoading] = useState(false);
    const setPageContext = useAIContext(state => state.setPageContext);

    useEffect(() => {
        if (data.length > 0 || advisorRecs.length > 0) {
            setPageContext(t('pageTitle'), {
                scoreHistory: data,
                recursosAfectados: advisorRecs
            });
        }
    }, [data, advisorRecs, setPageContext]);

    useEffect(() => {
        if ((accounts.length === 0 && !isMockTenant(selectedTenant?.id || '')) || selectedTenant.id === 'default') return;

        const fetchData = async () => {
            setLoading(true);
            setAdvisorLoading(true);

            if (isMockTenant(selectedTenant.id)) {
                const tier = ((selectedTenant as any).tier || 'essential').toString().toLowerCase();
                const histMock = getMockDataForRoute('history', tier);
                if (histMock?.data) setData(histMock.data);

                const advMock = getMockDataForRoute('advisor', tier);
                if (advMock) {
                    setAdvisorSubs(advMock.subscriptions || []);
                    const flat: any[] = [];
                    Object.keys(advMock.recommendations || {}).forEach(cat => {
                        (advMock.recommendations[cat] || []).forEach((r: any) => {
                            flat.push({ ...r, category: cat });
                        });
                    });
                    setAdvisorRecs(flat);
                }
                setLoading(false);
                setAdvisorLoading(false);
                return;
            }

            try {
                const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };
                
                // Fetch History
                const res = await fetch(`/api/intelligence/history?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.data) {
                    setData(json.data);
                }

                // Fetch Advisor recommendations
                const advRes = await fetch(`/api/advisor?tenantId=${selectedTenant.id}&locale=${encodeURIComponent(locale)}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}`, 'Accept-Language': locale }
                });
                if (advRes.ok) {
                    const advJson = await advRes.json();
                    setAdvisorSubs(advJson.subscriptions || []);
                    if (advJson.recommendations) {
                        const flatRecs: any[] = [];
                        Object.keys(advJson.recommendations).forEach(cat => {
                            advJson.recommendations[cat].forEach((r: any) => {
                                flatRecs.push({ ...r, category: cat });
                            });
                        });
                        setAdvisorRecs(flatRecs);
                    }
                }
            } catch (e) {
                console.error(e);
            }
            setLoading(false);
            setAdvisorLoading(false);
        };
        fetchData();
    }, [selectedTenant, accounts, instance, locale]);

    const isDemo = isMockTenant(selectedTenant.id);

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">{t('selectTenantTitle')}</h2>
                <p className="text-sm text-gray-500 mt-2">{t('selectTenantDesc')}</p>
            </div>
        );
    }

    let currentScore = 0;
    let scoreImprovement = 0;
    let currentImpacted = 0;

    if (data.length > 0) {
        const last = data[data.length - 1];
        const first = data[0];
        currentScore = last.score || 0;
        currentImpacted = last.impacted_resources || 0;
        scoreImprovement = currentScore - (first.score || 0);
    }

    const formatYAxis = (tickItem: any) => `${tickItem}%`;

    // Fechas cortas y localizadas ("2 may" en vez de "2026-05-02"), evita que
    // el eje X se sature de texto repetido y largo.
    const formatXAxis = (value: string) => {
        const d = new Date(`${value}T00:00:00`);
        if (Number.isNaN(d.getTime())) return value;
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
    };
    const formatTooltipDate = (value: any) => {
        const d = new Date(`${value}T00:00:00`);
        if (Number.isNaN(d.getTime())) return value;
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    };

    const CustomDot = (props: any) => {
        const { cx, cy, index } = props;
        if (index === data.length - 1) {
            return (
                <circle cx={cx} cy={cy} r={6} stroke="#10b981" strokeWidth={3} fill="#ffffff" />
            );
        }
        return null;
    };

    return (
        <div className="content animate-in fade-in duration-500">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]"><TrendingUp className="w-4 h-4" /></span>
                        {t('pageTitle')}
                    </div>
                    <div className="vs">{t('pageSubtitle')}</div>
                </div>
                <div className="right">
                    <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-sm">
                        <MapPin className="w-3 h-3 mr-1 text-red-500 fill-red-500" />
                        {t('fullTenant')}
                    </span>
                </div>
            </div>

            <div className="mt-6">

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-emerald-500" />
                    {t('loadingData')}
                </div>
            ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm">
                    <BarChart3 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
                    <h2 className="text-lg font-bold text-slate-500 dark:text-slate-400">{t('noData.title')}</h2>
                    <p className="text-sm text-slate-400 text-center max-w-md">
                        {t('noData.desc')}
                    </p>
                </div>
            ) : (
                <>
                    {/* Summary Metric Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 flex flex-col justify-center">
                            <h3 className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wide mb-3">{t('metrics.currentScore')}</h3>
                            <div className="text-3xl font-extrabold text-emerald-500">
                                {currentScore.toFixed(1)}%
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 flex flex-col justify-center">
                            <h3 className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wide mb-3">{t('metrics.scoreImprovement')}</h3>
                            <div className={`text-3xl font-extrabold ${scoreImprovement >= 0 ? 'text-blue-600' : 'text-rose-500'}`}>
                                {scoreImprovement >= 0 ? `+${scoreImprovement.toFixed(1)}%` : `${scoreImprovement.toFixed(1)}%`}
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 flex flex-col justify-center">
                            <h3 className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wide mb-3">{t('metrics.criticalResources')}</h3>
                            <div className="text-3xl font-extrabold text-amber-500">
                                {currentImpacted}
                            </div>
                        </div>
                    </div>

                    {/* Chart */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-6">
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center text-slate-700 dark:text-slate-300 font-semibold text-sm">
                                <BarChart3 className="w-4 h-4 mr-2 text-slate-400" />
                                {t('chart.title')}
                            </div>
                            <div className={`text-xs font-medium ${isDemo ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                                {isDemo ? t('chart.demoData') : t('chart.realData')}
                            </div>
                        </div>
                        <div className="h-80 w-full font-sans relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data} margin={{ top: 10, right: 10, left: -6, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
                                        </linearGradient>
                                        <linearGradient id="colorImpacted" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35}/>
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="scan_date"
                                        tickFormatter={formatXAxis}
                                        tick={{ fill: 'var(--ink-soft)', fontSize: 12 }}
                                        tickMargin={10}
                                        axisLine={false}
                                        tickLine={false}
                                        minTickGap={28}
                                    />
                                    {/* Eje izquierdo: score 0-100% (dominio fijo, no auto-escala).
                                        Eje derecho: cantidad de recursos afectados, escala propia —
                                        antes compartían el mismo eje 0-100 y la serie de recursos
                                        (típicamente 0-10) quedaba aplastada casi invisible contra el
                                        piso del gráfico. */}
                                    <YAxis
                                        yAxisId="score"
                                        domain={[0, 100]}
                                        tickFormatter={formatYAxis}
                                        tick={{ fill: '#10b981', fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={44}
                                    />
                                    <YAxis
                                        yAxisId="impacted"
                                        orientation="right"
                                        allowDecimals={false}
                                        tick={{ fill: '#f59e0b', fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={34}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(16,40,73,0.15)' }}
                                        labelStyle={{ color: 'var(--ink)', fontWeight: 700, marginBottom: 4 }}
                                        itemStyle={{ fontWeight: 'bold' }}
                                        labelFormatter={formatTooltipDate}
                                        formatter={(value: any, name: any) => {
                                            if (name === "score") return [`${Number(value).toFixed(1)}%`, t('chart.optimizationScore')];
                                            return [t('chart.resourceCount', { count: value }), t('chart.unoptimizedResources')];
                                        }}
                                    />
                                    <Legend
                                        verticalAlign="top"
                                        align="right"
                                        height={32}
                                        iconType="circle"
                                        formatter={(value: string) => value === 'score' ? t('chart.optimizationScore') : t('chart.unoptimizedResources')}
                                        wrapperStyle={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}
                                    />
                                    <Area
                                        yAxisId="score"
                                        type="monotone"
                                        dataKey="score"
                                        name="score"
                                        stroke="#10b981"
                                        strokeWidth={2.5}
                                        fillOpacity={1}
                                        fill="url(#colorScore)"
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                        dot={<CustomDot />}
                                    />
                                    <Area
                                        yAxisId="impacted"
                                        type="monotone"
                                        dataKey="impacted_resources"
                                        name="impacted_resources"
                                        stroke="#f59e0b"
                                        strokeWidth={2.5}
                                        fillOpacity={1}
                                        fill="url(#colorImpacted)"
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        {/* Recursos Afectados */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
                                <div className="flex items-center text-slate-700 dark:text-slate-300 font-bold text-sm">
                                    <AlertTriangle className="w-4 h-4 mr-2 text-amber-500" />
                                    {t('affectedResources.title')}
                                </div>
                                <span className="text-[10px] font-bold uppercase py-1 px-2 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                    Azure Advisor
                                </span>
                            </div>

                            {advisorLoading ? (
                                <div className="p-8 text-center text-slate-400 text-sm flex justify-center items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                                    {t('affectedResources.loading')}
                                </div>
                            ) : advisorRecs.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 text-sm">
                                    {t('affectedResources.empty')}
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-96 overflow-y-auto">
                                    {advisorRecs.slice(0, 10).map((rec, idx) => {
                                        const savings = parseFloat(rec.extendedProperties?.savingsAmount || '0');
                                        const subName = advisorSubs.find(s => s.id === rec.subscriptionId)?.name || rec.subscriptionId;
                                        
                                        // Colors based on category
                                        let catBadge = "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
                                        if (rec.category === "Cost") catBadge = "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
                                        else if (rec.category === "Security") catBadge = "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400";
                                        else if (rec.category === "HighAvailability") catBadge = "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400";
                                        else if (rec.category === "Performance") catBadge = "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";

                                        return (
                                            <div key={idx} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="font-bold text-xs text-slate-800 dark:text-slate-200 break-all select-all mr-2">
                                                        {(() => {
                                                            const rawId = rec.resourceMetadata?.resourceId ? rec.resourceMetadata.resourceId.split('/').pop() : null;
                                                            const field = rec.impactedField;
                                                            if (field === 'Microsoft.Subscriptions/subscriptions' || rawId === rec.subscriptionId) {
                                                                return subName;
                                                            }
                                                            return rawId || field || t('affectedResources.fallbackResource');
                                                        })()}
                                                    </div>
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${catBadge}`}>
                                                        {rec.category}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                                                    {translateAdvisorText(rec.shortDescription?.problem, locale, 'problem')
                                                        || translateAdvisorText(rec.shortDescription?.solution, locale, 'solution')
                                                        || t('affectedResources.fallbackDescription')}
                                                </div>
                                                <div className="flex flex-wrap justify-between items-center mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/50 gap-2 text-[10px] text-slate-450 dark:text-slate-400">
                                                    <span className="font-medium break-all">{subName}</span>
                                                    {savings > 0 && (
                                                        <span className="font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded">
                                                            -${savings.toFixed(0)}{t('affectedResources.perMonth')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Hitos */}
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 flex items-center text-slate-700 dark:text-slate-300 font-bold text-sm bg-white dark:bg-slate-900">
                                <Flag className="w-4 h-4 mr-2 text-slate-500" />
                                {t('milestones.title')}
                            </div>
                            <div className="divide-y divide-gray-50 dark:divide-slate-800">
                                {/* Milestone 1 */}
                                <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded-lg mr-4 mt-1">
                                        <IconPlugConnected className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('milestones.onboarding.title')}</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('milestones.onboarding.desc')}</p>
                                    </div>
                                </div>
                                {/* Milestone 2 */}
                                <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg mr-4 mt-1 border border-blue-100 dark:border-blue-800/50">
                                        <IconChartLine className="w-5 h-5 text-blue-500 dark:text-blue-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('milestones.rightsizing.title')}</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('milestones.rightsizing.desc')}</p>
                                    </div>
                                </div>
                                {/* Milestone 3 */}
                                <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="bg-amber-50 dark:bg-amber-900/30 p-2 rounded-lg mr-4 mt-1 border border-amber-100 dark:border-amber-800/50">
                                        <IconClockHour4 className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t('milestones.autoShutdown.title')}</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('milestones.autoShutdown.desc')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
            </div>
        </div>
    );
}

"use client";
import MockBanner from '@/components/MockBanner';
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { useLocale } from 'next-intl';
import { TrendingUp, Loader2, MapPin, BarChart3, Check, Ruler, Moon, Flag, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAIContext } from '@/hooks/useAIContext';
import { isMockTenant, getMockDataForRoute } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';


export default function HistoricalProgressPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const locale = useLocale();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any[]>([]);
    const [advisorRecs, setAdvisorRecs] = useState<any[]>([]);
    const [advisorSubs, setAdvisorSubs] = useState<any[]>([]);
    const [advisorLoading, setAdvisorLoading] = useState(false);
    const setPageContext = useAIContext(state => state.setPageContext);

    useEffect(() => {
        if (data.length > 0 || advisorRecs.length > 0) {
            setPageContext('Progreso Histórico', {
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
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para ver su progreso.</p>
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

    const formatYAxis = (tickItem: any) => {
        return `${tickItem}`;
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
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <div className="flex items-center">
                        <div className="bg-blue-600 rounded-lg p-2 mr-3 text-white">
                            <TrendingUp className="w-5 h-5" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Progreso Histórico</h1>
                    </div>
                    <p className="text-sm text-slate-500 mt-1 ml-12">Evolución histórica del gasto y del ahorro capturado en el tenant.</p>
                </div>
                <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center shadow-sm">
                    <MapPin className="w-3 h-3 mr-1 text-red-500 fill-red-500" />
                    Tenant completo
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4 text-emerald-500" />
                    Cargando datos...
                </div>
            ) : data.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm">
                    <BarChart3 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
                    <h2 className="text-lg font-bold text-slate-500 dark:text-slate-400">Sin datos históricos</h2>
                    <p className="text-sm text-slate-400 text-center max-w-md">
                        Aún no hay datos para mostrar.
                    </p>
                </div>
            ) : (
                <>
                    {/* Summary Metric Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 flex flex-col justify-center">
                            <h3 className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Puntuación de Costo Actual</h3>
                            <div className="text-3xl font-extrabold text-emerald-500">
                                {currentScore.toFixed(1)}%
                            </div>
                        </div>
                        
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 flex flex-col justify-center">
                            <h3 className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Mejora en Score Histórico</h3>
                            <div className={`text-3xl font-extrabold ${scoreImprovement >= 0 ? 'text-blue-600' : 'text-rose-500'}`}>
                                {scoreImprovement >= 0 ? `+${scoreImprovement.toFixed(1)}%` : `${scoreImprovement.toFixed(1)}%`}
                            </div>
                        </div>
                        
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-5 flex flex-col justify-center">
                            <h3 className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Recursos Afectados Críticos</h3>
                            <div className="text-3xl font-extrabold text-amber-500">
                                {currentImpacted}
                            </div>
                        </div>
                    </div>

                    {/* Chart */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6 mb-6">
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center text-slate-700 dark:text-slate-300 font-semibold text-sm">
                                <BarChart3 className="w-4 h-4 mr-2 text-slate-400" />
                                Historial de Optimización de Costos (Azure Advisor)
                            </div>
                            <div className={`text-xs font-medium ${isDemo ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                                {isDemo ? 'Datos de demostración' : 'Datos reales de Azure'}
                            </div>
                        </div>
                        <div className="h-72 w-full font-sans relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                        </linearGradient>
                                        <linearGradient id="colorImpacted" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15}/>
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                                    <XAxis 
                                        dataKey="scan_date" 
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                        tickMargin={10}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis 
                                        tickFormatter={formatYAxis} 
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        itemStyle={{ fontWeight: 'bold' }}
                                        formatter={(value: any, name: any) => {
                                            if (name === "score") return [`${Number(value).toFixed(1)}%`, "Score de Optimización"];
                                            return [`${value} rec.`, "Recursos Desoptimizados"];
                                        }}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="score" 
                                        name="score"
                                        stroke="#10b981" 
                                        strokeWidth={3}
                                        fillOpacity={1} 
                                        fill="url(#colorScore)" 
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                        dot={<CustomDot />}
                                    />
                                    <Area 
                                        type="monotone" 
                                        dataKey="impacted_resources" 
                                        name="impacted_resources"
                                        stroke="#f59e0b" 
                                        strokeWidth={3}
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
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
                                <div className="flex items-center text-slate-700 dark:text-slate-300 font-bold text-sm">
                                    <AlertTriangle className="w-4 h-4 mr-2 text-amber-500" />
                                    Recursos Afectados
                                </div>
                                <span className="text-[10px] font-bold uppercase py-1 px-2 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                    Azure Advisor
                                </span>
                            </div>
                            
                            {advisorLoading ? (
                                <div className="p-8 text-center text-slate-400 text-sm flex justify-center items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                                    Cargando recomendaciones...
                                </div>
                            ) : advisorRecs.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 text-sm">
                                    Sin recursos afectados detectados por Advisor 🎉
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
                                                            return rawId || field || "Recurso";
                                                        })()}
                                                    </div>
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${catBadge}`}>
                                                        {rec.category}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                                                    {rec.shortDescription?.problem || rec.shortDescription?.solution || "Recomendación de Advisor"}
                                                </div>
                                                <div className="flex flex-wrap justify-between items-center mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/50 gap-2 text-[10px] text-slate-450 dark:text-slate-400">
                                                    <span className="font-medium break-all">{subName}</span>
                                                    {savings > 0 && (
                                                        <span className="font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded">
                                                            -${savings.toFixed(0)}/mes
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
                        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center text-slate-700 dark:text-slate-300 font-bold text-sm bg-white dark:bg-slate-900">
                                <Flag className="w-4 h-4 mr-2 text-slate-500" />
                                Hitos
                            </div>
                            <div className="divide-y divide-gray-50 dark:divide-slate-800">
                                {/* Hito 1 */}
                                <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="bg-emerald-100 dark:bg-emerald-900/30 p-2 rounded-lg mr-4 mt-1">
                                        <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Onboarding del tenant</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Conexión vía Entra ID y primera línea base de gasto establecida.</p>
                                    </div>
                                </div>
                                {/* Hito 2 */}
                                <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg mr-4 mt-1 border border-blue-100 dark:border-blue-800/50">
                                        <Ruler className="w-5 h-5 text-blue-500 dark:text-blue-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Programa de rightsizing</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Revisión continua de SKUs sobre métricas P95.</p>
                                    </div>
                                </div>
                                {/* Hito 3 */}
                                <div className="p-4 flex items-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="bg-amber-50 dark:bg-amber-900/30 p-2 rounded-lg mr-4 mt-1 border border-amber-100 dark:border-amber-800/50">
                                        <Moon className="w-5 h-5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Apagado automático en no-productivos</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Power schedules activos en QA y DEV.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

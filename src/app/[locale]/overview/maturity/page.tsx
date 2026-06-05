"use client";
import React, { useEffect, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Target, TrendingUp, AlertTriangle, CheckCircle2, Loader2, Info, Eye, DollarSign, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function MaturityPage() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const t = useTranslations("Maturity");
    const [loading, setLoading] = useState(false);
    const [scoreData, setScoreData] = useState<any>(null);

    useEffect(() => {
        if (accounts.length === 0 || selectedTenant.id === 'default') return;

        const fetchMaturity = async () => {
            setLoading(true);
            setScoreData(null);
            try {
                const tokenResponse = await instance.acquireTokenSilent({
                    scopes: ["User.Read"],
                    account: accounts[0]
                });
                const res = await fetch(`/api/intelligence/maturity?tenantId=${selectedTenant.id}`, {
                    headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
                });
                const json = await res.json();
                if (json.data) {
                    setScoreData(json.data);
                }
            } catch (e) {
                console.error(e);
            }
            setLoading(false);
        };
        fetchMaturity();
    }, [selectedTenant.id, accounts, instance]);

    const getPhaseInfo = (score: number) => {
        if (score < 40) return { label: 'Crawl', color: 'text-red-500', bg: 'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800' };
        if (score <= 75) return { label: 'Walk', color: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800' };
        return { label: 'Run', color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800' };
    };

    if (selectedTenant.id === 'default') {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm">
                <span className="text-4xl mb-4">🔐</span>
                <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Selecciona un Tenant</h2>
                <p className="text-sm text-gray-500 mt-2">Debes seleccionar una organización para evaluar su madurez.</p>
            </div>
        );
    }

    const phase = scoreData ? getPhaseInfo((scoreData?.overallScore || 0)) : getPhaseInfo(0);

    const pillars = [
        { key: "VisibilityAndAllocation", icon: Eye, score: scoreData?.pillars?.VisibilityAndAllocation || 0 },
        { key: "UsageOptimization", icon: AlertTriangle, score: scoreData?.pillars?.UsageOptimization || 0 },
        { key: "RateOptimization", icon: TrendingUp, score: scoreData?.pillars?.RateOptimization || 0 },
        { key: "ForecastingAndBudgeting", icon: DollarSign, score: scoreData?.pillars?.ForecastingAndBudgeting || 0 },
        { key: "GovernanceAndAutomation", icon: Settings, score: scoreData?.pillars?.GovernanceAndAutomation || 0 }
    ];

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="mb-8 border-b border-gray-200 dark:border-slate-800 pb-4">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <Target className="w-8 h-8 mr-3 text-indigo-600 dark:text-indigo-400" />
                    Madurez FinOps
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Alineación con el framework de la FinOps Foundation.</p>
            </div>
            
            <div className="relative">
                {(loading || !scoreData) && (
                    <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 z-50 flex flex-col items-center justify-center rounded-2xl backdrop-blur-sm">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
                        <span className="text-lg font-semibold text-gray-700 dark:text-gray-300">Procesando telemetría...</span>
                    </div>
                )}
                <div className={`grid grid-cols-1 lg:grid-cols-3 gap-8 ${(loading || !scoreData) ? 'opacity-50 pointer-events-none' : ''}`}>
                {/* Overall Score Gauge Section */}
                <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 p-8 flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 dark:bg-indigo-900/20 rounded-bl-full -z-10"></div>
                    <h2 className="text-lg font-bold text-gray-600 dark:text-gray-400 mb-6 uppercase tracking-wider text-center">Overall Health Score</h2>
                    
                    <div className="relative flex items-center justify-center w-48 h-48">
                        <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                            <circle cx="96" cy="96" r="80" className="stroke-gray-100 dark:stroke-slate-800" strokeWidth="16" fill="none" />
                            <circle cx="96" cy="96" r="80" className="stroke-indigo-600 dark:stroke-indigo-400" strokeWidth="16" fill="none" strokeDasharray="502" strokeDashoffset={502 - (502 * (scoreData?.overallScore || 0)) / 100} strokeLinecap="round" />
                        </svg>
                        <div className="flex flex-col items-center z-10 justify-center">
                            <span className="text-6xl font-black text-indigo-600 dark:text-indigo-400">{(scoreData?.overallScore || 0)}</span>
                            <span className="text-sm font-semibold text-gray-400">/ 100</span>
                        </div>
                    </div>

                    <div className={`mt-8 px-6 py-2 rounded-full border flex items-center font-bold uppercase tracking-widest relative group ${phase.bg} ${phase.color}`}>
                        Fase Actual: {phase.label}
                        <Info className="w-4 h-4 ml-2 cursor-pointer opacity-70 hover:opacity-100" />
                        {/* Tooltip Phase */}
                        <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 w-64 bg-gray-900 text-white text-xs rounded py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                            {t('info_phase')}
                        </div>
                    </div>
                </div>

                {/* Pillars Breakdown Section */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">Desglose por Pilares FinOps</h3>
                    
                    {pillars.map(pillar => (
                        <div key={pillar.key} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 transition-all hover:shadow-md">
                            <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center">
                                    <pillar.icon className={`w-5 h-5 mr-3 ${pillar.score < 50 ? 'text-red-500' : 'text-indigo-500'}`} />
                                    <div className="flex items-center group relative">
                                        <h4 className="font-bold text-gray-900 dark:text-white cursor-pointer hover:underline">{t(pillar.key)}</h4>
                                        <Info className="w-4 h-4 ml-2 text-gray-400 cursor-pointer" />
                                        
                                        {/* Tooltip Pillar */}
                                        <div className="absolute bottom-full mb-2 left-0 w-64 bg-gray-900 text-white text-xs rounded py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                                            {t(`info_${pillar.key}`)}
                                        </div>
                                    </div>
                                </div>
                                <span className="text-xl font-black text-gray-700 dark:text-gray-300">{pillar.score}%</span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                                <div className={`h-2 rounded-full ${pillar.score < 50 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${pillar.score}%` }}></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    </div>
    );
}

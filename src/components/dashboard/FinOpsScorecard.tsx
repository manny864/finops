"use client";
import React, { useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { Loader2, Trophy, Medal, AlertTriangle, ChevronDown, ChevronUp, DollarSign } from 'lucide-react';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";

export default function FinOpsScorecard() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });

        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Error al cargar Scorecard");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id))) 
            ? `/api/intelligence/scorecard?tenantId=${selectedTenant.id}` 
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const toggleExpand = (team: string) => {
        setExpandedTeams(prev => ({ ...prev, [team]: !prev[team] }));
    };

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Calculando puntajes de eficiencia...</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName="FinOps Scorecard" />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <p className="text-sm font-bold">Error de Procesamiento: {error.message}</p>
            </div>
        );
    }

    const leaderboard = data?.data || [];

    if (leaderboard.length === 0) {
        return (
            <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
                <p className="text-gray-500 dark:text-gray-400">No hay datos de etiquetas suficientes para armar el Scorecard.</p>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6">
            <div className="flex flex-col gap-4">
                {leaderboard.map((item: any, index: number) => {
                    const isFirst = index === 0;
                    const isWarning = item.score < 60;
                    const isExpanded = !!expandedTeams[item.team];

                    return (
                        <div 
                            key={item.team} 
                            className={`rounded-xl border shadow-sm overflow-hidden transition-all duration-300 ${
                                isFirst ? 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10 border-amber-200 dark:border-amber-700' :
                                isWarning ? 'bg-white dark:bg-slate-900 border-red-200 dark:border-red-800/50' : 
                                'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800'
                            }`}
                        >
                            <div 
                                className="flex items-center justify-between p-4 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                                onClick={() => toggleExpand(item.team)}
                            >
                                <div className="flex items-center gap-4">
                                    {/* Rank Badge */}
                                    <div className={`w-12 h-12 flex items-center justify-center rounded-full font-black text-lg ${
                                        isFirst ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 shadow-inner' :
                                        index === 1 ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300' :
                                        index === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                                        'bg-gray-50 text-gray-400 dark:bg-slate-800 dark:text-slate-500'
                                    }`}>
                                        {isFirst ? <Trophy className="w-6 h-6" /> : 
                                         index < 3 ? <Medal className="w-6 h-6" /> : 
                                         `#${index + 1}`
                                        }
                                    </div>
                                    
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                            {item.team}
                                            {isWarning && <span className="flex items-center text-xs font-bold bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded uppercase tracking-wider"><AlertTriangle className="w-3 h-3 mr-1"/> FinOps Review Required</span>}
                                        </h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                            <DollarSign className="w-3 h-3" /> Gasto del Equipo: ${(item.totalCost).toLocaleString()}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <div className="text-right">
                                        <p className="text-xs uppercase font-bold text-gray-400 dark:text-gray-500 mb-1 tracking-widest">Eficiencia</p>
                                        <div className="flex items-baseline gap-1">
                                            <span className={`text-4xl font-black ${
                                                isFirst ? 'text-amber-600 dark:text-amber-500' :
                                                isWarning ? 'text-red-500' :
                                                'text-green-600 dark:text-green-500'
                                            }`}>
                                                {item.score}
                                            </span>
                                            <span className="text-sm font-medium text-gray-400">/100</span>
                                        </div>
                                    </div>
                                    {isExpanded ? <ChevronUp className="text-gray-400" /> : <ChevronDown className="text-gray-400" />}
                                </div>
                            </div>

                            {/* Detalle Desplegable: Penalizaciones */}
                            {isExpanded && (
                                <div className="bg-gray-50 dark:bg-slate-900/50 border-t border-gray-100 dark:border-slate-800 p-5 animate-in slide-in-from-top-2">
                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Factores de Penalización</h4>
                                    {(!item.penalties || item.penalties.length === 0) ? (
                                        <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                                            <span>✨</span> Este equipo no tiene ineficiencias críticas detectadas.
                                        </p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {item.penalties.map((pen: any, idx: number) => (
                                                <li key={idx} className="flex justify-between items-center text-sm p-3 bg-white dark:bg-slate-800 rounded border border-gray-200 dark:border-slate-700">
                                                    <span className="text-gray-700 dark:text-gray-300">{pen.reason}</span>
                                                    <div className="flex gap-4">
                                                        <span className="text-red-500 font-bold">{pen.impact} Puntos</span>
                                                        {pen.costImpact > 0 && (
                                                            <span className="text-gray-500 dark:text-gray-400 font-medium w-24 text-right">
                                                                Impacto: ${pen.costImpact}
                                                            </span>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

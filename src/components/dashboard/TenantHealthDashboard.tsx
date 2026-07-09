"use client";
import React from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { Loader2, HeartPulse } from 'lucide-react';
import { hasAccess } from '@/lib/tierLogic';
import PremiumBanner from '@/components/PremiumBanner';
import { isMockTenant } from '@/lib/mockData';

function gradeColor(grade: string): string {
    if (grade === 'A') return '#10b981';
    if (grade === 'B') return '#0ea5e9';
    if (grade === 'C') return '#f59e0b';
    return '#ef4444';
}

function scoreBarColor(score: number): string {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 55) return 'bg-amber-500';
    return 'bg-red-500';
}

export default function TenantHealthDashboard() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const tier = (selectedTenant as any)?.tier || 'Essential';
    const isPro = hasAccess(tier, 'Professional');

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ['User.Read']);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || 'Error al cargar el estado de salud del tenant');
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        (isPro && selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/intelligence/tenant-health?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === 'default') return null;

    if (!isPro) {
        return (
            <PremiumBanner
                title="Dashboard de Salud del Tenant"
                description="Score compuesto que combina presupuesto, credenciales por expirar, optimización de recomendaciones y postura de seguridad en un solo número accionable."
                requiredTier="Professional"
                icon="shield"
            />
        );
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500">Calculando salud del tenant...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100">
                <p className="font-bold">Error: {error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Score principal */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm flex flex-col items-center justify-center">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400 mb-3">
                        <HeartPulse className="w-5 h-5" />
                    </div>
                    <div className="flex items-baseline gap-2">
                        <p className="text-6xl font-extrabold" style={{ color: gradeColor(data.grade) }}>{data.overallScore}</p>
                        <span className="text-2xl font-bold text-gray-400">/100</span>
                    </div>
                    <span
                        className="mt-3 px-3 py-1 rounded-full text-sm font-bold text-white"
                        style={{ backgroundColor: gradeColor(data.grade) }}
                    >
                        Grado {data.grade}
                    </span>
                    <p className="text-xs text-gray-400 mt-3 text-center">Score compuesto ponderado de las 4 señales de la derecha</p>
                </div>

                {/* Señales */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Señales de Salud</h3>
                    <div className="space-y-4">
                        {(data.signals || []).map((s: any) => (
                            <div key={s.key}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{s.label}</span>
                                    <span className="text-sm font-bold text-gray-900 dark:text-white">{s.score}/100 <span className="text-gray-400 font-normal">(peso {s.weight}%)</span></span>
                                </div>
                                <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                                    <div className={`h-full rounded-full ${scoreBarColor(s.score)}`} style={{ width: `${Math.max(2, s.score)}%` }} />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">{s.detail}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {data.trend && (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Tendencia (Demo)</h3>
                    <div className="flex items-end gap-3 h-24">
                        {data.trend.map((t: any) => (
                            <div key={t.month} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full rounded-t bg-brand-deep/70" style={{ height: `${Math.max(4, t.score)}%` }} />
                                <span className="text-[10px] text-gray-400">{t.month.slice(5)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

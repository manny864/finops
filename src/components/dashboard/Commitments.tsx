"use client";
import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { useTranslations } from 'next-intl';
import {
    IconLoader2,
    IconTrendingUp,
    IconShieldCheck,
    IconAlertCircle,
    IconChevronLeft,
    IconChevronRight,
    IconBookmark,
    IconRefresh,
    IconCalculator,
    IconClockHour4,
    IconShieldExclamation
} from '@tabler/icons-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip
} from 'recharts';
import { useCurrency } from '@/components/CurrencyProvider';
import { AzureCommitmentSimulatorService } from '@/services/azureCommitmentSimulator.service';
import ReservationRenewalModal, { type RenewReservation } from '@/components/dashboard/ReservationRenewalModal';
import ReservationUtilizationModal, { type UtilReservation } from '@/components/dashboard/ReservationUtilizationModal';
import { isMockTenant } from '@/lib/mockData';
import { getFreshIdToken } from '@/lib/msalToken';
import TierLockedNotice, { parseTierRequiredError } from "@/components/TierLockedNotice";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";

interface ReservationDetail {
    reservationId: string;
    orderId: string;
    name: string;
    status: string;
    expiryDate: string | null;
    scopeType: string;
    scope: string;
    type: string;
    productName: string;
    region: string;
    renew: boolean;
    quantity: number;
    term: string;
    utilizationLastDay: number | null;
    utilizationLast7Days: number | null;
}

function statusBadgeClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s.includes('succeed') || s.includes('active')) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    if (s.includes('expir') || s.includes('cancel') || s.includes('fail')) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
}

function utilTextColor(v: number | null): string {
    if (v === null) return 'text-gray-400';
    return v >= 80 ? 'text-emerald-600 dark:text-emerald-400' : v >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
}

// Reserva "huérfana": sigue activa/facturando pero sin consumo real en los últimos
// 7 días — típicamente porque la VM/recurso subyacente se eliminó o cambió de familia
// y nadie migró/canceló la reserva. Es una detección honesta con lo que ya trae el
// blade de Reservations (sin collector nuevo): utilización ~0% con status activo.
function isOrphaned(r: ReservationDetail): boolean {
    const s = (r.status || '').toLowerCase();
    const isActive = s.includes('succeed') || s.includes('active');
    return isActive && r.utilizationLast7Days !== null && r.utilizationLast7Days < 5;
}

function fmtExpiry(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
}

export default function Commitments() {
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const { format } = useCurrency();
    const t = useTranslations('Commitments');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [renewTarget, setRenewTarget] = useState<RenewReservation | null>(null);
    const [utilTarget, setUtilTarget] = useState<UtilReservation | null>(null);
    const [simSpend, setSimSpend] = useState<number>(3500);
    const [simWorkload, setSimWorkload] = useState<"general" | "compute" | "database">("general");

    const authFetch = useCallback(async (url: string, init?: RequestInit) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);

        const res = await fetch(url, {
            ...init,
            headers: {
                ...(init?.headers || {}),
                'Authorization': `Bearer ${idToken}`
            }
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(json.details || json.error || t("requestError"));
        }

        return json;
    }, [accounts, instance]);

    const { data, error, isLoading, mutate } = useSWR(
        (selectedTenant && selectedTenant.id !== 'default' && (accounts.length > 0 || isMockTenant(selectedTenant.id)))
            ? `/api/intelligence/commitments?tenantId=${selectedTenant.id}`
            : null,
        authFetch,
        { revalidateOnFocus: false }
    );

    const metrics = useMemo(() => {
        if (!data || !data.data) return null;
        return data.data;
    }, [data]);

    if (!selectedTenant || selectedTenant.id === 'default') {
        return null;
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <IconLoader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">{t('loading')}</p>
            </div>
        );
    }

    if (error) {
        const requiredTier = parseTierRequiredError(error.message);
        if (requiredTier) {
            return <TierLockedNotice requiredTier={requiredTier} currentTier={(selectedTenant as any)?.tier} featureName={t('pageTitle')} />;
        }
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold">{t('errorProcessingTitle')}</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!metrics) return null;

    const hasReservations: boolean = Boolean(metrics.hasReservations);
    const utilizationKnown: boolean = typeof metrics.utilization === 'number' && metrics.utilization >= 0;
    const utilizationValue: number = utilizationKnown ? Number(metrics.utilization) : 0;

    const utilizationColor = !utilizationKnown
        ? '#9CA3AF'
        : utilizationValue >= 80 ? '#10B981' : (utilizationValue >= 70 ? '#F59E0B' : '#EF4444');
    const utilizationData = utilizationKnown
        ? [
            { name: t('utilizationLabelUsed'), value: utilizationValue },
            { name: t('utilizationLabelWaste'), value: 100 - utilizationValue }
          ]
        : [{ name: t('utilizationLabelNoData'), value: 100 }];

    const reservationDetails: ReservationDetail[] = metrics.reservationDetails || [];
    const orphanedReservations = reservationDetails.filter(isOrphaned);

    const coverageColor = metrics.coverage >= 60 ? '#3B82F6' : '#6366F1';
    const coverageData = [
        { name: t('coverageLabelCovered'), value: metrics.coverage },
        { name: t('coverageLabelOnDemand'), value: 100 - metrics.coverage }
    ];

    const exchangeQuota = metrics.exchangeQuota || {
        totalLimitUSD: 50000,
        usedRefundsUSD: 8500,
        remainingQuotaUSD: 41500,
        usagePercentage: 17.0,
        isWarning: false,
        isCritical: false
    };

    const activeSimSpend = simSpend || metrics.breakevenSummary?.paygMonthly || 3500;
    const simResult = useMemo(() => {
        return AzureCommitmentSimulatorService.calculateBreakeven({
            paygMonthly: activeSimSpend,
            workloadType: simWorkload
        });
    }, [activeSimSpend, simWorkload]);

    return (
        <div className="w-full space-y-6">
            
            {/* Top Section: Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Utilización */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col items-center">
                    <div className="w-full flex justify-between items-start mb-2">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <IconShieldCheck className="w-5 h-5 text-green-500" />
                                {t('utilizationCardTitle')}
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{t('utilizationCardSubtitle')}</p>
                        </div>
                    </div>
                    
                    <div className="h-48 w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={utilizationData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    startAngle={90}
                                    endAngle={-270}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    <Cell fill={utilizationColor} />
                                    <Cell fill="#E5E7EB" className="dark:fill-slate-700" />
                                </Pie>
                                <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} {...TOOLTIP_TEMA} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                            <span className="text-3xl font-black text-gray-900 dark:text-white" style={{ color: utilizationColor }}>
                                {utilizationKnown ? `${utilizationValue.toFixed(1)}%` : t('na')}
                            </span>
                        </div>
                    </div>
                    {!hasReservations ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-400 p-2 rounded text-sm">
                            <IconAlertCircle className="w-4 h-4" /> {t('utilizationEmptyState')}
                        </div>
                    ) : !utilizationKnown ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 p-2 rounded text-sm">
                            <IconAlertCircle className="w-4 h-4" /> {t('utilizationUnavailableState')}
                        </div>
                    ) : utilizationValue < 70 ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-2 rounded text-sm font-medium">
                            <IconAlertCircle className="w-4 h-4" /> {t('utilizationAlertState')}
                        </div>
                    ) : null}
                </div>

                {/* Cobertura */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col items-center">
                    <div className="w-full flex justify-between items-start mb-2">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <IconTrendingUp className="w-5 h-5 text-blue-500" />
                                {t('coverageCardTitle')}
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{t('coverageCardSubtitle')}</p>
                        </div>
                    </div>
                    
                    <div className="h-48 w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={coverageData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    startAngle={90}
                                    endAngle={-270}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    <Cell fill={coverageColor} />
                                    <Cell fill="#E5E7EB" className="dark:fill-slate-700" />
                                </Pie>
                                <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} {...TOOLTIP_TEMA} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                            <span className="text-3xl font-black text-gray-900 dark:text-white" style={{ color: coverageColor }}>
                                {metrics.coverage.toFixed(1)}%
                            </span>
                        </div>
                    </div>
                </div>

            </div>

            {/* ── MEJ-16: Monitor de Límite Anual de Reembolso ($50k USD) ──────── */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-xl shrink-0 ${exchangeQuota.isWarning ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'}`}>
                            <IconShieldExclamation className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                                    {t('quotaTitle')}
                                </h3>
                                {exchangeQuota.isWarning && (
                                    <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                        {t('quotaWarning')}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5" dangerouslySetInnerHTML={{ __html: t.raw('quotaDesc') as string }} />
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 block">{t('quotaRemaining')}</span>
                        <span className={`text-xl font-black ${exchangeQuota.isWarning ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {format(exchangeQuota.remainingQuotaUSD)}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 block">{t('quotaOf', { total: format(exchangeQuota.totalLimitUSD) })}</span>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-gray-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-500 ${exchangeQuota.isCritical ? 'bg-red-500' : exchangeQuota.isWarning ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, exchangeQuota.usagePercentage)}%` }}
                    />
                </div>
                <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 mt-2">
                    <span>{t('quotaUsed')} <strong>{format(exchangeQuota.usedRefundsUSD)}</strong> ({exchangeQuota.usagePercentage.toFixed(1)}%)</span>
                    <span>{t('quotaWindow')}</span>
                </div>
            </div>

            {/* ── MEJ-16: Simulador de Breakeven y Mix Óptimo ───────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div className="flex items-start gap-3">
                        <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 shrink-0">
                            <IconCalculator className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-gray-900 dark:text-white">
                                {t('simTitle')}
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {t('simDesc')}
                            </p>
                        </div>
                    </div>
                    {/* Workload selector */}
                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
                        {(['general', 'compute', 'database'] as const).map((w) => (
                            <button
                                key={w}
                                onClick={() => setSimWorkload(w)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors capitalize ${simWorkload === w ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                            >
                                {w === 'general' ? t('workloadGeneral') : w === 'compute' ? t('workloadCompute') : t('workloadDatabase')}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Slider / Input */}
                <div className="mb-6 bg-gray-50 dark:bg-slate-800/40 p-4 rounded-xl border border-gray-100 dark:border-slate-800">
                    <div className="flex justify-between items-center mb-2 text-sm">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{t('paygMonthlySpend')}</span>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">$</span>
                            <input
                                type="number"
                                min="100"
                                max="100000"
                                step="100"
                                value={activeSimSpend}
                                onChange={(e) => setSimSpend(Math.max(0, Number(e.target.value)))}
                                className="w-24 px-2 py-1 text-right text-sm font-bold bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </div>
                    </div>
                    <input
                        type="range"
                        min="500"
                        max="25000"
                        step="250"
                        value={activeSimSpend}
                        onChange={(e) => setSimSpend(Number(e.target.value))}
                        className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                    <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                        <span>$500</span>
                        <span>$10,000</span>
                        <span>$25,000+</span>
                    </div>
                </div>

                {/* KPI cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-800/60 p-4 rounded-xl">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                            <IconClockHour4 className="w-4 h-4 text-emerald-500" />
                            <span>{t('breakeven1yr')}</span>
                        </div>
                        <span className="text-2xl font-black text-gray-900 dark:text-white">
                            {simResult.breakevenMonths1yr} <span className="text-sm font-normal text-gray-500">{t('monthsUnit')}</span>
                        </span>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                            {t('savingsAfterBreakeven', { amount: format(simResult.savingsMonthly1yr) })}
                        </p>
                    </div>

                    <div className="border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-800/60 p-4 rounded-xl">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                            <IconClockHour4 className="w-4 h-4 text-blue-500" />
                            <span>{t('breakeven3yr')}</span>
                        </div>
                        <span className="text-2xl font-black text-gray-900 dark:text-white">
                            {simResult.breakevenMonths3yr} <span className="text-sm font-normal text-gray-500">{t('monthsUnit')}</span>
                        </span>
                        <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-1">
                            {t('savingsAfterBreakeven', { amount: format(simResult.savingsMonthly3yr) })}
                        </p>
                    </div>

                    <div className="border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-800/60 p-4 rounded-xl">
                        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                            <IconTrendingUp className="w-4 h-4 text-indigo-500" />
                            <span>{t('optimalAnnualSavings')}</span>
                        </div>
                        <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                            {format(simResult.recommendedMix.projectedAnnualSavingsUSD)}
                        </span>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {t('netAnnualizedProjection')}
                        </p>
                    </div>
                </div>

                {/* Recommended Mix Bar */}
                <div className="border-t border-gray-100 dark:border-slate-800 pt-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                        {t('suggestedDistribution')}
                    </h4>
                    <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">
                        {simResult.recommendedMix.explanation}
                    </p>
                    <div className="w-full bg-gray-100 dark:bg-slate-800 h-4 rounded-lg overflow-hidden flex">
                        <div 
                            title={`Savings Plans: ${simResult.recommendedMix.savingsPlansPercent}%`}
                            className="bg-indigo-500 h-full text-[10px] text-white font-bold flex items-center justify-center transition-all duration-300"
                            style={{ width: `${simResult.recommendedMix.savingsPlansPercent}%` }}
                        >
                            {simResult.recommendedMix.savingsPlansPercent}%
                        </div>
                        <div 
                            title={`Reserved Instances: ${simResult.recommendedMix.reservedInstancesPercent}%`}
                            className="bg-emerald-500 h-full text-[10px] text-white font-bold flex items-center justify-center transition-all duration-300"
                            style={{ width: `${simResult.recommendedMix.reservedInstancesPercent}%` }}
                        >
                            {simResult.recommendedMix.reservedInstancesPercent}%
                        </div>
                        <div 
                            title={t('elasticPayg', { pct: simResult.recommendedMix.paygPercent })}
                            className="bg-amber-400 h-full text-[10px] text-slate-900 font-bold flex items-center justify-center transition-all duration-300"
                            style={{ width: `${simResult.recommendedMix.paygPercent}%` }}
                        >
                            {simResult.recommendedMix.paygPercent}%
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs mt-2 text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" /> Savings Plans ({simResult.recommendedMix.savingsPlansPercent}%)</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> {t('reservasLegend', { pct: simResult.recommendedMix.reservedInstancesPercent })}</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> {t('elasticPaygBuffer', { pct: simResult.recommendedMix.paygPercent })}</span>
                    </div>
                </div>
            </div>

            {/* ── Reservas Activas ─────────────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                    <IconBookmark className="w-5 h-5 text-emerald-500" />
                    {t('reservasTitle')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    {t('reservasSubtitle')}
                </p>
                {orphanedReservations.length > 0 && (
                    <div className="mb-4 flex items-start gap-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-3 rounded-lg text-sm font-medium">
                        <IconAlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{t('orphanedAlert', { count: orphanedReservations.length })}</span>
                    </div>
                )}
                {!metrics.reservationDetails?.length ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                        {t('empty')}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-800/50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colName')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colStatus')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colExpiration')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colScope')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colType')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colProduct')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colRegion')}</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colRenewal')}</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colQuantity')}</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colUtilLastDay')}</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('colUtil7Days')}</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
                                {(metrics.reservationDetails as ReservationDetail[]).map((r: ReservationDetail, idx: number) => (
                                    <tr key={r.reservationId || idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                            <span className="inline-flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full shrink-0 ${isOrphaned(r) ? 'bg-red-500' : 'bg-emerald-400'}`} />
                                                <span className="truncate max-w-[180px]" title={r.name}>{r.name}</span>
                                                {isOrphaned(r) && (
                                                    <span
                                                        title={t('orphanedTooltip')}
                                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 shrink-0"
                                                    >
                                                        {t('orphanedBadge')}
                                                    </span>
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadgeClass(r.status)}`}>{r.status}</span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{fmtExpiry(r.expiryDate)}</td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap" title={r.scopeType}>{r.scope}</td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.type}</td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400"><span className="truncate max-w-[200px] inline-block align-bottom" title={r.productName}>{r.productName}</span></td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.region}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <button
                                                onClick={() => setRenewTarget({ reservationId: r.reservationId, orderId: r.orderId, name: r.name, renew: r.renew })}
                                                title={t('manageRenewal')}
                                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${r.renew ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                                            >
                                                <IconRefresh className="w-3.5 h-3.5" />
                                                {r.renew ? t('renewOn') : t('renewOff')}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-semibold whitespace-nowrap">{r.quantity}</td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap">
                                            <button
                                                onClick={() => setUtilTarget({ reservationId: r.reservationId, orderId: r.orderId, name: r.name })}
                                                title={t('viewUtilization')}
                                                className={`font-bold underline decoration-dotted underline-offset-2 cursor-pointer ${utilTextColor(r.utilizationLastDay)}`}
                                            >
                                                {r.utilizationLastDay === null ? t('na') : `${r.utilizationLastDay.toFixed(1)}%`}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap">
                                            <button
                                                onClick={() => setUtilTarget({ reservationId: r.reservationId, orderId: r.orderId, name: r.name })}
                                                title={t('viewUtilization')}
                                                className={`font-bold underline decoration-dotted underline-offset-2 cursor-pointer ${utilTextColor(r.utilizationLast7Days)}`}
                                            >
                                                {r.utilizationLast7Days === null ? t('na') : `${r.utilizationLast7Days.toFixed(1)}%`}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Oportunidades de Compra ───────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('recommendationsTitle')}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('recommendationsSubtitle')}</p>

                {metrics.recommendations.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        {t('recommendationsEmpty')}
                    </div>
                ) : (
                    <>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                            <thead className="bg-gray-50 dark:bg-slate-800/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('recColService')}</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('recColSku')}</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('recColTerm')}</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('recColQuantity')}</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('recColSavings')}</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-200 dark:divide-slate-800">
                                {metrics.recommendations.slice((page - 1) * pageSize, page * pageSize).map((rec: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{rec.type}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{rec.sku}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{rec.term}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-semibold">{rec.recommendedQuantity}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-400 font-bold text-right">{format(rec.monthlySavings)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {(() => {
                        const total = metrics.recommendations.length;
                        const totalPages = Math.max(1, Math.ceil(total / pageSize));
                        const safePage = Math.min(page, totalPages);
                        const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
                        const to = Math.min(safePage * pageSize, total);
                        return (
                            <div className="flex items-center justify-between mt-4 px-1 text-sm">
                                <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                                    <span>{t('paginationShowing', { from, to, total })}</span>
                                    <select
                                        value={pageSize}
                                        onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                                        className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-2 py-1 text-xs font-semibold cursor-pointer"
                                    >
                                        <option value={5}>{t('perPageOption', { n: 5 })}</option>
                                        <option value={10}>{t('perPageOption', { n: 10 })}</option>
                                        <option value={20}>{t('perPageOption', { n: 20 })}</option>
                                        <option value={50}>{t('perPageOption', { n: 50 })}</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={safePage <= 1}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    >
                                        <IconChevronLeft className="w-3.5 h-3.5" /> {t('paginationPrevious')}
                                    </button>
                                    <span className="text-gray-700 dark:text-gray-300 font-bold px-2">{t('paginationPageOf', { page: safePage, total: totalPages })}</span>
                                    <button
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                        disabled={safePage >= totalPages}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    >
                                        {t('paginationNext')} <IconChevronRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                    </>
                )}
            </div>

            {renewTarget && (
                <ReservationRenewalModal
                    tenantId={selectedTenant.id}
                    reservation={renewTarget}
                    authFetch={authFetch}
                    onClose={() => setRenewTarget(null)}
                    onUpdated={() => { void mutate(); }}
                />
            )}
            {utilTarget && (
                <ReservationUtilizationModal
                    tenantId={selectedTenant.id}
                    reservation={utilTarget}
                    authFetch={authFetch}
                    onClose={() => setUtilTarget(null)}
                />
            )}
        </div>
    );
}

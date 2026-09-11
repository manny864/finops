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
    IconRefresh
} from '@tabler/icons-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip
} from 'recharts';
import { useCurrency } from '@/components/CurrencyProvider';
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

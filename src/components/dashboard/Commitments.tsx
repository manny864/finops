"use client";
import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { useTranslations } from 'next-intl';
import { Loader2, TrendingUp, ShieldCheck, AlertCircle, ChevronLeft, ChevronRight, BookMarked, RefreshCw } from 'lucide-react';
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
            throw new Error(json.details || json.error || "Error al procesar la solicitud");
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
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Analizando Descuentos por Compromiso...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold">Error de Procesamiento</h3>
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
            { name: 'Utilizado', value: utilizationValue },
            { name: 'Desperdicio', value: 100 - utilizationValue }
          ]
        : [{ name: 'Sin datos', value: 100 }];

    const coverageColor = metrics.coverage >= 60 ? '#3B82F6' : '#6366F1';
    const coverageData = [
        { name: 'Cubierto por Reserva', value: metrics.coverage },
        { name: 'Pago por Uso (On-Demand)', value: 100 - metrics.coverage }
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
                                <ShieldCheck className="w-5 h-5 text-green-500" />
                                Utilización de Reservas
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Target &gt;80%. Porcentaje de la reserva pagada que realmente estás usando.</p>
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
                                <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center flex-col">
                            <span className="text-3xl font-black text-gray-900 dark:text-white" style={{ color: utilizationColor }}>
                                {utilizationKnown ? `${utilizationValue.toFixed(1)}%` : 'N/D'}
                            </span>
                        </div>
                    </div>
                    {!hasReservations ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-400 p-2 rounded text-sm">
                            <AlertCircle className="w-4 h-4" /> Sin reservas activas en este tenant.
                        </div>
                    ) : !utilizationKnown ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 p-2 rounded text-sm">
                            <AlertCircle className="w-4 h-4" /> Utilización no disponible: requiere permiso Billing Reader (EA/MCA).
                        </div>
                    ) : utilizationValue < 70 ? (
                        <div className="mt-2 w-full flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-2 rounded text-sm font-medium">
                            <AlertCircle className="w-4 h-4" /> Alerta: Estás perdiendo dinero en reservas ociosas.
                        </div>
                    ) : null}
                </div>

                {/* Cobertura */}
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col items-center">
                    <div className="w-full flex justify-between items-start mb-2">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-blue-500" />
                                Cobertura de Cómputo
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Porcentaje de infraestructura total corriendo bajo tarifas con descuento.</p>
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
                                <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
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
                    <BookMarked className="w-5 h-5 text-emerald-500" />
                    {t('reservasTitle')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    {t('reservasSubtitle')}
                </p>
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
                                                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                                                <span className="truncate max-w-[180px]" title={r.name}>{r.name}</span>
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
                                                <RefreshCw className="w-3.5 h-3.5" />
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
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Oportunidades de Compra</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Recomendaciones sugeridas por Azure basadas en tu consumo de los últimos 30 días.</p>

                {metrics.recommendations.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No hay recomendaciones de compra disponibles actualmente.
                    </div>
                ) : (
                    <>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                            <thead className="bg-gray-50 dark:bg-slate-800/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Servicio</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">SKU</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Plazo</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cantidad Sugerida</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ahorro Mensual</th>
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
                                    <span>Mostrando <strong className="text-gray-900 dark:text-white">{from}-{to}</strong> de <strong className="text-gray-900 dark:text-white">{total}</strong></span>
                                    <select
                                        value={pageSize}
                                        onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                                        className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-2 py-1 text-xs font-semibold cursor-pointer"
                                    >
                                        <option value={5}>5 / pág</option>
                                        <option value={10}>10 / pág</option>
                                        <option value={20}>20 / pág</option>
                                        <option value={50}>50 / pág</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={safePage <= 1}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                                    </button>
                                    <span className="text-gray-700 dark:text-gray-300 font-bold px-2">Página {safePage} de {totalPages}</span>
                                    <button
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                        disabled={safePage >= totalPages}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 font-semibold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    >
                                        Siguiente <ChevronRight className="w-3.5 h-3.5" />
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

"use client";
import React, { useEffect, useState } from 'react';
import { X, BarChart3, Loader2, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from 'recharts';
import { errorMessage } from '@/lib/apiErrors';

export interface UtilReservation {
    reservationId: string;
    orderId: string;
    name: string;
}

interface TrendData {
    aggregates: { oneDay: number | null; sevenDays: number | null; thirtyDays: number | null };
    trend: Array<{ date: string; utilization: number }>;
}

function utilColor(v: number | null): string {
    if (v === null) return '#9CA3AF';
    return v >= 80 ? '#10B981' : v >= 70 ? '#F59E0B' : '#EF4444';
}

export default function ReservationUtilizationModal({
    tenantId,
    reservation,
    authFetch,
    onClose,
}: {
    tenantId: string;
    reservation: UtilReservation;
    authFetch: (url: string, init?: RequestInit) => Promise<any>;
    onClose: () => void;
}) {
    const t = useTranslations('Commitments');
    const [data, setData] = useState<TrendData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const url = `/api/intelligence/commitments/reservations/utilization?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(reservation.orderId)}&reservationId=${encodeURIComponent(reservation.reservationId)}`;
                const json = await authFetch(url);
                if (!cancelled) setData(json.data as TrendData);
            } catch (e) {
                if (!cancelled) setError(errorMessage(e) || 'Error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [tenantId, reservation.orderId, reservation.reservationId, authFetch]);

    const fmtPct = (v: number | null) => (v === null ? t('na') : `${v.toFixed(1)}%`);

    const cards: Array<{ label: string; value: number | null }> = [
        { label: t('utilOneDay'), value: data?.aggregates.oneDay ?? null },
        { label: t('utilSevenDays'), value: data?.aggregates.sevenDays ?? null },
        { label: t('utilThirtyDays'), value: data?.aggregates.thirtyDays ?? null },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl p-6 border border-gray-200 dark:border-slate-700"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between mb-1">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-emerald-500" />
                        {t('utilTitle')}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 truncate" title={reservation.name}>
                    {t('utilSubtitle')} · <span className="font-medium text-gray-700 dark:text-gray-300">{reservation.name}</span>
                </p>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-16">
                        <Loader2 className="w-7 h-7 animate-spin text-emerald-500 mb-3" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('utilLoading')}</p>
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-3 mb-5">
                            {cards.map((c, i) => (
                                <div key={i} className="bg-gray-50 dark:bg-slate-800/60 rounded-lg p-3 text-center">
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{c.label}</div>
                                    <div className="text-2xl font-black" style={{ color: utilColor(c.value) }}>{fmtPct(c.value)}</div>
                                </div>
                            ))}
                        </div>

                        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('utilTrendTitle')}</div>
                        {data && data.trend.length > 0 ? (
                            <div className="h-56 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="utilGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                                                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" className="dark:stroke-slate-700" />
                                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" width={44} />
                                        <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                                        <Area type="monotone" dataKey="utilization" stroke="#10B981" strokeWidth={2} fill="url(#utilGrad)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 p-3 rounded text-sm">
                                <AlertCircle className="w-4 h-4 shrink-0" /> {t('utilNoTrend')}
                            </div>
                        )}
                    </>
                )}

                <div className="flex justify-end mt-5">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                        {t('close')}
                    </button>
                </div>
            </div>
        </div>
    );
}

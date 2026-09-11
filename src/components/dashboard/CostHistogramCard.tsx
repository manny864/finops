"use client";
import React, { useMemo, useState } from "react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import useSWR from "swr";
import {
    ComposedChart,
    Bar,
    Cell,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
} from "recharts";
import { BarChart3, AlertTriangle } from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import { aggregateHistogramByGranularity, type DailySpendHistogramPoint, type HistogramGranularity } from "@/lib/costProjection";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";

/**
 * Histograma de costos (distribución diaria del gasto) de la página
 * "Gastos y Proyección". Consume /api/intelligence/cost-projection, que trae
 * TODO el historial disponible en Azure Cost Management (hasta 13 meses,
 * CostSnapshots + backfill live) ya cacheado en Redis; el selector de rango
 * filtra client-side sin refetch. Continuidad de fechas, media móvil 7d y
 * detección de picos vienen calculadas por el backend (buildDailyHistogram).
 */
export default function CostHistogramCard() {
    const t = useProviderTranslations('Dashboard');
    const { format } = useCurrency();
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { instance, accounts } = useMsal();
    const [months, setMonths] = useState<number>(1);
    const [granularity, setGranularity] = useState<HistogramGranularity>("daily");

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.error || t("genericError"));
        }
        return res.json();
    };

    const subParam = selectedSubscription && selectedSubscription.toLowerCase() !== 'all'
        ? `&subscriptionId=${encodeURIComponent(selectedSubscription)}`
        : '';

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/intelligence/cost-projection?tenantId=${selectedTenant.id}${subParam}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const dailyHistory: DailySpendHistogramPoint[] = useMemo(
        () => (Array.isArray(data?.dailyHistory) ? data.dailyHistory : []),
        [data]
    );

    const filteredDaily = useMemo(() => {
        if (dailyHistory.length === 0) return [];
        const latest = new Date(`${dailyHistory[dailyHistory.length - 1].date}T00:00:00`);
        if (Number.isNaN(latest.getTime())) return dailyHistory;
        const start = new Date(latest);
        start.setMonth(start.getMonth() - months + 1);
        start.setDate(1);
        return dailyHistory.filter(point => {
            const d = new Date(`${point.date}T00:00:00`);
            return !Number.isNaN(d.getTime()) && d >= start && d <= latest;
        });
    }, [dailyHistory, months]);

    // Semanal/Mensual: se re-agrega el recorte ya filtrado — la media móvil,
    // el flag de fin de semana y los picos solo tienen sentido a granularidad
    // diaria, así que esas granularidades muestran barras simples de costo.
    const chartData = useMemo(() => {
        if (granularity === "daily") return filteredDaily;
        return aggregateHistogramByGranularity(filteredDaily, granularity);
    }, [filteredDaily, granularity]);

    const formatDate = (value: unknown) => {
        const raw = String(value || '').trim();
        const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dashed) return `${dashed[3]}/${dashed[2]}`;
        const monthOnly = raw.match(/^(\d{4})-(\d{2})$/);
        if (monthOnly) return `${monthOnly[2]}/${monthOnly[1].slice(2)}`;
        return '--/--';
    };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || payload.length === 0) return null;
        const point = payload[0]?.payload as Partial<DailySpendHistogramPoint> | undefined;
        return (
            <div className="rounded-lg border border-[var(--line)] bg-white dark:bg-slate-900 shadow-lg px-3 py-2 text-xs">
                <p className="font-semibold text-ink m-0 mb-1">{formatDate(label)}</p>
                <p className="m-0 text-ink-soft">{t('cost_histogram_cost_label')}: <span className="font-bold text-[var(--brand-deep)]">{format(Number(point?.cost || 0))}</span></p>
                {granularity === "daily" && typeof point?.movingAverage7d === "number" && (
                    <p className="m-0 text-ink-soft">{t('cost_histogram_moving_avg')}: {format(point.movingAverage7d)}</p>
                )}
                {granularity === "daily" && point?.isSpike && (
                    <p className="m-0 mt-1 text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {t('cost_histogram_spike_tooltip', { cost: format(Number(point?.cost || 0)), service: point?.spikeService || t('cost_histogram_spike_unknown_service') })}
                    </p>
                )}
            </div>
        );
    };

    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div className="card mb-4">
            <div className="card-h flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h3 className="m-0 text-[var(--brand-deep)] flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" /> {t('cost_histogram_title')}
                    </h3>
                    <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">{t('cost_histogram_desc')}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex rounded-md border border-[var(--line)] overflow-hidden text-xs">
                        {(["daily", "weekly", "monthly"] as HistogramGranularity[]).map((g) => (
                            <button
                                key={g}
                                type="button"
                                onClick={() => setGranularity(g)}
                                className={`px-2.5 py-1 font-medium transition-colors ${granularity === g ? "bg-[var(--brand-deep)] text-white" : "bg-white dark:bg-slate-900 text-ink-soft hover:bg-gray-50 dark:hover:bg-slate-800"}`}
                            >
                                {t(`cost_histogram_granularity_${g}`)}
                            </button>
                        ))}
                    </div>
                    <select
                        value={months}
                        onChange={(e) => setMonths(Number(e.target.value))}
                        className="border rounded-md px-2 py-1 text-sm bg-white dark:bg-slate-900"
                        aria-label={t('cost_histogram_range')}
                    >
                        <option value={1}>{t('cost_histogram_1m')}</option>
                        <option value={3}>{t('cost_histogram_nm', { months: 3 })}</option>
                        <option value={6}>{t('cost_histogram_nm', { months: 6 })}</option>
                        <option value={9}>{t('cost_histogram_nm', { months: 9 })}</option>
                        <option value={12}>{t('cost_histogram_12m')}</option>
                        <option value={13}>{t('cost_histogram_13m')}</option>
                    </select>
                </div>
            </div>
            <div className="p-[18px] h-[320px] min-w-0">
                {isLoading ? (
                    <div className="h-full flex items-center justify-center text-gray-400 animate-pulse">{t('cost_projection_calculating')}</div>
                ) : error || chartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-400 text-sm">{t('cost_histogram_empty')}</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                                dataKey="date"
                                tickFormatter={formatDate}
                                minTickGap={18}
                                tick={{ fontSize: 12 }}
                            />
                            <YAxis
                                tickFormatter={(v: number) => format(v, { compact: true })}
                                tick={{ fontSize: 12 }}
                            />
                            <RechartsTooltip content={<CustomTooltip {...TOOLTIP_TEMA} />} />
                            <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                                {chartData.map((entry: any, idx: number) => {
                                    const isSpike = granularity === "daily" && entry.isSpike;
                                    const isWeekend = granularity === "daily" && entry.isWeekend;
                                    const fill = isSpike ? "#f59e0b" : isWeekend ? "#00aeef66" : "#00aeef";
                                    return <Cell key={`cell-${idx}`} fill={fill} />;
                                })}
                            </Bar>
                            {granularity === "daily" && (
                                <Line type="monotone" dataKey="movingAverage7d" name={t('cost_histogram_moving_avg')} stroke="#7c3aed" strokeWidth={2} dot={false} />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}

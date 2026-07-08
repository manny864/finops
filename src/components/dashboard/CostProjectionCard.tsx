"use client";
import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { useCurrency } from "@/components/CurrencyProvider";
import { aggregateDailyToMonthly, projectFutureCosts } from "@/lib/costProjection";

interface Props {
    /** Serie diaria { date: 'YYYY-MM-DD', cost } — la misma que alimenta el histograma. */
    dailyHistory: { date: string; cost: number }[];
    loading?: boolean;
}

const MONTHS_AHEAD_OPTIONS = [3, 6, 12, 24] as const;

export default function CostProjectionCard({ dailyHistory, loading }: Props) {
    const t = useTranslations('Dashboard');
    const { format } = useCurrency();
    const [growthPct, setGrowthPct] = useState<number>(10);
    const [monthsAhead, setMonthsAhead] = useState<number>(12);

    const monthlyHistory = useMemo(() => aggregateDailyToMonthly(dailyHistory || []), [dailyHistory]);

    const result = useMemo(
        () => projectFutureCosts(monthlyHistory, growthPct, monthsAhead),
        [monthlyHistory, growthPct, monthsAhead]
    );

    const trailing12 = monthlyHistory.slice(-12);
    const chartData = useMemo(() => {
        const historyPoints = trailing12.map((p) => ({ month: p.month, real: p.cost, proyectado: null as number | null }));
        const projectionPoints = result.projection.map((p) => ({ month: p.month, real: null as number | null, proyectado: p.projectedCost }));
        // Conecta la línea real con la proyectada en el punto de empalme.
        if (historyPoints.length > 0 && projectionPoints.length > 0) {
            projectionPoints[0] = { ...projectionPoints[0], real: historyPoints[historyPoints.length - 1].real };
        }
        return [...historyPoints, ...projectionPoints];
    }, [trailing12, result]);

    const hasData = monthlyHistory.length > 0;

    return (
        <div className="card h-full flex flex-col overflow-hidden">
            <div className="card-h shrink-0 border-b-0 pb-0 flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h3 className="m-0 text-[var(--brand-deep)] flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" /> {t('cost_projection_title')}
                    </h3>
                    <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">
                        {t('cost_projection_desc', { months: result.monthsUsedForBase })}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-ink-soft flex items-center gap-1">
                        {t('cost_projection_annual_growth')}
                        <input
                            type="number"
                            value={growthPct}
                            onChange={(e) => setGrowthPct(Number(e.target.value))}
                            step={1}
                            min={-100}
                            max={500}
                            className="w-20 border rounded-md px-2 py-1 text-sm bg-white dark:bg-slate-900"
                            aria-label={t('cost_projection_annual_growth')}
                        />
                        %
                    </label>
                    <select
                        value={monthsAhead}
                        onChange={(e) => setMonthsAhead(Number(e.target.value))}
                        className="border rounded-md px-2 py-1 text-sm bg-white dark:bg-slate-900"
                        aria-label={t('cost_projection_months_ahead', { months: monthsAhead })}
                    >
                        {MONTHS_AHEAD_OPTIONS.map((m) => (
                            <option key={m} value={m}>{t('cost_projection_months_ahead', { months: m })}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="p-[18px] flex-1 overflow-hidden flex flex-col min-h-[280px]">
                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">{t('cost_projection_calculating')}</div>
                ) : !hasData ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                        {t('cost_projection_no_data')}
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-3 mb-3 shrink-0">
                            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] p-2.5">
                                <p className="text-[11px] text-ink-soft m-0">{t('cost_projection_avg_12m')}</p>
                                <p className="text-lg font-bold text-[var(--brand-deep)] m-0">{format(result.baseMonthlyAverage)}</p>
                            </div>
                            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] p-2.5">
                                <p className="text-[11px] text-ink-soft m-0">{t('cost_projection_monthly_rate')}</p>
                                <p className="text-lg font-bold text-[var(--brand-deep)] m-0">{result.monthlyGrowthRatePct.toFixed(2)}%</p>
                            </div>
                            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] p-2.5">
                                <p className="text-[11px] text-ink-soft m-0">{t('cost_projection_total', { months: monthsAhead })}</p>
                                <p className="text-lg font-bold text-[var(--brand)] m-0">{format(result.projectedTotal)}</p>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={14} />
                                    <YAxis tickFormatter={(v: number) => format(v, { compact: true })} tick={{ fontSize: 11 }} />
                                    <RechartsTooltip formatter={(value: any) => [value == null ? "—" : format(Number(value))]} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Line type="monotone" dataKey="real" name={t('cost_projection_real')} stroke="#0ea5e9" strokeWidth={2} dot={false} connectNulls={false} />
                                    <Line type="monotone" dataKey="proyectado" name={t('cost_projection_projected')} stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

"use client";
import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
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
import { TrendingUp, ExternalLink } from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import { projectFutureCosts, type MonthlyCostPoint } from "@/lib/costProjection";

interface Props {
    /** Muestra el link "Ver detalle completo" hacia /intelligence/cost-projection (default true). */
    showFullPageLink?: boolean;
}

const MONTHS_AHEAD_OPTIONS = [3, 6, 12, 24] as const;

export default function CostProjectionCard({ showFullPageLink = true }: Props) {
    const t = useTranslations('Dashboard');
    const { format } = useCurrency();
    const { locale } = useParams();
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { instance, accounts } = useMsal();
    const [growthPct, setGrowthPct] = useState<number>(10);
    const [monthsAhead, setMonthsAhead] = useState<number>(12);

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.error || "Error");
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

    const monthlyHistory: MonthlyCostPoint[] = data?.monthlyHistory || [];

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

    const loading = isLoading;
    const hasData = monthlyHistory.length > 0;

    if (!selectedTenant || selectedTenant.id === "default") return null;

    return (
        <div className="card h-full min-h-[460px] flex flex-col overflow-hidden">
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
                    {showFullPageLink && (
                        <Link
                            href={`/${locale}/intelligence/cost-projection`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline whitespace-nowrap"
                        >
                            {t('cost_projection_view_full')} <ExternalLink className="w-3 h-3" />
                        </Link>
                    )}
                </div>
            </div>
            <div className="p-[18px] flex-1 overflow-hidden flex flex-col min-h-[280px]">
                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">{t('cost_projection_calculating')}</div>
                ) : error ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                        {t('cost_projection_no_data')}
                    </div>
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
                        <div className="flex-1 min-h-[240px]">
                            <ResponsiveContainer width="100%" height="100%" minHeight={240}>
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

"use client";
import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
    ComposedChart,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import { TrendingUp, ExternalLink, Download, FlaskConical } from "lucide-react";
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
        const historyPoints = trailing12.map((p) => ({ month: p.month, real: p.cost, proyectado: null as number | null, band: undefined as [number, number] | undefined }));
        const projectionPoints = result.projection.map((p) => ({
            month: p.month,
            real: null as number | null,
            proyectado: p.projectedCost,
            band: [p.lowerBound, p.upperBound] as [number, number],
        }));
        // Conecta la línea real con la proyectada en el punto de empalme.
        if (historyPoints.length > 0 && projectionPoints.length > 0) {
            projectionPoints[0] = { ...projectionPoints[0], real: historyPoints[historyPoints.length - 1].real };
        }
        return [...historyPoints, ...projectionPoints];
    }, [trailing12, result]);

    const exportCsv = () => {
        const rows = [
            ["Mes", "Tipo", "Costo", "Límite Inferior (P10)", "Límite Superior (P90)"],
            ...trailing12.map((p) => [p.month, "Real", p.cost.toFixed(2), "", ""]),
            ...result.projection.map((p) => [p.month, "Proyectado", p.projectedCost.toFixed(2), p.lowerBound.toFixed(2), p.upperBound.toFixed(2)]),
        ];
        const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `proyeccion-gastos-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

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
                                <ComposedChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={14} />
                                    <YAxis tickFormatter={(v: number) => format(v, { compact: true })} tick={{ fontSize: 11 }} />
                                    <RechartsTooltip content={<ProjectionTooltip format={format} t={t} />} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Area dataKey="band" name={t('cost_projection_confidence_band')} stroke="none" fill="#f97316" fillOpacity={0.12} connectNulls={false} legendType="none" />
                                    <Line type="monotone" dataKey="real" name={t('cost_projection_real')} stroke="#00aeef" strokeWidth={2} dot={false} connectNulls={false} />
                                    <Line type="monotone" dataKey="proyectado" name={t('cost_projection_projected')} stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </>
                )}
            </div>
            {!loading && !error && hasData && !showFullPageLink && (
                <div className="shrink-0 px-[18px] pb-[18px] pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)]">
                    <button
                        onClick={exportCsv}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-[var(--line)] text-ink hover:bg-gray-50 dark:hover:bg-slate-800"
                    >
                        <Download className="w-3.5 h-3.5" /> {t('cost_projection_export_csv')}
                    </button>
                    <Link
                        href={`/${locale}/intelligence/simulator`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-[var(--brand-deep)] text-white hover:brightness-110"
                    >
                        <FlaskConical className="w-3.5 h-3.5" /> {t('cost_projection_simulate_whatif')} <ExternalLink className="w-3 h-3" />
                    </Link>
                </div>
            )}
        </div>
    );
}

function ProjectionTooltip({ active, payload, label, format, t }: any) {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0]?.payload;
    const hasBand = Array.isArray(point?.band);
    return (
        <div className="rounded-lg border border-[var(--line)] bg-white dark:bg-slate-900 shadow-lg px-3 py-2 text-xs">
            <p className="font-semibold text-ink m-0 mb-1">{label}</p>
            {point?.real != null && (
                <p className="m-0 text-ink-soft">{t('cost_projection_real')}: <span className="font-bold text-[#00aeef]">{format(Number(point.real))}</span></p>
            )}
            {point?.proyectado != null && (
                <p className="m-0 text-ink-soft">{t('cost_projection_projected')}: <span className="font-bold text-[#f97316]">{format(Number(point.proyectado))}</span></p>
            )}
            {hasBand && (
                <p className="m-0 text-ink-soft">{t('cost_projection_range')}: {format(Number(point.band[0]))} – {format(Number(point.band[1]))}</p>
            )}
        </div>
    );
}

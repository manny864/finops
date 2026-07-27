"use client";
import React, { useMemo, useState } from "react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import useSWR from "swr";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";

/**
 * Histograma de costos (distribución diaria del gasto) de la página
 * "Gastos y Proyección". Consume /api/intelligence/cost-projection, que trae
 * TODO el historial disponible en Azure Cost Management (hasta 13 meses,
 * CostSnapshots + backfill live) ya cacheado en Redis; el selector de rango
 * filtra client-side sin refetch.
 */
export default function CostHistogramCard() {
    const t = useProviderTranslations('Dashboard');
    const { format } = useCurrency();
    const { selectedTenant } = useTenant();
    const { selectedSubscription } = useSubscription();
    const { instance, accounts } = useMsal();
    const [months, setMonths] = useState<number>(1);

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

    const dailyHistory: Array<{ date: string; cost: number }> = useMemo(
        () => (Array.isArray(data?.dailyHistory) ? data.dailyHistory : []),
        [data]
    );

    const filtered = useMemo(() => {
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

    const formatDate = (value: unknown) => {
        const raw = String(value || '').trim();
        const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dashed) return `${dashed[3]}/${dashed[2]}`;
        return '--/--';
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
            <div className="p-[18px] h-[320px] min-w-0">
                {isLoading ? (
                    <div className="h-full flex items-center justify-center text-gray-400 animate-pulse">{t('cost_projection_calculating')}</div>
                ) : error || filtered.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-400 text-sm">{t('cost_histogram_empty')}</div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={filtered} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
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
                            <RechartsTooltip
                                formatter={(value: any) => [format(Number(value || 0)), t('cost_histogram_cost_label')]}
                                labelFormatter={(label: any) => formatDate(label)}
                            />
                            <Bar dataKey="cost" fill="#00aeef" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}

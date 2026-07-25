/**
 * @azure-only — cubre Azure Log Analytics, que no tiene equivalente en AWS.
 * ExecutiveSummaryBoard no lo renderiza cuando el proveedor activo es AWS.
 */
"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
import { ScrollText, Loader2, Zap } from 'lucide-react';

const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

const REC_COLOR: Record<string, string> = {
    'commitment-tier': '#0054A6',
    'reduce-retention': '#E08A1E',
    'set-daily-cap': '#E0556B',
    'ok': '#94a3b8',
};

export default function LogAnalyticsCard() {
    const t = useTranslations('LogAnalytics');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        if (!selectedTenant?.id || selectedTenant.id === 'default' || (accounts.length === 0 && !isMockTenant(selectedTenant.id))) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
            try {
                const idToken = await getFreshIdToken(instance, accounts[0], ['User.Read']);
                const res = await fetch(`/api/intelligence/log-analytics?tenantId=${selectedTenant.id}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                const json = await res.json();
                if (!cancelled) {
                    if (!res.ok) setError(json.error || t('no_access'));
                    else setData(json);
                }
            } catch (e: any) {
                if (!cancelled) setError(e?.message || 'Error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTenant?.id, accounts.length, instance, t]);

    const chartData = useMemo(() => {
        const rows: any[] = data?.workspaces || [];
        return rows
            .map((r) => ({ name: r.name, cost: Number(r.monthlyCost) || 0, rec: r.recommendation }))
            .filter((r) => r.cost > 0)
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 6);
    }, [data]);

    const totalCost = Number(data?.totalMonthlyCost) || 0;
    const totalSaving = Number(data?.totalPotentialSaving) || 0;

    return (
        <div className="drag-handle cursor-move bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-4 flex flex-col h-full overflow-auto">
            <div className="flex items-center gap-2 mb-1">
                <ScrollText className="w-5 h-5 text-brand-deep" />
                <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('title')}</h3>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center min-h-[160px]">
                    <Loader2 className="w-6 h-6 animate-spin text-brand-deep" />
                </div>
            ) : error ? (
                <div className="flex-1 flex items-center justify-center min-h-[160px]">
                    <p className="text-xs text-red-500 text-center">{error}</p>
                </div>
            ) : data?.empty || chartData.length === 0 ? (
                <div className="flex-1 flex items-center justify-center min-h-[160px]">
                    <p className="text-sm text-gray-400 text-center">{t('empty')}</p>
                </div>
            ) : (
                <>
                    <div className="flex items-baseline gap-3 mb-1">
                        <span className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{fmt(totalCost)}</span>
                        <span className="text-[11px] text-slate-400">{t('per_month')}</span>
                    </div>
                    {totalSaving > 0 && (
                        <p className="text-[12px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mb-2">
                            <Zap className="w-3.5 h-3.5" />
                            {t('savings_hint', { amount: fmt(totalSaving) })}
                        </p>
                    )}
                    <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8 }}>
                            <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                            <RechartsTooltip formatter={(v: any) => [fmt(Number(v)), t('cost')]} />
                            <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                                {chartData.map((row, idx) => (
                                    <Cell key={idx} fill={REC_COLOR[row.rec] || REC_COLOR.ok} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </>
            )}
        </div>
    );
}

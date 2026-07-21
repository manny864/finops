"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { ShieldAlert, Loader2 } from 'lucide-react';
import PinButton from '@/components/dashboard/PinButton';

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#ec4899', '#64748b', '#84cc16'];

function shortType(t: string): string {
    if (!t) return 'Otro';
    const seg = t.split('/').pop() || t;
    return seg
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, c => c.toUpperCase());
}

export default function HABreakdownCard() {
    const t = useTranslations('WhiteBoard');
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        if (!selectedTenant?.id || selectedTenant.id === 'default' || accounts.length === 0) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
            try {
                const idToken = await getFreshIdToken(instance, accounts[0], ['User.Read']);
                const res = await fetch(`/api/governance/ha?tenantId=${selectedTenant.id}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                const json = await res.json();
                if (!cancelled) setData(json);
            } catch (e: any) {
                if (!cancelled) setError(e?.message || 'Error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTenant?.id, accounts.length]);

    const chartData = useMemo(() => {
        const items: any[] = data?.items || [];
        const byType: Record<string, number> = {};
        items.forEach(it => {
            const k = shortType(it.resourceType);
            byType[k] = (byType[k] || 0) + 1;
        });
        return Object.entries(byType)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [data]);

    const total = chartData.reduce((s, d) => s + d.value, 0);

    return (
        <div className="card h-full flex flex-col overflow-hidden">
            <div className="card-h shrink-0 border-b-0 pb-0">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="w-5 h-5 text-amber-500" />
                        <h3 className="m-0 text-[var(--brand-deep)]">{t('ha_title')}</h3>
                    </div>
                    <PinButton widgetKey="governance.ha-breakdown" compact />
                </div>
                <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">
                    {total > 0 ? t('ha_resources_at_risk', { count: total }) : t('ha_no_resources_at_risk')}
                </p>
            </div>
            <div className="p-[18px] flex-1 overflow-hidden flex items-center justify-center min-h-[220px]">
                {loading ? (
                    <Loader2 className="w-6 h-6 animate-spin text-brand-deep" />
                ) : error ? (
                    <p className="text-xs text-red-500 text-center">{error}</p>
                ) : chartData.length === 0 ? (
                    <p className="text-sm text-gray-400">{t('ha_no_data')}</p>
                ) : (
                    <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                        <PieChart>
                            <Pie
                                data={chartData}
                                cx="50%"
                                cy="50%"
                                innerRadius="45%"
                                outerRadius="75%"
                                paddingAngle={2}
                                dataKey="value"
                                nameKey="name"
                            >
                                {chartData.map((_, idx) => (
                                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                                ))}
                            </Pie>
                            <RechartsTooltip formatter={(v: any, n: any) => [`${v} ${t('ha_tooltip_resources')}`, n]} />
                            <Legend
                                verticalAlign="bottom"
                                height={36}
                                wrapperStyle={{ fontSize: 11 }}
                                formatter={(v) => <span className="text-gray-600 dark:text-gray-300">{v}</span>}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}

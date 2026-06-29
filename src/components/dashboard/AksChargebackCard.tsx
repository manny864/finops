"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Server, Loader2 } from 'lucide-react';
import PinButton from '@/components/dashboard/PinButton';

const COLORS = ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#84cc16'];

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

export default function AksChargebackCard() {
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
                const res = await fetch(`/api/intelligence/aks-chargeback?tenantId=${selectedTenant.id}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                const json = await res.json();
                if (!cancelled) {
                    if (!res.ok) setError(json.error || 'Sin acceso');
                    else setData(json);
                }
            } catch (e: any) {
                if (!cancelled) setError(e?.message || 'Error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTenant?.id, accounts.length]);

    const chartData = useMemo(() => {
        const rows: any[] = data?.chargebackData || [];
        return rows
            .map((r: any) => ({ name: r.namespace || r.name || 'unknown', value: Number(r.cost || r.totalCost || r.value || 0) }))
            .filter(r => r.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);
    }, [data]);

    const total = chartData.reduce((s, d) => s + d.value, 0);

    return (
        <div className="card h-full flex flex-col overflow-hidden">
            <div className="card-h shrink-0 border-b-0 pb-0">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Server className="w-5 h-5 text-cyan-500" />
                        <h3 className="m-0 text-[var(--brand-deep)]">AKS Chargeback</h3>
                    </div>
                    <PinButton widgetKey="intelligence.aks-chargeback" compact />
                </div>
                <p className="text-[13px] text-ink-soft m-0 mt-1 font-normal">
                    {total > 0 ? `${fmt(total)} / mes — top namespaces` : 'Sin datos de chargeback'}
                </p>
            </div>
            <div className="p-[18px] flex-1 overflow-hidden flex items-center justify-center min-h-[220px]">
                {loading ? (
                    <Loader2 className="w-6 h-6 animate-spin text-brand-deep" />
                ) : error ? (
                    <p className="text-xs text-red-500 text-center">{error}</p>
                ) : chartData.length === 0 ? (
                    <p className="text-sm text-gray-400">Sin clusters AKS detectados</p>
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
                            <RechartsTooltip formatter={(v: any, n: any) => [fmt(Number(v)), n]} />
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

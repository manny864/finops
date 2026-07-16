"use client";
/**
 * Gráfico de gasto mensual + línea de presupuesto, equivalente al "View
 * Monthly Cost Data" que Azure Cost Management muestra dentro de cada
 * Budget: una barra por mes con el gasto real y una línea de referencia
 * horizontal en el monto del presupuesto.
 */
import React from 'react';
import { useTranslations } from 'next-intl';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ReferenceLine } from 'recharts';

export interface BudgetMonthlyChartPoint {
    /** "YYYY-MM" */
    month: string;
    cost: number;
}

interface BudgetMonthlyChartProps {
    data: BudgetMonthlyChartPoint[];
    budgetAmount: number;
    loading?: boolean;
    height?: number;
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function formatMonthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return month;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
}

export default function BudgetMonthlyChart({ data, budgetAmount, loading, height = 140 }: BudgetMonthlyChartProps) {
    const t = useTranslations('Budgets');

    if (loading) {
        return (
            <div className="flex items-center justify-center text-xs text-gray-400 animate-pulse" style={{ height }}>
                {t('monthlyChartLoading', { fallback: 'Cargando historial mensual...' })}
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center text-xs text-gray-400 text-center px-2" style={{ height }}>
                {t('monthlyChartEmpty', { fallback: 'Sin historial de gasto mensual disponible' })}
            </div>
        );
    }

    const chartData = data.map((d) => ({ ...d, label: formatMonthLabel(d.month) }));

    return (
        <div style={{ height }} className="-ml-2">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                    <YAxis hide domain={[0, (max: number) => Math.max(max, budgetAmount) * 1.15]} />
                    <Tooltip
                        wrapperStyle={{ zIndex: 9999 }}
                        content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const point = payload[0].payload as { month: string; cost: number; label: string };
                            const over = budgetAmount > 0 && point.cost > budgetAmount;
                            return (
                                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg shadow-lg border border-gray-100 dark:border-slate-700">
                                    <p className="font-bold text-xs text-gray-800 dark:text-gray-100 mb-1">{point.month}</p>
                                    <p className="text-[11px] text-gray-600 dark:text-gray-300">
                                        {t('monthlyChartSpend', { fallback: 'Gasto' })}: <span className={`font-bold ${over ? 'text-red-500' : 'text-gray-800 dark:text-gray-100'}`}>{fmt.format(point.cost)}</span>
                                    </p>
                                </div>
                            );
                        }}
                        cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                    />
                    {budgetAmount > 0 && (
                        <ReferenceLine
                            y={budgetAmount}
                            stroke="#0d9488"
                            strokeDasharray="4 4"
                            strokeWidth={1.5}
                            label={{ value: t('monthlyChartBudgetLine', { fallback: 'Presupuesto' }), position: 'insideTopRight', fill: '#0d9488', fontSize: 10, fontWeight: 700 }}
                        />
                    )}
                    <Bar dataKey="cost" radius={[3, 3, 0, 0]} barSize={18}>
                        {chartData.map((entry, index) => {
                            const over = budgetAmount > 0 && entry.cost > budgetAmount;
                            return <Cell key={`cell-${index}`} fill={over ? '#ef4444' : '#3b82f6'} />;
                        })}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

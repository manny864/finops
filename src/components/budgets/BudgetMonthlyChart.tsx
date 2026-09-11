"use client";
/**
 * Gráfico de gasto mensual + línea de presupuesto, equivalente al "View
 * Monthly Cost Data" que Azure Cost Management muestra dentro de cada
 * Budget: una barra por mes con el gasto real y una línea de referencia
 * horizontal en el monto del presupuesto.
 */
import React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ReferenceLine } from 'recharts';
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";

export interface BudgetMonthlyChartPoint {
    /** "YYYY-MM" */
    month: string;
    cost: number;
}

interface BudgetMonthlyChartProps {
    data: BudgetMonthlyChartPoint[];
    budgetAmount: number;
    forecastedSpend?: number;
    loading?: boolean;
    height?: number;
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatMonthLabel(month: string, locale: string): string {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return month;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }).replace('.', '');
}

export default function BudgetMonthlyChart({ data, budgetAmount, forecastedSpend, loading, height = 140 }: BudgetMonthlyChartProps) {
    const t = useTranslations('Budgets');
    const locale = useLocale();

    if (loading) {
        return (
            <div className="flex items-center justify-center text-xs text-gray-400 animate-pulse" style={{ height }}>
                {t('monthlyChartLoading')}
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center text-xs text-gray-400 text-center px-2" style={{ height }}>
                {t('monthlyChartEmpty')}
            </div>
        );
    }

    const chartData = data.map((d, idx) => ({
        ...d,
        label: formatMonthLabel(d.month, locale),
        isCurrent: idx === data.length - 1,
    }));

    return (
        <div style={{ height }} className="-ml-2">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                    <YAxis hide domain={[0, (max: number) => Math.max(max, budgetAmount, forecastedSpend || 0) * 1.15]} />
                    <Tooltip
                        wrapperStyle={{ zIndex: 9999 }}
                        content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const point = payload[0].payload as { month: string; cost: number; label: string; isCurrent: boolean };
                            const over = budgetAmount > 0 && point.cost > budgetAmount;
                            const willExceed = point.isCurrent && forecastedSpend !== undefined && budgetAmount > 0 && forecastedSpend > budgetAmount;
                            return (
                                <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg shadow-lg border border-gray-100 dark:border-slate-700 text-xs">
                                    <p className="font-bold text-gray-800 dark:text-gray-100 mb-1">{point.month} {point.isCurrent ? `(${t('current_month')})` : ''}</p>
                                    <p className="text-[11px] text-gray-600 dark:text-gray-300">
                                        {t('monthlyChartSpend')}: <span className={`font-bold ${over ? 'text-red-500' : 'text-gray-800 dark:text-gray-100'}`}>{fmt.format(point.cost)}</span>
                                    </p>
                                    {point.isCurrent && forecastedSpend !== undefined && forecastedSpend > 0 && (
                                        <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">
                                            {t('projected_month_end')}: <span className={`font-bold ${willExceed ? 'text-amber-500' : 'text-[#0054A6] dark:text-blue-400'}`}>{fmt.format(forecastedSpend)}</span>
                                        </p>
                                    )}
                                    {budgetAmount > 0 && (
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 border-t border-slate-100 dark:border-slate-700 pt-0.5">
                                            {t('monthlyChartBudgetLine')}: {fmt.format(budgetAmount)}
                                        </p>
                                    )}
                                </div>
                            );
                        }}
                        cursor={{ fill: 'rgba(0,0,0,0.03)' }} {...TOOLTIP_TEMA} />
                    {budgetAmount > 0 && (
                        <ReferenceLine
                            y={budgetAmount}
                            stroke="#0d9488"
                            strokeDasharray="4 4"
                            strokeWidth={1.5}
                            label={{ value: t('monthlyChartBudgetLine'), position: 'insideTopRight', fill: '#0d9488', fontSize: 10, fontWeight: 700 }}
                        />
                    )}
                    <Bar dataKey="cost" radius={[3, 3, 0, 0]} barSize={18}>
                        {chartData.map((entry, index) => {
                            const over = budgetAmount > 0 && entry.cost > budgetAmount;
                            const isCurrent = entry.isCurrent;
                            const willExceed = isCurrent && forecastedSpend !== undefined && budgetAmount > 0 && forecastedSpend > budgetAmount;
                            const fillColor = over ? '#ef4444' : willExceed ? '#f59e0b' : '#0054a6';
                            return <Cell key={`cell-${index}`} fill={fillColor} />;
                        })}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

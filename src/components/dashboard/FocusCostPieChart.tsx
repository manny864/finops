"use client";
import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Sector } from 'recharts';
import { FocusCostEntry } from '@/modules/core/focusMapper';
import { useSubscription } from '../SubscriptionProvider';

export default function FocusCostPieChart({ data, onSegmentClick }: { data: FocusCostEntry[], onSegmentClick?: (category: string | null) => void }) {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const { subscriptions } = useSubscription();

    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <svg className="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                <p className="font-medium">Aún no hay datos de costos para graficar.</p>
            </div>
        );
    }

    // Group by SubAccountId for "Spend by Subscription"
    const grouped = data.reduce((acc: any, item: FocusCostEntry) => {
        const key = item.SubAccountId || 'Unallocated';
        if (!acc[key]) acc[key] = { cost: 0 };
        acc[key].cost += item.EffectiveCost;
        return acc;
    }, {});

    const chartData = Object.keys(grouped).map(key => {
        const sub = subscriptions.find(s => s.id.toLowerCase() === key.toLowerCase());
        return {
            name: sub ? sub.name : key,
            cost: Number(grouped[key].cost.toFixed(2))
        };
    }).filter(d => d.cost > 0).sort((a,b) => b.cost - a.cost);

    const COLORS = ['#0054A6', '#F2A900', '#10B981', '#EF4444', '#8B5CF6', '#F43F5E', '#0EA5E9', '#F59E0B', '#64748B', '#0D9488'];

    if (chartData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <p className="font-medium">No se registraron costos facturables.</p>
            </div>
        );
    }

    const handleClick = (entry: any, index: number) => {
        if (activeIndex === index) {
            setActiveIndex(null);
            if (onSegmentClick) onSegmentClick(null);
        } else {
            setActiveIndex(index);
            if (onSegmentClick) onSegmentClick(entry.name);
        }
    };

    const renderActiveShape = (props: any) => {
      const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
      return (
        <g>
          <Sector
            cx={cx}
            cy={cy}
            innerRadius={innerRadius}
            outerRadius={outerRadius + 6}
            startAngle={startAngle}
            endAngle={endAngle}
            fill={fill}
          />
        </g>
      );
    };

    return (
        <div className="flex flex-col h-full w-full">
            <div className="h-40 w-full shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            // @ts-ignore
                            activeIndex={activeIndex !== null ? activeIndex : undefined}
                            activeShape={renderActiveShape}
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={65}
                            paddingAngle={5}
                            dataKey="cost"
                            stroke="none"
                            onClick={handleClick}
                            className="cursor-pointer focus:outline-none"
                        >
                            {chartData.map((entry, index) => (
                                <Cell 
                                    key={`cell-${index}`} 
                                    fill={COLORS[index % COLORS.length]} 
                                    opacity={activeIndex === null || activeIndex === index ? 1 : 0.3}
                                />
                            ))}
                        </Pie>
                        <Tooltip 
                            formatter={(value: any, name: any) => {
                                return [`$${value} USD`, name];
                            }}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="flex-1 overflow-y-auto mt-2 px-2 custom-scrollbar">
                <div className="flex flex-col gap-1.5">
                    {chartData.map((item, i) => (
                        <div key={i} className="flex justify-between items-center text-[11px] bg-slate-50 p-1.5 rounded">
                            <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                                <span className="text-slate-600 font-bold truncate max-w-[120px]" title={item.name}>{item.name}</span>
                            </div>
                            <span className="font-extrabold text-slate-800">${item.cost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

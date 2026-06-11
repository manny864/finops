"use client";
import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Sector } from 'recharts';

export default function CostPieChart({ data, onSegmentClick }: { data: any[], onSegmentClick?: (category: string | null) => void }) {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);

    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <svg className="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                <p className="font-medium">Aún no hay datos de costos para graficar.</p>
            </div>
        );
    }

    const grouped = data.reduce((acc: any, item: any) => {
        if (item.issueType !== 'cost' || item.potentialSavings <= 0) return acc;
        if (!acc[item.type]) acc[item.type] = { count: 0, savings: 0 };
        acc[item.type].count += 1;
        acc[item.type].savings += item.potentialSavings;
        return acc;
    }, {});

    const chartData = Object.keys(grouped).map(key => ({
        name: key,
        count: grouped[key].count,
        savings: Number(grouped[key].savings.toFixed(2))
    })).filter(d => d.count > 0).sort((a,b) => b.count - a.count);

    const COLORS = ['#0054A6', '#F2A900', '#10B981', '#EF4444', '#8B5CF6', '#F43F5E', '#0EA5E9', '#F59E0B'];

    if (chartData.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <p className="font-medium">El entorno está 100% optimizado en costos.</p>
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
            outerRadius={outerRadius + 8}
            startAngle={startAngle}
            endAngle={endAngle}
            fill={fill}
          />
        </g>
      );
    };

    return (
        <div className="w-full min-h-[350px] relative overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        // @ts-ignore
                        activeIndex={activeIndex !== null ? activeIndex : undefined}
                        activeShape={renderActiveShape}
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={5}
                        dataKey="savings"
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
                        formatter={(value: any, name: any, props: any) => {
                            const recursos = props.payload?.count ?? props.payload?.payload?.count ?? 0;
                            return [`$${value} USD (${recursos} recursos detectados)`, name];
                        }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', fontWeight: 600, paddingTop: '10px' }} />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}

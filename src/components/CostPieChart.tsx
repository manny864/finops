"use client";
import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector } from "recharts";
import { useCurrency } from "@/components/CurrencyProvider";
import { IconDropletDollar } from "@tabler/icons-react";
import { useChartTheme } from "@/lib/chartTheme";

export interface CostPieChartProps {
    data: any[];
    onSegmentClick?: (category: string | null) => void;
    selectedCategory?: string | null;
}

const BLUE_PALETTE = [
    "#0078D4", // Azul corporativo profundo
    "#2563EB", // Azul cobalto
    "#0284C7", // Azul cian intermedio
    "#38BDF8", // Azul cielo suave
    "#93C5FD", // Azul hielo
    "#60A5FA", // Azul cielo brillante
    "#3B82F6", // Azul real
    "#94A3B8", // Slate azulado
];

export default function CostPieChart({ data, onSegmentClick, selectedCategory }: CostPieChartProps) {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [mounted, setMounted] = useState(false);
    const { format } = useCurrency();
    const chart = useChartTheme();

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <IconDropletDollar className="w-10 h-10 mb-2 text-[#0078D4] opacity-50 stroke-[1.5]" />
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Aún no hay datos de costos para graficar.</p>
            </div>
        );
    }

    // Aggregate cost data
    const grouped = data.reduce((acc: any, item: any) => {
        if (item.issueType !== "cost" || !(item.potentialSavings > 0)) return acc;
        const key = item.type || "Otros";
        if (!acc[key]) acc[key] = { count: 0, savings: 0, estimated: 0 };
        acc[key].count += 1;
        acc[key].savings += item.potentialSavings;
        // `savingsSource` distingue el costo medido por Cost Management de la línea
        // base por tipo de recurso (ver MEJ-10). El donut agrega ambos, así que hay
        // que decir cuánto de la cifra es estimación.
        if (item.savingsSource !== "cost_management") acc[key].estimated += 1;
        return acc;
    }, {});

    const chartData = Object.keys(grouped)
        .map((key) => ({
            name: key,
            count: grouped[key].count,
            savings: Number(grouped[key].savings.toFixed(2)),
            estimated: grouped[key].estimated,
        }))
        .filter((d) => d.count > 0)
        .sort((a, b) => b.savings - a.savings);

    if (chartData.length === 0) {
        // Fugas sin costo directo asociado (gobernanza): recursos sin etiquetas
        // FinOps, NICs/NSGs huerfanos, grupos de recursos vacios. No suman dolares
        // pero SI son hallazgos, y la tabla de abajo los lista: declarar "100%
        // optimizado" con la tabla llena era una contradiccion en la misma pantalla.
        const governanceCount = data.filter(
            (item: any) => item.issueType === "governance" && item.type !== "__skip__"
        ).length;

        if (governanceCount > 0) {
            return (
                <div className="flex flex-col items-center justify-center h-64 text-center px-6">
                    <IconDropletDollar className="w-10 h-10 mb-2 text-[#0078D4] dark:text-[#38BDF8] stroke-[1.5]" />
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Sin fugas con costo directo facturado.
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 max-w-xs">
                        Hay <strong className="text-[#0078D4] dark:text-[#38BDF8]">{governanceCount}</strong>{" "}
                        {governanceCount === 1 ? "hallazgo" : "hallazgos"} de gobernanza sin costo directo
                        (etiquetado, recursos huérfanos sin cargo propio). Se listan en la tabla de recursos
                        afectados.
                    </p>
                </div>
            );
        }

        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <IconDropletDollar className="w-10 h-10 mb-2 text-[#0078D4] dark:text-[#38BDF8] stroke-[1.5]" />
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Sin fugas detectadas en este alcance.
                </p>
            </div>
        );
    }

    const handleClick = (entry: any, index: number) => {
        if (activeIndex === index || selectedCategory === entry.name) {
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
                    innerRadius={innerRadius - 2}
                    outerRadius={outerRadius + 6}
                    startAngle={startAngle}
                    endAngle={endAngle}
                    fill={fill}
                />
            </g>
        );
    };

    // Custom Tooltip adhering strictly to #1B2A41 standard
    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const item = payload[0].payload;
            return (
                <div
                    style={{ backgroundColor: "#1B2A41" }}
                    className="p-3 text-white text-[11px] font-normal leading-relaxed rounded-xl border border-slate-600 shadow-2xl z-[99999]"
                >
                    <p className="font-bold text-white text-xs mb-1">{item.name}</p>
                    <div className="flex items-center justify-between gap-4 text-slate-300">
                        <span>Recursos Afectados:</span>
                        <span className="font-bold text-white">{item.count}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-slate-300 mt-1">
                        <span>Fuga Mensual:</span>
                        <span className="font-bold text-sky-400">{format(item.savings)}/mes</span>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="w-full h-full min-h-[220px] min-w-0 relative overflow-hidden flex-1 flex flex-col items-center">
            <div className="h-44 w-full shrink-0">
                {!mounted ? (
                    <div className="h-full w-full" />
                ) : (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={140}>
                        <PieChart>
                            <Pie
                                // @ts-expect-error
                                activeIndex={
                                    selectedCategory
                                        ? chartData.findIndex((d) => d.name === selectedCategory)
                                        : activeIndex !== null
                                        ? activeIndex
                                        : undefined
                                }
                                activeShape={renderActiveShape}
                                data={chartData}
                                cx="50%"
                                cy="50%"
                                innerRadius={42}
                                outerRadius={68}
                                paddingAngle={4}
                                dataKey="savings"
                                stroke="none"
                                onClick={handleClick}
                                className="cursor-pointer focus:outline-none"
                                // MEJ-02: antes deshabilitada siempre (ver useChartTheme).
                                isAnimationActive={chart.animate}
                            >
                                {chartData.map((entry, index) => {
                                    const isSelected =
                                        selectedCategory === entry.name ||
                                        (selectedCategory === null && activeIndex === index);
                                    return (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={BLUE_PALETTE[index % BLUE_PALETTE.length]}
                                            opacity={
                                                selectedCategory
                                                    ? isSelected
                                                        ? 1
                                                        : 0.35
                                                    : activeIndex === null || activeIndex === index
                                                    ? 1
                                                    : 0.35
                                            }
                                        />
                                    );
                                })}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                )}
            </div>

            <div className="flex-1 w-full overflow-y-auto mt-2 px-1 max-h-[160px] custom-scrollbar">
                <div className="flex flex-col gap-1.5">
                    {chartData.map((item, i) => {
                        const isSelected = selectedCategory === item.name;
                        return (
                            <button
                                key={i}
                                type="button"
                                onClick={() => handleClick(item, i)}
                                className={`flex justify-between items-center text-[11px] p-2 rounded-lg border text-left transition-all cursor-pointer ${
                                    isSelected
                                        ? "bg-blue-50/80 dark:bg-blue-950/40 border-[#0078D4] text-[#0078D4] font-bold"
                                        : "bg-slate-50/70 dark:bg-slate-800/40 border-slate-200/70 dark:border-slate-700/60 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300"
                                }`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <div
                                        className="w-2.5 h-2.5 rounded-full shadow-xs shrink-0"
                                        style={{ backgroundColor: BLUE_PALETTE[i % BLUE_PALETTE.length] }}
                                    />
                                    <span className="truncate max-w-[170px]">{item.name}</span>
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">({item.count})</span>
                                    {item.estimated > 0 && (
                                        <span
                                            className="text-[9px] font-bold text-amber-600 dark:text-amber-400 shrink-0"
                                            title={`${item.estimated} de ${item.count} con costo estimado por tipo de recurso (Azure no reporta cargo directo medido).`}
                                        >
                                            est.
                                        </span>
                                    )}
                                </div>
                                <span className="font-extrabold text-[#1B2A41] dark:text-slate-100 shrink-0 ml-2">
                                    {format(item.savings)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

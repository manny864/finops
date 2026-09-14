"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { IconTrendingUp } from "@tabler/icons-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useCurrency } from "@/components/CurrencyProvider";
import { formatCurrencyAxis } from "@/lib/whiteboard";
import type { WhiteboardCostTrendPoint } from "@/types/whiteboard.types";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";

export default function WhiteboardForecastWidget({
  costTrend,
  forecastEomUSD,
}: {
  costTrend: WhiteboardCostTrendPoint[];
  forecastEomUSD: number;
}) {
  const t = useTranslations("WhiteBoard");
  const { format } = useCurrency();
  const [growthRate, setGrowthRate] = useState(5);

  if (!costTrend || costTrend.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
        <IconTrendingUp className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        <p className="text-xs">{t("no_forecast_data")}</p>
      </div>
    );
  }

  // Proyección de ESCENARIO, no un pronóstico: se toma el último mes real y se
  // lo capitaliza al crecimiento que elige el usuario (`lastValue * (1+g)^i`).
  // Sirve para responder "¿y si crecemos 5% por mes?", no para decir qué va a
  // facturar Azure -- ese número es el KPI de arriba, que sale del forecast de
  // Cost Management. La tarjeta se llamaba "ML Forecast" y no hay ningún modelo
  // acá: el título ahora dice "escenario".
  // Generate 12-month projection from last actual point
  const lastPoint = costTrend[costTrend.length - 1];
  const lastValue = lastPoint?.actualCostUSD || 0;
  const projectionData = costTrend.map((p) => ({
    month: p.month,
    actual: p.actualCostUSD,
    projected: null as number | null,
  }));

  const lastMonthDate = new Date(lastPoint.month + "-01");
  for (let i = 1; i <= 12; i++) {
    const nextDate = new Date(lastMonthDate);
    nextDate.setMonth(nextDate.getMonth() + i);
    const monthLabel = nextDate.toISOString().slice(0, 7);
    const projectedValue = lastValue * Math.pow(1 + growthRate / 100, i);
    projectionData.push({
      month: monthLabel,
      actual: null as unknown as number,
      projected: Number(projectedValue.toFixed(2)),
    });
  }

  const allValues = projectionData.flatMap((d) => [
    d.actual ?? 0,
    d.projected ?? 0,
  ]);
  const maxVal = Math.max(...allValues, 1);

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {t("forecast_eom")}:{" "}
          <strong className="text-[#1B2A41] dark:text-white">
            {format(forecastEomUSD)}
          </strong>
        </p>
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-slate-400">
            {t("growth_rate")}:
          </label>
          <select
            value={growthRate}
            onChange={(e) => setGrowthRate(Number(e.target.value))}
            className="text-[10px] border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
          >
            {[0, 2, 5, 8, 10, 15].map((r) => (
              <option key={r} value={r}>
                {r}%
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%" minHeight={120}>
          <AreaChart data={projectionData}>
            <defs>
              <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0078D4" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#0078D4" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient
                id="projectionGrad"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor="#00AEEF" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#00AEEF" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => formatCurrencyAxis(Number(v), maxVal)}
              width={52}
            />
            <Tooltip formatter={(v: any) => format(Number(v))} {...TOOLTIP_TEMA} />
            {/*
              * `isAnimationActive={false}` es lo que saca el temblor (MEJ-02).
              *
              * La animación de Recharts corre sobre requestAnimationFrame y
              * arranca de cero en CADA render. Esta tarjeta vive dentro del grid
              * del Resumen Ejecutivo, que re-renderiza seguido --refrescos de
              * datos, resize del layout, el propio ResponsiveContainer midiendo--,
              * así que la animación se reiniciaba constantemente y el área
              * parpadeaba sin parar. El widget de servicios de al lado ya lo
              * tenía apagado y por eso se ve quieto.
              */}
            <Area
              type="monotone"
              dataKey="actual"
              stroke="#0078D4"
              strokeWidth={2}
              fill="url(#forecastGrad)"
              name={t("actual_cost")}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="projected"
              stroke="#00AEEF"
              strokeWidth={2}
              strokeDasharray="5 5"
              fill="url(#projectionGrad)"
              name={t("projected_cost")}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
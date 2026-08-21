"use client";

import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { IconChartBar, IconArrowRight } from "@tabler/icons-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useCurrency } from "@/components/CurrencyProvider";
import { formatCurrencyAxis } from "@/lib/whiteboard";
import type { WhiteboardTopService } from "@/types/whiteboard.types";

const BAR_COLORS = ["#0078D4", "#2563EB", "#0284C7", "#38BDF8"];

export default function WhiteboardTopServicesWidget({
  topServices,
}: {
  topServices: WhiteboardTopService[];
}) {
  const t = useTranslations("WhiteBoard");
  const locale = useLocale();
  const { format } = useCurrency();

  if (!topServices || topServices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
        <IconChartBar className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        <p className="text-xs">{t("no_services_data")}</p>
      </div>
    );
  }

  const chartData = topServices.map((s) => ({
    name: s.serviceName,
    cost: s.monthlyCostUSD,
    share: s.sharePercentage,
  }));
  const maxCost = Math.max(...chartData.map((d) => d.cost), 1);

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%" minHeight={140}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ left: 8, right: 16 }}
          >
            <XAxis
              type="number"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => formatCurrencyAxis(Number(v), maxCost)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10 }}
              width={110}
            />
            <Tooltip
              formatter={(v: any) => format(Number(v))}
              labelFormatter={(label: any) =>
                typeof label === "string" && label.length > 40
                  ? label.slice(0, 40) + "…"
                  : String(label ?? "")
              }
            />
            <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Link
        href={`/${locale}/intelligence/cost-analysis`}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] hover:text-[#0054A6] transition-colors"
      >
        {t("view_all_services")}
        <IconArrowRight className="w-3 h-3" stroke={2} />
      </Link>
    </div>
  );
}
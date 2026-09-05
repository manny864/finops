"use client";

import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { IconChartBar, IconPlus, IconArrowRight } from "@tabler/icons-react";
import { useCurrency } from "@/components/CurrencyProvider";
import type { WhiteboardBudgetEntry } from "@/types/whiteboard.types";

export default function WhiteboardBudgetWidget({
  budgets,
}: {
  budgets: WhiteboardBudgetEntry[];
}) {
  const t = useTranslations("WhiteBoard");
  const locale = useLocale();
  const { format } = useCurrency();

  if (!budgets || budgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 p-4">
        <IconChartBar className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        <p className="text-xs text-center text-slate-500">{t("no_budgets")}</p>
        <Link
          href={`/${locale}/intelligence/budgets`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all shadow-xs cursor-pointer"
        >
          <IconPlus className="w-3.5 h-3.5" stroke={2} />
          + {t("configure_budget")}
        </Link>
      </div>
    );
  }

  const maxPct = Math.max(...budgets.map((b) => b.percentageUsed), 100);

  return (
    <div className="space-y-4 h-full flex flex-col justify-between">
      <div className="space-y-3 overflow-auto flex-1">
        {budgets.slice(0, 4).map((item) => {
          const isOverBudget = item.percentageUsed >= 100;
          const barColor = isOverBudget ? "#EF4444" : "#0078D4";
          return (
            <div key={item.costCenterName} className="p-2.5 rounded-lg bg-slate-50/50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
              <div className="flex justify-between items-baseline gap-2 mb-1.5">
                <span className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 truncate flex-1">
                  {item.costCenterName}
                </span>
                <span className="text-[11px] text-slate-500 shrink-0">
                  {format(item.currentSpendUSD)} / {format(item.allocatedBudgetUSD)}
                </span>
              </div>
              <div className="relative h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min((item.percentageUsed / maxPct) * 100, 100)}%`,
                    backgroundColor: barColor,
                  }}
                />
              </div>
              <div className="flex justify-between items-center mt-1 text-[10px] text-slate-400">
                <span>{isOverBudget ? "Excedido" : "En rango"}</span>
                <span className={isOverBudget ? "text-red-500 font-bold" : "text-slate-600 dark:text-slate-300 font-semibold"}>
                  {item.percentageUsed.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <Link
          href={`/${locale}/intelligence/budgets`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] hover:text-[#0054A6] transition-colors"
        >
          {t("manageBudgets")}
          <IconArrowRight className="w-3 h-3" stroke={2} />
        </Link>
      </div>
    </div>
  );
}
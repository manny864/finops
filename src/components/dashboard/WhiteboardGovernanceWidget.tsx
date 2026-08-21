"use client";

import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { IconArrowRight } from "@tabler/icons-react";
import { useCurrency } from "@/components/CurrencyProvider";

export default function WhiteboardGovernanceWidget({
  tagCoveragePct,
  untaggedResourcesCount,
  unallocatedCostUSD,
}: {
  tagCoveragePct: number;
  untaggedResourcesCount: number;
  unallocatedCostUSD: number;
}) {
  const t = useTranslations("WhiteBoard");
  const locale = useLocale();
  const { format } = useCurrency();

  const coverage = Math.min(100, Math.max(0, tagCoveragePct));
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (coverage / 100) * circumference;

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Circular gauge */}
      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="#E2E8F0"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="#0078D4"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-extrabold text-[#1B2A41] dark:text-white">
              {coverage.toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200">
            {t("tag_coverage")}
          </p>
          <p className="text-[11px] text-slate-500">
            {t("untagged_summary", {
              count: untaggedResourcesCount,
              amount: format(unallocatedCostUSD),
            })}
          </p>
        </div>
      </div>

      {/* Detail rows */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">{t("untagged_resources_count")}</span>
          <strong className="text-[#1B2A41] dark:text-slate-200">
            {untaggedResourcesCount}
          </strong>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">{t("unallocated_cost")}</span>
          <strong className="text-[#1B2A41] dark:text-slate-200">
            {format(unallocatedCostUSD)}
          </strong>
        </div>
      </div>

      <Link
        href={`/${locale}/governance/tags`}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] hover:text-[#0054A6] transition-colors mt-auto"
      >
        {t("go_to_tag_governance")}
        <IconArrowRight className="w-3 h-3" stroke={2} />
      </Link>
    </div>
  );
}
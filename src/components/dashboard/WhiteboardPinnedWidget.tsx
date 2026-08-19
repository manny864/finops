"use client";

import React from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import {
  IconChartBar,
  IconLoader2,
  IconShieldCheck,
  IconSparkles,
  IconTags,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import type { WhiteboardExecutivePayload } from "@/types/whiteboard.types";

export type WhiteboardWidgetKind =
  | "budgets"
  | "forecast"
  | "services"
  | "governance"
  | "advisor"
  | "quick-wins";

const ICONS = {
  budgets: IconChartBar,
  forecast: IconTrendingUp,
  services: IconChartBar,
  governance: IconTags,
  advisor: IconShieldCheck,
  "quick-wins": IconSparkles,
};

export default function WhiteboardPinnedWidget({ kind }: { kind: WhiteboardWidgetKind }) {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const { format } = useCurrency();
  const locale = useLocale();
  const t = useTranslations("WhiteBoard");
  const tenantId = selectedTenant?.id;
  const isDemo = Boolean(tenantId && isMockTenant(tenantId));
  const apiUrl = tenantId && tenantId !== "default" && (isDemo || accounts[0])
    ? `/api/overview/whiteboard?tenantId=${encodeURIComponent(tenantId)}&locale=${locale}${isDemo ? "&mock=true" : ""}`
    : null;
  const { data, isLoading } = useSWR<WhiteboardExecutivePayload>(apiUrl, async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isDemo) headers.Authorization = `Bearer ${await getFreshIdToken(instance, accounts[0])}`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, { revalidateOnFocus: false });
  const Icon = ICONS[kind];

  if (isLoading) return <div className="flex h-32 items-center justify-center"><IconLoader2 className="h-5 w-5 animate-spin text-[#0078D4]" /></div>;
  if (!data) return <p className="p-4 text-sm text-slate-500">{t("no_data")}</p>;

  return (
    <div className="space-y-3 p-2">
      <Icon className="h-5 w-5 text-[#0078D4]" stroke={1.5} />
      {kind === "budgets" && data.budgets.slice(0, 3).map((item) => (
        <div key={item.costCenterName}><div className="flex justify-between gap-2 text-xs"><span>{item.costCenterName}</span><span>{item.percentageUsed.toFixed(0)}%</span></div><div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-full rounded bg-[#0078D4]" style={{ width: `${Math.min(item.percentageUsed, 100)}%` }} /></div></div>
      ))}
      {kind === "forecast" && <><p className="text-xs text-slate-500">{t("forecast_eom")}</p><p className="text-2xl font-bold text-[#1B2A41] dark:text-white">{format(data.summary.forecastEomUSD)}</p></>}
      {kind === "services" && data.topServices.slice(0, 4).map((item) => <div key={item.serviceName} className="flex justify-between gap-2 text-xs"><span className="truncate">{item.serviceName}</span><strong>{format(item.monthlyCostUSD)}</strong></div>)}
      {kind === "governance" && <><p className="text-2xl font-bold text-[#1B2A41] dark:text-white">{data.tagCoveragePct.toFixed(1)}%</p><p className="text-xs text-slate-500">{t("untagged_summary", { count: data.untaggedResourcesCount, amount: format(data.unallocatedCostUSD) })}</p></>}
      {kind === "advisor" && Object.entries(data.advisorPillars).map(([pillar, count]) => <div key={pillar} className="flex justify-between text-xs capitalize"><span>{pillar}</span><strong className="text-[#0078D4]">{count}</strong></div>)}
      {kind === "quick-wins" && data.quickWins.slice(0, 3).map((item) => <div key={item.id} className="border-b border-slate-100 pb-2 text-xs last:border-0"><p className="font-semibold text-[#1B2A41] dark:text-white">{item.title}</p><p className="text-slate-500">{format(item.estimatedMonthlySavingsUSD)}/mes</p></div>)}
    </div>
  );
}

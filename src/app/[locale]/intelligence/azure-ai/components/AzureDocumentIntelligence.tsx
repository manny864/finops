"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import useSWR from "swr";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  IconAlertCircle,
  IconArrowsSort,
  IconCash,
  IconChevronLeft,
  IconChevronRight,
  IconClockPlay,
  IconCpu,
  IconExternalLink,
  IconFileText,
  IconFilter,
  IconLoader2,
  IconRotateClockwise,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";
import { useTextoPorCategoria } from "@/lib/recommendationText";
import type {
  DocIntelligencePayload,
  DocIntelligenceRemediationAction,
  DocIntelligenceResource,
} from "@/types/azureDocumentIntelligence.types";

const PAGE_SIZES = [15, 30, 45, 60] as const;
const MODEL_COLORS = ["#0078D4", "#2563EB", "#0284C7", "#38BDF8", "#94A3B8"];

function compactNumber(value: number, locale: string): string {
  if (value >= 1000) return `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString(locale);
}

function Kpi({ icon: Icon, title, value, detail, tooltip }: { icon: React.ElementType; title: string; value: string; detail: string; tooltip: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Icon className="h-5 w-5 bg-transparent text-[#0078D4]" stroke={1.5} /><span className="text-[11px] font-semibold uppercase text-slate-500">{title}</span></div><InfoTooltip content={tooltip} /></div>
      <p className="mt-3 text-2xl font-bold text-[#1B2A41] dark:text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

function EmptyState({ refresh }: { refresh: () => void }) {
  const t = useTranslations("AzureAI");
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
      <IconFileText className="mx-auto h-12 w-12 bg-transparent text-[#0078D4]" stroke={1.5} />
      <h2 className="mt-3 text-base font-semibold text-[#1B2A41] dark:text-white">{t("doc_empty_title")}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{t("doc_empty_description")}</p>
      <div className="mx-auto mt-5 grid max-w-3xl gap-3 text-left md:grid-cols-3">
        {["doc_empty_step_1", "doc_empty_step_2", "doc_empty_step_3"].map((key, index) => <div key={key} className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300"><strong className="text-[#0078D4]">{index + 1}.</strong> {t(key)}</div>)}
      </div>
      <button type="button" onClick={refresh} className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] bg-white px-4 py-2 text-sm font-semibold text-[#0054A6] dark:text-blue-400 hover:bg-blue-50 dark:bg-slate-900"><IconRotateClockwise className="h-4 w-4" /> {t("btn_sync")}</button>
    </div>
  );
}

function OptimizationModal({ action, onClose }: { action: DocIntelligenceRemediationAction; onClose: () => void }) {
  const t = useTranslations("AzureAI");
  const { format } = useCurrency();
  const textoRem = useTextoPorCategoria("AzureAI", "DOC");
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-950"><div className="flex items-center gap-2"><IconSparkles className="h-5 w-5 text-[#0078D4]" /><h3 className="font-semibold text-[#1B2A41] dark:text-white">{textoRem(action, "title")}</h3></div><button onClick={onClose} aria-label={t("close")} className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 dark:bg-slate-900"><IconX className="h-4 w-4" /></button></div>
          <div className="space-y-4 p-5"><p className="text-sm text-slate-600 dark:text-slate-300">{textoRem(action, "desc")}</p><div className="grid grid-cols-2 gap-3"><div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] uppercase text-slate-500">{t("doc_estimated_savings")}</p><p className="mt-1 font-semibold text-[#1B2A41] dark:text-white">{t("doc_savings_month", { amount: format(action.estimatedSavingsUSD) })}</p></div><div className="rounded-lg border border-slate-200 p-3"><p className="text-[10px] uppercase text-slate-500">{t("doc_confidence")}</p><p className="mt-1 font-semibold text-[#1B2A41] dark:text-white">{action.confidence === "HIGH" ? t("highConfidence") : t("mediumConfidence")}</p></div></div>{action.commandPayload ? <pre className="overflow-x-auto rounded-lg bg-[#1B2A41] p-4 text-xs text-white">{action.commandPayload}</pre> : null}</div>
        </div>
      </div>
    </>
  );
}

export default function AzureDocumentIntelligence() {
  const t = useTranslations("AzureAI");
  const textoRem = useTextoPorCategoria("AzureAI", "DOC");
  const locale = t("locale_code");
  const searchParams = useSearchParams();
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const { format } = useCurrency();
  const tenantId = selectedTenant?.id || "";
  const forceMock = searchParams.get("mock") === "true";
  const mockMode = forceMock || isMockTenant(tenantId);
  const [days, setDays] = useState<number | "mtd">("mtd");
  const [modelFilter, setModelFilter] = useState("all");
  const [rgFilter, setRgFilter] = useState("all");
  const [subscriptionFilter, setSubscriptionFilter] = useState("all");
  const [sortKey, setSortKey] = useState<keyof DocIntelligenceResource>("totalCostUSD");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(15);
  const [selectedAction, setSelectedAction] = useState<DocIntelligenceRemediationAction | null>(null);

  const apiUrl = tenantId ? `/api/intelligence/azure-ai/document-intelligence?tenantId=${encodeURIComponent(tenantId)}&days=${days}${forceMock ? "&mock=true" : ""}` : null;
  const fetcher = async (url: string) => {
    const headers: Record<string, string> = {};
    if (!mockMode) {
      const account = accounts[0];
      if (!account) throw new Error(t("doc_no_session"));
      headers.Authorization = `Bearer ${await getFreshIdToken(instance, account)}`;
    }
    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    return response.json() as Promise<DocIntelligencePayload>;
  };
  const { data, error, isLoading, isValidating, mutate } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });
  const refresh = () => mutate();

  const resources = useMemo(() => data?.resources || [], [data?.resources]);
  const modelTypes = useMemo(() => Array.from(new Set(resources.map((resource) => resource.primaryModelType))).sort(), [resources]);
  const resourceGroups = useMemo(() => Array.from(new Set(resources.map((resource) => resource.resourceGroup))).sort(), [resources]);
  const subscriptions = useMemo(() => Array.from(new Set(resources.map((resource) => resource.subscriptionName))).sort(), [resources]);
  const filtered = useMemo(() => {
    const rows = resources.filter((resource) => (modelFilter === "all" || resource.primaryModelType === modelFilter) && (rgFilter === "all" || resource.resourceGroup === rgFilter) && (subscriptionFilter === "all" || resource.subscriptionName === subscriptionFilter));
    return rows.sort((left, right) => {
      const a = left[sortKey]; const b = right[sortKey];
      const comparison = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [resources, modelFilter, rgFilter, subscriptionFilter, sortKey, sortDirection]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const handleSort = (key: keyof DocIntelligenceResource) => { if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDirection("desc"); } setPage(0); };

  if (isLoading) return <div className="flex h-72 items-center justify-center"><IconLoader2 className="h-7 w-7 animate-spin text-[#0078D4]" /></div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-white p-5 text-red-700 dark:bg-slate-900"><div className="flex items-center gap-2 font-semibold"><IconAlertCircle className="h-5 w-5" /> {t("doc_load_error")}</div><p className="mt-1 text-sm">{error.message}</p></div>;
  if (!data || (data.source !== "mock" && data.resources.length === 0)) return <EmptyState refresh={refresh} />;

  const summary = data.summary;
  const avgDaily = data.dailyProcessing.length > 0 ? summary.totalPages / data.dailyProcessing.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><IconFileText className="h-5 w-5 text-[#0078D4]" stroke={1.5} /><h2 className="text-lg font-semibold text-[#1B2A41] dark:text-white">{t("tab_document_intelligence")}</h2><span className="rounded border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-slate-900">{t("status_ready")}</span></div><div className="flex flex-wrap gap-2"><div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:bg-slate-900">{(["mtd", 30, 90] as const).map((range) => <button key={range} onClick={() => setDays(range)} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${days === range ? "bg-blue-50 text-[#0054A6]" : "text-slate-500"}`}>{range === "mtd" ? "MTD" : `${range}D`}</button>)}</div><button onClick={refresh} disabled={isValidating} className="inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] bg-white px-3 py-1.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 dark:bg-slate-900"><IconRotateClockwise className={`h-4 w-4 ${isValidating ? "animate-spin" : ""}`} /> {t("btn_sync")}</button><Link href="https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts" target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-[#00AEEF] bg-white px-3 py-1.5 text-xs font-semibold text-[#00AEEF] dark:bg-slate-900"><IconExternalLink className="h-4 w-4" /> Azure Portal</Link></div></div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><Kpi icon={IconCash} title={t("doc_kpi_cost")} value={format(summary.totalCostUSD)} detail={`${t("doc_forecast")}: ${format(summary.forecastEomUSD || 0)}`} tooltip={t("doc_kpi_cost_tooltip")} /><Kpi icon={IconFileText} title={t("doc_kpi_pages")} value={compactNumber(summary.totalPages, locale)} detail={`${compactNumber(avgDaily, locale)} ${t("doc_pages_daily")}`} tooltip={t("doc_kpi_pages_tooltip")} /><Kpi icon={IconCpu} title={t("doc_kpi_ratio")} value={`${summary.prebuiltSharePercentage.toFixed(1)}% / ${summary.customSharePercentage.toFixed(1)}%`} detail={t("doc_prebuilt_custom")} tooltip={t("doc_kpi_ratio_tooltip")} /><Kpi icon={IconClockPlay} title={t("doc_kpi_training")} value={`${(summary.totalTrainingHours || 0).toFixed(1)} h`} detail={format(summary.totalTrainingCostUSD || 0)} tooltip={t("doc_kpi_training_tooltip")} /></div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="mb-4 flex items-center gap-2"><IconCpu className="h-5 w-5 text-[#0078D4]" /><h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">{t("doc_distribution_title")}</h3><InfoTooltip content={t("doc_distribution_tooltip")} /></div><div className="h-72"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={summary.breakdownByModel} dataKey="pagesCount" nameKey="modelName" innerRadius={60} outerRadius={105} paddingAngle={2}>{summary.breakdownByModel.map((entry, index) => <Cell key={entry.modelName} fill={entry.color || MODEL_COLORS[index % MODEL_COLORS.length]} />)}</Pie><RechartsTooltip formatter={(value, _name, item) => [t("doc_pages_cost", { pages: Number(value), cost: format(Number(item.payload.costUSD || 0)) }), item.payload.modelName]} {...TOOLTIP_TEMA} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></section><section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="mb-4 flex items-center gap-2"><IconFileText className="h-5 w-5 text-[#0078D4]" /><h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">{t("doc_daily_title")}</h3><InfoTooltip content={t("doc_daily_tooltip")} /></div><div className="h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.dailyProcessing}><defs><linearGradient id="docPagesGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0078D4" stopOpacity={0.35} /><stop offset="95%" stopColor="#0078D4" stopOpacity={0.03} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><RechartsTooltip formatter={(value) => Number(value).toLocaleString(locale)} {...TOOLTIP_TEMA} /><Area type="monotone" dataKey="pages" name={t("doc_pages")} stroke="#0078D4" strokeWidth={2} fill="url(#docPagesGradient)" /></AreaChart></ResponsiveContainer></div></section></div>

      <div className="flex flex-wrap items-center gap-3"><IconFilter className="h-4 w-4 text-[#0078D4]" /><select value={modelFilter} onChange={(event) => { setModelFilter(event.target.value); setPage(0); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:bg-slate-900"><option value="all">{t("doc_all_models")}</option>{modelTypes.map((model) => <option key={model} value={model}>{model}</option>)}</select><select value={rgFilter} onChange={(event) => { setRgFilter(event.target.value); setPage(0); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:bg-slate-900"><option value="all">{t("doc_all_groups")}</option>{resourceGroups.map((group) => <option key={group} value={group}>{group}</option>)}</select><select value={subscriptionFilter} onChange={(event) => { setSubscriptionFilter(event.target.value); setPage(0); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:bg-slate-900"><option value="all">{t("doc_all_subscriptions")}</option>{subscriptions.map((subscription) => <option key={subscription} value={subscription}>{subscription}</option>)}</select></div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="overflow-x-auto"><table className="w-full table-fixed text-xs"><thead><tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40"><ResizableTh className="cursor-pointer px-3 py-2.5 text-left" onClick={() => handleSort("name")}>{t("resource_name")} <IconArrowsSort className="inline h-3 w-3" /></ResizableTh><ResizableTh className="px-3 py-2.5 text-left">{t("doc_primary_model")}</ResizableTh><ResizableTh className="cursor-pointer px-3 py-2.5 text-right" onClick={() => handleSort("totalPagesProcessed")}>{t("doc_pages_mtd")}</ResizableTh><ResizableTh className="cursor-pointer px-3 py-2.5 text-right" onClick={() => handleSort("trainingHours")}>{t("doc_training_hours")}</ResizableTh><ResizableTh className="px-3 py-2.5 text-left">{t("resource_group")}</ResizableTh><ResizableTh className="px-3 py-2.5 text-left">{t("doc_subscription")}</ResizableTh><ResizableTh className="cursor-pointer px-3 py-2.5 text-right" onClick={() => handleSort("totalCostUSD")}>{t("current_cost_mtd")}</ResizableTh><ResizableTh className="px-3 py-2.5 text-center">{t("doc_actions")}</ResizableTh></tr></thead><tbody>{paged.map((resource) => { const action = data.remediationActions.find((item) => item.resourceId === resource.id) || data.remediationActions.find((item) => item.resourceId === "all"); return <tr key={resource.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/30"><td className="px-3 py-3"><div className="flex items-center gap-2"><IconFileText className="h-4 w-4 shrink-0 text-[#0078D4]" /><span className="truncate font-medium text-[#1B2A41] dark:text-white">{resource.name}</span><span className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-slate-900">{resource.skuName}</span></div><p className="ml-6 mt-0.5 text-[10px] text-slate-400">{resource.location}</p></td><td className="truncate px-3 py-3">{resource.primaryModelType}</td><td className="px-3 py-3 text-right font-mono">{resource.totalPagesProcessed.toLocaleString(locale)}</td><td className="px-3 py-3 text-right font-mono">{resource.trainingHours.toFixed(1)} h</td><td className="truncate px-3 py-3">{resource.resourceGroup}</td><td className="truncate px-3 py-3">{resource.subscriptionName}</td><td className="px-3 py-3 text-right font-mono font-semibold">{format(resource.totalCostUSD)}</td><td className="px-3 py-3 text-center">{action ? <button onClick={() => setSelectedAction(action)} className="inline-flex items-center gap-1 rounded-lg border border-[#0054A6] bg-white px-2 py-1 text-[11px] font-semibold text-[#0054A6] dark:text-blue-400 dark:bg-slate-900"><IconSparkles className="h-3 w-3" /> {t("doc_optimize")}</button> : "—"}</td></tr>; })}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-800"><div className="flex items-center gap-2 text-xs text-slate-500"><span>{t("doc_show")}</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="rounded border border-slate-200 bg-white px-2 py-1 dark:bg-slate-900">{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></div><div className="flex items-center gap-2"><button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} className="rounded p-1 disabled:opacity-30"><IconChevronLeft className="h-4 w-4" /></button><span className="text-xs text-slate-500">{page + 1} / {totalPages}</span><button onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page >= totalPages - 1} className="rounded p-1 disabled:opacity-30"><IconChevronRight className="h-4 w-4" /></button></div></div></div>

      {data.remediationActions.length > 0 ? <section><div className="mb-3 flex items-center gap-2"><IconSparkles className="h-5 w-5 text-[#0078D4]" /><h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">{t("doc_recommendations")}</h3></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{data.remediationActions.map((action) => <article key={action.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><IconSparkles className="h-5 w-5 text-[#0078D4]" /><h4 className="mt-2 text-sm font-semibold text-[#1B2A41] dark:text-white">{textoRem(action, "title")}</h4><p className="mt-1 line-clamp-3 text-xs text-slate-500">{textoRem(action, "desc")}</p><div className="mt-3 flex items-end justify-between gap-2"><div><span className="text-[10px] uppercase text-slate-400">{t("doc_estimated_savings")}</span><p className="font-semibold text-[#1B2A41] dark:text-white">{format(action.estimatedSavingsUSD)}</p></div><button onClick={() => setSelectedAction(action)} className="rounded-lg border border-[#0054A6] bg-white px-3 py-1.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 dark:bg-slate-900">{t("doc_optimize")}</button></div></article>)}</div></section> : null}
      {selectedAction ? <OptimizationModal action={selectedAction} onClose={() => setSelectedAction(null)} /> : null}
    </div>
  );
}

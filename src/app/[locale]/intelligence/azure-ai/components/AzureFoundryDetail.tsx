"use client";
import { useTranslations } from "next-intl";

/**
 * AzureFoundryDetail — Dedicated "Azure Foundry" sub-tab.
 *
 * Layout:
 *   1. Header: billing latency banner + time range selector + refresh button
 *   2. 5 KPI cards (Requests, Tokens, Cost, Input Tokens, Output Tokens)
 *   3. Row 1: Cost trend chart (left) + Token trend chart (right)
 *   4. Row 2: Cost by Model (left) + Token Distribution by Model (right)
 *   5. Row 3: Cost by Application (left) + Cost by Team / Showback (right)
 *
 * Design: Tabler Icons only, blue corporate (#0078D4), no icon backgrounds.
 * NO duplicate "Progreso de costo MTD" chart at the bottom.
 */

import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import {
  IconActivity,
  IconCpu,
  IconCash,
  IconArrowDownRight,
  IconArrowUpRight,
  IconRotateClockwise,
  IconChartArea,
  IconChartLine,
  IconBulb,
  IconAlertTriangle,
  IconLoader2,
  IconExclamationCircle,
  IconInfoCircle,
  IconSearch,
  IconTag,
  IconSparkles,
} from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import type {
  FoundryDetailPayload,
  FoundryModelUsageItem,
  FoundryApplicationConsumer,
  FoundryRemediationAction,
} from "@/types/azureAiFoundry.types";

// ── Formatters ──────────────────────────────────────────────────────────────

const fmtUSD = (v: string | number): string => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtCompact = (n: number): string => {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
};

const fmtNum = (n: number): string => n.toLocaleString("es-ES");

// ── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  tooltip?: string;
}) {
  const t = useTranslations("AzureAI");
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {label}
        </span>
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className="flex items-center gap-2.5">
        <Icon className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
        <span className="text-xl font-bold text-[#1B2A41] dark:text-white">{value}</span>
      </div>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

// ── Model Bar Row ───────────────────────────────────────────────────────────

function ModelBarRow({ item, maxCost }: { item: FoundryModelUsageItem; maxCost: number }) {
  const t = useTranslations("AzureAI");
  const costNum = parseFloat(item.totalCostUSD) || 0;
  const pct = maxCost > 0 ? (costNum / maxCost) * 100 : 0;

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 truncate">
            {item.modelName}
          </span>
          <span className="text-[10px] text-slate-400 shrink-0">{item.skuTier}</span>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          <span className="font-semibold text-[#1B2A41] dark:text-slate-200">
            {fmtUSD(item.totalCostUSD)}
          </span>
          <span className="text-slate-400">{item.percentageOfSpend.toFixed(1)}%</span>
        </div>
      </div>
      <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-[#0078D4] transition-all duration-500"
          style={{ width: Math.min(pct, 100) + "%" }}
        />
      </div>
      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
        <span>In: {fmtCompact(item.inputTokens)}</span>
        <span>Out: {fmtCompact(item.outputTokens)}</span>
        <span>$/1K: {fmtUSD(item.costPer1kTokensUSD)}</span>
      </div>
    </div>
  );
}

// ── Application Row ─────────────────────────────────────────────────────────

function AppRow({ app, maxCost }: { app: FoundryApplicationConsumer; maxCost: number }) {
  const t = useTranslations("AzureAI");
  const costNum = parseFloat(app.totalCostUSD) || 0;
  const pct = maxCost > 0 ? (costNum / maxCost) * 100 : 0;

  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#1B2A41] dark:text-slate-200 truncate">
            {app.appDisplayName}
          </span>
          {!app.hasCostCenter && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
              {t("foundry_noTag")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-slate-400">{app.modelUsed}</span>
          <span className="text-[10px] text-slate-400">{app.requestsCount} reqs</span>
        </div>
        <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full mt-1.5 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#0078D4]"
            style={{ width: Math.min(pct, 100) + "%" }}
          />
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-bold text-[#1B2A41] dark:text-white">{fmtUSD(app.totalCostUSD)}</p>
        <p className="text-[10px] text-slate-400">{app.percentageOfSpend.toFixed(1)}%</p>
      </div>
    </div>
  );
}

// ── Remediation Card ────────────────────────────────────────────────────────

function RemediationCard({ action }: { action: FoundryRemediationAction }) {
  const t = useTranslations("AzureAI");
  const catColors: Record<string, string> = {
    PTU_ARBITRAGE: "border-l-[#0078D4]",
    PROMPT_CACHING: "border-l-[#2563EB]",
    MODEL_DOWNGRADE: "border-l-[#0284C7]",
    IDLE_DEPLOYMENT: "border-l-amber-400",
    TAG_SHOWBACK: "border-l-slate-400",
  };

  return (
    <div
      className={
        "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 border-l-4 " +
        (catColors[action.category] || "border-l-[#0078D4]")
      }
    >
      <div className="flex items-start gap-2">
        <IconBulb className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-semibold text-[#1B2A41] dark:text-white">{action.title}</h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
            {action.description}
          </p>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-slate-400">{action.category.replace(/_/g, " ")}</span>
            {parseFloat(action.estimatedSavingsUSD) > 0 && (
              <span className="text-xs font-bold text-green-600">
                {fmtUSD(action.estimatedSavingsUSD)}/mo
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function AzureFoundryDetail() {
  const t = useTranslations("AzureAI");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const searchParams = useSearchParams();
  const tenantId = selectedTenant?.id;
  const forceMock = searchParams.get("mock") === "true";
  const isMock = forceMock || (tenantId ? isMockTenant(tenantId) : false);
  const [days, setDays] = useState<number | "mtd">(30);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const apiUrl = tenantId
    ? `/api/intelligence/azure-ai/foundry/detail?tenantId=${encodeURIComponent(tenantId)}&days=${days}${forceMock ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    apiUrl,
    async (url: string) => {
      if (isMock) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load Foundry data");
        return res.json() as Promise<FoundryDetailPayload>;
      }
      const token = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error("Failed to load Foundry data");
      return res.json() as Promise<FoundryDetailPayload>;
    }
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await mutate();
    setIsRefreshing(false);
  };

  // ── Loading ───────────────────────────────────────────────────────────
  // Extract data early so hooks always run (rules-of-hooks)
  const metrics = data?.metrics;
  const modelUsage = useMemo(() => data?.modelUsage || [], [data?.modelUsage]);
  const applicationConsumers = useMemo(
    () => data?.applicationConsumers || [],
    [data?.applicationConsumers]
  );
  const timeSeries = useMemo(() => data?.timeSeries || [], [data?.timeSeries]);
  const remediationActions = data?.remediationActions || [];

  const chartData = useMemo(() => timeSeries, [timeSeries]);
  const maxModelCost = useMemo(
    () => Math.max(...modelUsage.map((m: FoundryModelUsageItem) => parseFloat(m.totalCostUSD) || 0), 1),
    [modelUsage]
  );
  const maxAppCost = useMemo(
    () => Math.max(...applicationConsumers.map((a: FoundryApplicationConsumer) => parseFloat(a.totalCostUSD) || 0), 1),
    [applicationConsumers]
  );

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <IconLoader2 className="w-8 h-8 text-[#0078D4] animate-spin" />
      </div>
    );
  }

  if (error || !data || !metrics) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
        <IconExclamationCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-red-900 dark:text-red-200 text-sm">{t("foundry_loadError")}</h3>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1">{error?.message || "Unknown error"}</p>
        </div>
      </div>
    );
  }

  const hasData =
    metrics.totalRequests > 0 ||
    metrics.totalTokens > 0 ||
    parseFloat(metrics.estimatedCostUSD) > 0 ||
    metrics.activeDeployments > 0 ||
    modelUsage.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Mock Banner ───────────────────────────────────────────────── */}
      {data.mock && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-200">{t("foundry_demo")}</p>
        </div>
      )}

      {/* ── Billing Latency Banner ─────────────────────────────────────── */}
      <div className="bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 text-sky-800 dark:text-sky-300 rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-xs">
        <IconInfoCircle className="w-4 h-4 text-sky-600 shrink-0" stroke={1.5} />
        <span>
          <strong>{t("foundry_billingLatency")}</strong> Azure Cost Management consolida metros en ventanas de 8-24h.
        </span>
      </div>

      {/* ── Time Range Selector + Refresh ──────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {([
            { id: 7, label: "7D" },
            { id: 30, label: "1 mes (30D)" },
            { id: "mtd" as const, label: "Mes actual (MTD)" },
            { id: 90, label: "90D" },
          ]).map((opt) => (
            <button
              key={String(opt.id)}
              onClick={() => setDays(opt.id)}
              className={
                "px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer " +
                (days === opt.id
                  ? "bg-[#0054A6] border-[#0054A6] text-white"
                  : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
        >
          <IconRotateClockwise className={"w-3.5 h-3.5 " + (isRefreshing ? "animate-spin text-[#0078D4]" : "")} stroke={1.5} />
          Refrescar datos
        </button>
      </div>

      {/* ── Empty State ────────────────────────────────────────────────── */}
      {!hasData && !data.mock && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
          <IconSearch className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" stroke={1} />
          <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white mb-1">
            {t("foundry_noData")}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {t("foundry_noDataDesc")}
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* ── 5 KPI Cards ────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiCard
              label="Total de Solicitudes"
              value={fmtNum(metrics.totalRequests)}
              sub={metrics.avgRequestsPerDay + " promedio/día"}
              icon={IconActivity}
              tooltip={t("foundry_requestsTooltip")}
            />
            <KpiCard
              label="Recuento Total de Tokens"
              value={fmtCompact(metrics.totalTokens)}
              sub={metrics.avgTokensPerRequest + " promedio/solicitud"}
              icon={IconCpu}
              tooltip="Suma de tokens de entrada (prompt) y salida (completion) procesados."
            />
            <KpiCard
              label={t("foundry_kpiCost")}
              value={fmtUSD(metrics.estimatedCostUSD)}
              sub={"Proyección EOM: " + fmtUSD(metrics.forecastCostUSD)}
              icon={IconCash}
              tooltip={t("foundry_kpiCostTooltip")}
            />
            <KpiCard
              label="Tokens de Entrada"
              value={fmtCompact(metrics.inputTokens)}
              sub={"Cache hit: " + metrics.promptCacheHitRate.toFixed(1) + "%"}
              icon={IconArrowDownRight}
              tooltip={t("foundry_promptTooltip")}
            />
            <KpiCard
              label="Tokens de Salida"
              value={fmtCompact(metrics.outputTokens)}
              sub={"$/1K out: " + fmtUSD(metrics.avgCostPer1kOutputTokensUSD)}
              icon={IconArrowUpRight}
              tooltip={t("foundry_completionTooltip")}
            />
          </div>

          {/* ── Row 1: Charts ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Cost Trend */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconChartArea className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-xs font-semibold text-[#1B2A41] dark:text-white">
                  {t("foundry_mtdProgress")}
                </h3>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0078D4" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0078D4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v: number) => "$" + v.toFixed(2)} />
                    <RechartsTooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                      formatter={(value: unknown) => {
                        const n = typeof value === "number" ? value : parseFloat(String(value || "0"));
                        return ["$" + (isNaN(n) ? "0.00" : n.toFixed(2)), "Costo"];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cumulativeCostUSD"
                      stroke="#0078D4"
                      strokeWidth={2}
                      fill="url(#costGradient)"
                      name={t("foundry_seriesCumulative")}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Token Trend */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconChartLine className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-xs font-semibold text-[#1B2A41] dark:text-white">
                  Progreso de Tokens (Entrada, Salida y Totales)
                </h3>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v: number) => fmtCompact(v)} />
                    <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line
                      type="monotone"
                      dataKey="inputTokens"
                      stroke="#2563EB"
                      strokeWidth={1.5}
                      dot={false}
                      name="Entrada"
                    />
                    <Line
                      type="monotone"
                      dataKey="outputTokens"
                      stroke="#0284C7"
                      strokeWidth={1.5}
                      dot={false}
                      name="Salida"
                    />
                    <Line
                      type="monotone"
                      dataKey="totalTokens"
                      stroke="#38BDF8"
                      strokeWidth={2}
                      dot={false}
                      name="Total"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Row 2: Cost by Model + Token Distribution ──────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Cost by Model */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconCash className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-xs font-semibold text-[#1B2A41] dark:text-white">{t("foundry_costByModel")}</h3>
                <InfoTooltip content={t("foundry_costByModelTooltip")} />
              </div>
              <div className="space-y-3">
                {modelUsage.map((m) => (
                  <ModelBarRow key={m.deploymentName} item={m} maxCost={maxModelCost} />
                ))}
              </div>
            </div>

            {/* Token Distribution by Model */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconCpu className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-xs font-semibold text-[#1B2A41] dark:text-white">
                  {t("foundry_tokensByModel")}
                </h3>
                <InfoTooltip content={t("foundry_tokensByModelTooltip")} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">{t("foundry_colDeployment")}</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">Input</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">Output</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">$/1K</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">{t("foundry_colCost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelUsage.map((m) => (
                      <tr key={m.deploymentName} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 px-2 text-[#1B2A41] dark:text-slate-200 font-medium">
                          {m.deploymentName}
                          <span className="text-[10px] text-slate-400 block">{m.modelName} {m.modelVersion}</span>
                        </td>
                        <td className="py-2 px-2 text-right text-slate-600 dark:text-slate-300">
                          {fmtCompact(m.inputTokens)}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-600 dark:text-slate-300">
                          {fmtCompact(m.outputTokens)}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-600 dark:text-slate-300 font-mono">
                          {fmtUSD(m.costPer1kTokensUSD)}
                        </td>
                        <td className="py-2 px-2 text-right font-bold text-[#1B2A41] dark:text-white">
                          {fmtUSD(m.totalCostUSD)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Row 3: Cost by Application + Showback ──────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Cost by Application */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconActivity className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-xs font-semibold text-[#1B2A41] dark:text-white">{t("foundry_costByApp")}</h3>
                <InfoTooltip content={t("foundry_costByAppTooltip")} />
              </div>
              <div className="space-y-0">
                {applicationConsumers.map((app) => (
                  <AppRow key={app.appId} app={app} maxCost={maxAppCost} />
                ))}
              </div>
            </div>

            {/* Cost by Team / Showback */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconTag className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-xs font-semibold text-[#1B2A41] dark:text-white">{t("foundry_costByTeam")}</h3>
                <InfoTooltip content={t("foundry_costByTeamTooltip")} />
              </div>

              {/* Tagged vs Untagged summary */}
              {(() => {
                const tagged = applicationConsumers.filter((a) => a.hasCostCenter);
                const untagged = applicationConsumers.filter((a) => !a.hasCostCenter);
                const taggedCost = tagged.reduce((s, a) => s + parseFloat(a.totalCostUSD), 0);
                const untaggedCost = untagged.reduce((s, a) => s + parseFloat(a.totalCostUSD), 0);
                const totalCost = taggedCost + untaggedCost;
                const taggedPct = totalCost > 0 ? (taggedCost / totalCost) * 100 : 0;

                return (
                  <>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-green-700 dark:text-green-300">{taggedPct.toFixed(0)}%</p>
                        <p className="text-[10px] text-green-600 dark:text-green-400">Atribuido ({tagged.length} apps)</p>
                        <p className="text-xs font-semibold text-green-700 dark:text-green-300 mt-1">{fmtUSD(taggedCost)}</p>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-center">
                        <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{(100 - taggedPct).toFixed(0)}%</p>
                        <p className="text-[10px] text-amber-600 dark:text-amber-400">Sin atribuir ({untagged.length} apps)</p>
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mt-1">{fmtUSD(untaggedCost)}</p>
                      </div>
                    </div>

                    {/* Tagged apps list */}
                    {tagged.length > 0 && (
                      <div className="space-y-1.5 mb-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Con CostCenter asignado</p>
                        {tagged.map((a) => (
                          <div key={a.appId} className="flex items-center justify-between text-xs">
                            <span className="text-[#1B2A41] dark:text-slate-200 truncate">{a.appDisplayName}</span>
                            <span className="text-slate-400 shrink-0 ml-2">{a.costCenter}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Untagged call-to-action */}
                    {untagged.length > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <IconAlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" stroke={1.5} />
                          <div>
                            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                              {untagged.length} aplicaciones sin CostCenter
                            </p>
                            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                              {t("foundry_tagHint")}
                            </p>
                            <button className="mt-2 text-[11px] px-3 py-1.5 rounded-lg border border-[#0078D4] text-[#0078D4] bg-white hover:bg-blue-50 font-medium transition-colors cursor-pointer flex items-center">
                              <IconSparkles size={16} stroke={1.5} className="inline mr-1.5 text-[#0078D4]" />
                              Asignar Tags
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* ── Remediation Actions ────────────────────────────────────── */}
          {remediationActions.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <IconBulb className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-xs font-semibold text-[#1B2A41] dark:text-white">
                  {t("foundry_recommendations")}
                </h3>
                <InfoTooltip content={t("foundry_recommendationsTooltip")} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {remediationActions.map((action) => (
                  <RemediationCard key={action.id} action={action} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
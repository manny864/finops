"use client";
import { useTranslations } from "next-intl";

/**
 * AzureAIOverview — Refactored "Resumen" tab for the Azure AI module.
 *
 * Architecture:
 *   1. Header with sync banner & time window selector
 *   2. 4 KPI cards (MTD Cost, Forecast EOM, Waste, Potential Savings)
 *   3. Capability breakdown (8 horizontal bars in blue scale)
 *   4. LLM Unit Economics mini-grid
 *   5. Two-column bottom: Recommendations (left) + Risk Signals (right)
 *
 * Design system:
 *   - Tabler Icons only, blue corporate (#0078D4), no background on icons
 *   - White cards with border-slate-200
 *   - Blue-scale palette for capability bars
 *   - z-50 modals, z-40 widgets
 *   - Mock-first: isMockTenant -> no OAuth required
 *   - Real tenant: zero tolerance for mock fallbacks
 */

import React, { useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import {
  IconBrain,
  IconTrendingUp,
  IconAlertTriangle,
  IconPigMoney,
  IconCoins,
  IconChartBar,
  IconBulb,
  IconSparkles,
  IconLoader2,
  IconInfoCircle,
  IconExclamationCircle,
  IconCheck,
  IconArrowUpRight,
  IconArrowDownRight,
} from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";
import type {
  AzureAiSummaryPayload,
  AiCapabilityBreakdownItem,
  AiRiskAnomalySignal,
  AiRemediationAction,
} from "@/types/azureAiSummary.types";

// Severity badge colors

const SEVERITY_COLORS: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-700 border-slate-300",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-300",
  HIGH: "bg-orange-50 text-orange-700 border-orange-300",
  CRITICAL: "bg-red-50 text-red-700 border-red-300",
};

const SEVERITY_DOT: Record<string, string> = {
  LOW: "bg-slate-400",
  MEDIUM: "bg-amber-500",
  HIGH: "bg-orange-500",
  CRITICAL: "bg-red-500",
};

// Number formatters

const fmtUSD = (value: string | number): string => {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "$0.00";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const fmtCompact = (n: number): string => {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
};

const fmtPct = (value: string): string => {
  const n = parseFloat(value);
  if (isNaN(n)) return "0%";
  return n + "%";
};

// Sub-components

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tooltip,
  trend,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  tooltip?: string;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {title}
        </span>
        <div className="flex items-center gap-1.5">
          {trend && trend !== "neutral" && (
            <span
              className={
                "text-[11px] font-semibold " +
                (trend === "up" ? "text-green-600" : "text-red-500")
              }
            >
              {trend === "up" ? (
                <IconArrowUpRight className="w-3 h-3 inline" />
              ) : (
                <IconArrowDownRight className="w-3 h-3 inline" />
              )}
            </span>
          )}
          {tooltip && <InfoTooltip content={tooltip} />}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Icon className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
        <span className="text-2xl font-bold text-[#1B2A41] dark:text-white">
          {value}
        </span>
      </div>
      {subtitle && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">{subtitle}</p>
      )}
    </div>
  );
}

function CapabilityBar({ item, maxCost }: { item: AiCapabilityBreakdownItem; maxCost: number }) {
  const costNum = parseFloat(item.costMtdUSD) || 0;
  const pct = maxCost > 0 ? (costNum / maxCost) * 100 : 0;
  const sharePct = parseFloat(item.sharePercentage) || 0;
  const wasteNum = parseFloat(item.wasteUSD) || 0;

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: item.colorHex }}
          />
          <span className="text-sm font-medium text-[#1B2A41] dark:text-slate-200">
            {item.displayName}
          </span>
          {item.hasAnomaly && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
              {"\u26A0"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-[#1B2A41] dark:text-slate-200">
            {fmtUSD(item.costMtdUSD)}
          </span>
          <span className="text-slate-400">{sharePct.toFixed(1)}%</span>
          {wasteNum > 0 && (
            <span className="text-amber-600 font-medium">
              Waste {fmtUSD(item.wasteUSD)}
            </span>
          )}
        </div>
      </div>
      <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: Math.min(pct, 100) + "%",
            backgroundColor: item.colorHex,
          }}
        />
      </div>
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[10px] text-slate-400">
          {item.activeResourcesCount} resource{item.activeResourcesCount !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

function UnitEconomicsCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-100 dark:border-slate-700">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <p className="text-lg font-bold text-[#1B2A41] dark:text-white">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function RemediationCard({ action }: { action: AiRemediationAction }) {
  const confidenceBadge =
    action.confidence === "HIGH"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-[#0078D4]/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <IconBulb className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-[#1B2A41] dark:text-white">
              {action.title}
            </h4>
            <span
              className={"text-[10px] px-1.5 py-0.5 rounded-full border font-medium " + confidenceBadge}
            >
              {action.confidence}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
            {action.description}
          </p>
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-slate-400">{action.capabilityName}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-green-600">
                {fmtUSD(action.estimatedMonthlySavingsUSD)}
                <span className="text-[10px] font-normal text-slate-400">/mo</span>
              </span>
              <button
                className="text-[11px] px-3 py-1.5 rounded-lg border border-[#0078D4] text-[#0078D4] dark:text-blue-400 bg-white hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800 font-medium transition-colors"
                title="Optimize this recommendation"
              >
                Optimizar {"\u2728"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RiskSignalCard({ signal }: { signal: AiRiskAnomalySignal }) {
  const isHighSeverity = signal.severity === "CRITICAL" || signal.severity === "HIGH";
  return (
    <div
      className={
        "border rounded-lg p-3 " +
        (isHighSeverity
          ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900")
      }
    >
      <div className="flex items-start gap-2.5">
        <div className={"w-2 h-2 rounded-full mt-1.5 shrink-0 " + SEVERITY_DOT[signal.severity]} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-xs font-semibold text-[#1B2A41] dark:text-white">
              {signal.title}
            </h4>
            <span
              className={
                "text-[10px] px-1.5 py-0.5 rounded-full border font-medium " +
                SEVERITY_COLORS[signal.severity]
              }
            >
              {signal.severity}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {signal.description}
          </p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
            <span>{signal.serviceOriginName}</span>
            {parseFloat(signal.estimatedImpactUSD) > 0 && (
              <span className="text-amber-600 font-medium">
                Impact {fmtUSD(signal.estimatedImpactUSD)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Main Component

export default function AzureAIOverview() {
  const t = useTranslations("AzureAI");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const tenantId = selectedTenant?.id;
  const isMock = tenantId ? isMockTenant(tenantId) : false;

  const { data, error, isLoading } = useSWR(
    tenantId ? "/api/intelligence/azure-ai/summary?tenantId=" + tenantId : null,
    async (url: string) => {
      if (isMock) {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load AI summary");
        return res.json() as Promise<AzureAiSummaryPayload>;
      }
      const token = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!res.ok) throw new Error("Failed to load AI summary");
      return res.json() as Promise<AzureAiSummaryPayload>;
    }
  );

  // Extract data early so hooks are always called (rules-of-hooks)
  const metrics = data?.metrics;
  const capabilityBreakdown = data?.capabilityBreakdown || [];
  const unitEconomics = data?.unitEconomics;
  const riskSignals = data?.riskSignals || [];
  const remediationActions = data?.remediationActions || [];

  // Guard: unitEconomics must exist for the LLM section
  const ue = unitEconomics || {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    avgCostPerMillionTokensUSD: "0.00",
    billingModel: "UNKNOWN" as const,
    activeDeployments: 0,
    topModelName: "N/A",
  };

  const maxCapCost = useMemo(
    () => Math.max(...capabilityBreakdown.map((c: AiCapabilityBreakdownItem) => parseFloat(c.costMtdUSD) || 0), 1),
    [capabilityBreakdown]
  );

  const sortedCapabilities = useMemo(
    () =>
      [...capabilityBreakdown].sort(
        (a: AiCapabilityBreakdownItem, b: AiCapabilityBreakdownItem) =>
          (parseFloat(b.costMtdUSD) || 0) - (parseFloat(a.costMtdUSD) || 0)
      ),
    [capabilityBreakdown]
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
        <IconExclamationCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-red-900 dark:text-red-200 text-sm">
            {t("ov_loadError")}
          </h3>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1">
            {error?.message || "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  const totalCostNum = parseFloat(metrics.totalCostMtdUSD) || 0;
  const hasData = totalCostNum > 0;

  return (
    <div className="space-y-6">
      {data.mock && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            {t("ov_demo")}
          </p>
        </div>
      )}

      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconInfoCircle className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
          <span className="text-xs text-blue-800 dark:text-blue-200 font-medium">
            {t("liveSyncNotice")}
          </span>
        </div>
        <select
          className="text-xs border border-blue-200 dark:border-blue-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200"
          defaultValue="mtd"
        >
          <option value="mtd">{t("ov_mtd")}</option>
          <option value="30d">{t("ov_last30")}</option>
          <option value="7d">{t("ov_last7")}</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title="Total Azure AI Cost (MTD)"
          value={fmtUSD(metrics.totalCostMtdUSD)}
          subtitle={
            hasData
              ? fmtPct(capabilityBreakdown[0]?.sharePercentage || "0") + " del presupuesto total"
              : "Sin datos de facturacion"
          }
          icon={IconBrain}
          tooltip={t("ov_mtdTooltip")}
          trend={parseFloat(metrics.momVariationPct) > 0 ? "up" : parseFloat(metrics.momVariationPct) < 0 ? "down" : "neutral"}
        />
        <KpiCard
          title="Forecast EOM"
          value={fmtUSD(metrics.forecastEomUSD)}
          subtitle={
            metrics.momVariationPct !== "0.0"
              ? (parseFloat(metrics.momVariationPct) > 0 ? "+" : "") + metrics.momVariationPct + "% vs mes anterior"
              : "Proyeccion lineal"
          }
          icon={IconTrendingUp}
          tooltip={t("ov_forecastTooltip")}
        />
        <KpiCard
          title={t("ov_wasteTitle")}
          value={fmtUSD(metrics.estimatedWasteUSD)}
          subtitle={
            parseFloat(metrics.estimatedWasteUSD) > 0
              ? "Instancias ociosas / clusters sin auto-apagado"
              : "Sin desperdicio detectado"
          }
          icon={IconAlertTriangle}
          tooltip={t("ov_wasteTooltip")}
        />
        <KpiCard
          title={t("ov_savingsTitle")}
          value={fmtUSD(metrics.potentialSavingsUSD)}
          subtitle={
            parseFloat(metrics.potentialSavingsUSD) > 0
              ? remediationActions.length + " acciones de optimizacion detectadas"
              : "Sin oportunidades detectadas"
          }
          icon={IconPigMoney}
          tooltip={t("ov_savingsTooltip")}
        />
      </div>

      {!hasData && !data.mock && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center">
          <IconChartBar className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" stroke={1} />
          <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white mb-1">
            {t("ov_noData")}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {t("ov_noDataDesc")}
            facturacion actual.
          </p>
        </div>
      )}

      {hasData && (
        <>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <IconChartBar className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">
                {t("ov_breakdown")}
              </h3>
              <InfoTooltip content={t("ov_breakdownTooltip")} />
            </div>
            <div className="space-y-3">
              {sortedCapabilities.map((item: AiCapabilityBreakdownItem) => (
                <CapabilityBar key={item.capabilityKey} item={item} maxCost={maxCapCost} />
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>
                {t("ov_activeResources", { n: capabilityBreakdown.reduce((sum: number, c: AiCapabilityBreakdownItem) => sum + c.activeResourcesCount, 0) })}
              </span>
              <span>Total: {fmtUSD(metrics.totalCostMtdUSD)}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <IconCoins className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">
                {t("inferenceUnitEconomics")}
              </h3>
              <InfoTooltip content={t("ov_unitTooltip")} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <UnitEconomicsCard
                label="Total Tokens Procesados"
                value={fmtCompact(ue.totalTokens)}
                sub={fmtCompact(ue.promptTokens) + " prompt + " + fmtCompact(ue.completionTokens) + " completion"}
                icon={IconSparkles}
              />
              <UnitEconomicsCard
                label={t("ov_avgCostPer1M")}
                value={fmtUSD(ue.avgCostPerMillionTokensUSD)}
                sub={"Modelo principal: " + ue.topModelName}
                icon={IconCoins}
              />
              <UnitEconomicsCard
                label={t("billingModality")}
                value={
                  ue.billingModel === "PAYG"
                    ? "Pay-As-You-Go"
                    : ue.billingModel === "PTU"
                      ? "Provisioned Throughput"
                      : ue.billingModel === "HYBRID"
                        ? "Hibrido (PAYG + PTU)"
                        : "No detectado"
                }
                sub={ue.activeDeployments + " deployments activos"}
                icon={IconBrain}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <IconBulb className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">
                  Top Recommendations by ROI
                </h3>
                <InfoTooltip content={t("ov_actionsTooltip")} />
              </div>
              {remediationActions.length === 0 ? (
                <div className="text-center py-6">
                  <IconCheck className="w-8 h-8 text-green-500 mx-auto mb-2" stroke={1.5} />
                  <p className="text-xs text-slate-500">
                    {t("noPendingRecommendations")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {remediationActions.slice(0, 5).map((action: AiRemediationAction) => (
                    <RemediationCard key={action.id} action={action} />
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <IconAlertTriangle className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">
                  Risk and Anomaly Signals
                </h3>
                <InfoTooltip content={t("healthMonitorTooltip")} />
              </div>
              {riskSignals.length === 0 ? (
                <div className="text-center py-6">
                  <IconCheck className="w-8 h-8 text-green-500 mx-auto mb-2" stroke={1.5} />
                  <p className="text-xs text-slate-500">
                    {t("ov_noRisk")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {riskSignals.map((signal: AiRiskAnomalySignal) => (
                    <RiskSignalCard key={signal.id} signal={signal} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
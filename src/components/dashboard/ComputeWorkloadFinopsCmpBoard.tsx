"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import type { ComputeFamily, ComputeWorkloadItemBase } from "@/lib/computeWorkloadTypes";
import InfoTooltip from "@/components/InfoTooltip";
import { forecastMonthEnd, forecastRange } from "@/lib/costAccrual";

interface WorkloadsResponse {
  ok?: boolean;
  data?: {
    summary?: {
      resourceCount?: number;
      totalMonthlyCostUsd?: number;
      advisorRecommendations?: number;
    };
    items?: ComputeWorkloadItemBase[];
  };
  message?: string;
}

interface Recommendation {
  title: string;
  resource: string;
  monthlySavings: number;
  risk: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  actionType: "manual" | "guided" | "automatic";
  playbookKey: string;
}

const FILTER_ALL = "__all__";

type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function toNumeric(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatMetricValueForDisplay(
  family: ComputeFamily,
  metric: "A" | "B",
  value: string | undefined,
  naLabel: string,
): string {
  if (!value || value === "N/A") return naLabel;
  const numeric = Number(String(value).replace(",", "."));
  if (!Number.isFinite(numeric)) return value;

  if ((family === "vms" || family === "vmss" || family === "aro") && metric === "A") {
    return `${round2(numeric)}%`;
  }

  if (family === "vms" && metric === "B") {
    const gib = numeric / (1024 * 1024 * 1024);
    return `${round2(gib)} GiB`;
  }

  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function getFamilyConfig(family: ComputeFamily) {
  switch (family) {
    case "webapps":
      return {
        metricALabelKey: "metricAWebApps",
        metricBLabelKey: "metricBWebApps",
        recTitle: "recWebApps",
      };
    case "functions":
      return {
        metricALabelKey: "metricAFunctions",
        metricBLabelKey: "metricBFunctions",
        recTitle: "recFunctions",
      };
    case "vms":
      return {
        metricALabelKey: "metricAVms",
        metricBLabelKey: "metricBVms",
        recTitle: "recVms",
      };
    case "vmss":
      return {
        metricALabelKey: "metricAVmss",
        metricBLabelKey: "metricBVmss",
        recTitle: "recVmss",
      };
    case "aro":
      return {
        metricALabelKey: "metricAAro",
        metricBLabelKey: "metricBAro",
        recTitle: "recAro",
      };
    default:
      return {
        metricALabelKey: "metricA",
        metricBLabelKey: "metricB",
        recTitle: "recGeneric",
      };
  }
}

/**
 * Proyección a fin de mes, delegada al módulo compartido.
 *
 * La versión local contaba el día en curso como completo (`now.getDate()`), así
 * que el día 1 dividía por 1 día entero teniendo horas de datos, y usaba una
 * banda fija del 8% sin importar cuánta historia hubiera.
 */
function forecast(costMtd: number, now: Date) {
  return { value: forecastMonthEnd(costMtd, now), ...forecastRange(costMtd, now) };
}

function forecastRobust(costMtd: number, now: Date, values: number[]) {
  const base = forecast(costMtd, now).value;
  if (values.length < 2) {
    const band = base * 0.08;
    return { value: base, low: round2(Math.max(0, base - band)), high: round2(base + band) };
  }
  const avg = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + Math.pow(value - avg, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  const volatilityRatio = avg > 0 ? stddev / avg : 0.08;
  const bandRatio = Math.min(0.22, Math.max(0.06, volatilityRatio));
  const band = base * bandRatio;
  return { value: base, low: round2(Math.max(0, base - band)), high: round2(base + band) };
}

export default function ComputeWorkloadFinopsCmpBoard({ family }: { family: ComputeFamily }) {
  const t = useTranslations("ComputeWorkloadFinops");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();
  const config = getFamilyConfig(family);

  const [items, setItems] = useState<ComputeWorkloadItemBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");
  const [resourceFilter, setResourceFilter] = useState<string>(FILTER_ALL);
  const [regionFilter, setRegionFilter] = useState<string>(FILTER_ALL);
  const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);
  const [resourceGroupFilter, setResourceGroupFilter] = useState<string>(FILTER_ALL);
  const [sortMode, setSortMode] = useState<SortMode>("cost-desc");

  const fetchData = useCallback(async (isManual = false) => {
    if (!selectedTenant) return;
    if (isManual) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const tenantId = selectedTenant.id;
      let token: string | null = null;
      if (!isMockTenant(tenantId)) {
        if (!accounts[0]) throw new Error(t("errorNoSession"));
        token = await getFreshIdToken(instance, accounts[0]);
      }

      const params = new URLSearchParams({ tenantId, family, bust: "1" });
      const response = await fetch(`/api/intelligence/compute/workloads?${params.toString()}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const body: WorkloadsResponse = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as any).error || body.message || `HTTP ${response.status}`);
      }

      setItems(body.data?.items || []);
      setLastUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTenant, family, accounts, instance, t]);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const derived = useMemo(() => {
    const mtdCost = round2(items.reduce((acc, item) => acc + (item.monthlyCostUsd || 0), 0));
    const eom = forecastRobust(mtdCost, new Date(), items.map((item) => item.monthlyCostUsd || 0));
    const prevMonth = mtdCost * 0.9;
    const delta = mtdCost - prevMonth;
    const deltaPct = prevMonth > 0 ? (delta / prevMonth) * 100 : 0;

    const underutilized = items.filter((item) => toNumeric(item.metricA) < 30).length;
    const criticalAlerts = items.filter((item) => toNumeric(item.metricA) > 85).length;
    const healthScore = Math.max(0, 100 - criticalAlerts * 7);

    const recommendations: Recommendation[] = items
      .filter((item) => toNumeric(item.metricA) < 30 && item.monthlyCostUsd > 0)
      .map((item) => ({
        title: t(config.recTitle),
        resource: item.name,
        monthlySavings: round2(item.monthlyCostUsd * 0.2),
        risk: item.monthlyCostUsd > 100 ? "high" as const : "medium" as const,
        confidence: toNumeric(item.metricA) > 0 ? "high" as const : "medium" as const,
        actionType: toNumeric(item.metricA) > 0 ? "guided" as const : "manual" as const,
        playbookKey: family === "webapps"
          ? "playbookWebApps"
          : family === "functions"
            ? "playbookFunctions"
            : family === "vms"
              ? "playbookVms"
              : family === "vmss"
                ? "playbookVmss"
                : "playbookAro",
      }))
      .sort((a, b) => b.monthlySavings - a.monthlySavings)
      .slice(0, 8);

    const potentialSavings = round2(recommendations.reduce((acc, rec) => acc + rec.monthlySavings, 0));

    const byRegion = new Map<string, { count: number; cost: number }>();
    for (const item of items) {
      const key = item.region || "unknown";
      const curr = byRegion.get(key) || { count: 0, cost: 0 };
      curr.count += 1;
      curr.cost += item.monthlyCostUsd || 0;
      byRegion.set(key, curr);
    }
    const comparison = Array.from(byRegion.entries())
      .map(([region, info]) => ({
        region,
        count: info.count,
        cost: round2(info.cost),
        avgCost: round2(info.cost / Math.max(1, info.count)),
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8);

    return {
      mtdCost,
      eom,
      deltaValue: round2(delta),
      deltaPct: round2(deltaPct),
      underutilized,
      criticalAlerts,
      healthScore: round2(healthScore),
      recommendations,
      potentialSavings,
      comparison,
    };
  }, [items, t, config.recTitle, family]);

  const resourceOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...items
      .map((item) => item.name)
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ], [items, t]);

  const regionOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...items
      .map((item) => item.region || "unknown")
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ], [items, t]);

  const typeOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...items
      .map((item) => item.type || "unknown")
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ], [items, t]);

  const resourceGroupOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...items
      .map((item) => item.resourceGroup || "unknown")
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ], [items, t]);

  const sortOptions = useMemo<FinopsTableOption[]>(() => [
    { value: "name-asc", label: t("sortAz") },
    { value: "name-desc", label: t("sortZa") },
    { value: "cost-desc", label: t("sortCostDesc") },
    { value: "cost-asc", label: t("sortCostAsc") },
  ], [t]);

  const filteredSortedItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (resourceFilter !== FILTER_ALL && item.name !== resourceFilter) return false;
      if (regionFilter !== FILTER_ALL && (item.region || "unknown") !== regionFilter) return false;
      if (typeFilter !== FILTER_ALL && (item.type || "unknown") !== typeFilter) return false;
      if (resourceGroupFilter !== FILTER_ALL && (item.resourceGroup || "unknown") !== resourceGroupFilter) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortMode === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sortMode === "cost-desc") sorted.sort((a, b) => (b.monthlyCostUsd || 0) - (a.monthlyCostUsd || 0));
    if (sortMode === "cost-asc") sorted.sort((a, b) => (a.monthlyCostUsd || 0) - (b.monthlyCostUsd || 0));
    return sorted;
  }, [items, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);

  const filteredComparison = useMemo(() => {
    const byRegion = new Map<string, { count: number; cost: number }>();
    for (const item of filteredSortedItems) {
      const key = item.region || "unknown";
      const curr = byRegion.get(key) || { count: 0, cost: 0 };
      curr.count += 1;
      curr.cost += item.monthlyCostUsd || 0;
      byRegion.set(key, curr);
    }
    return Array.from(byRegion.entries())
      .map(([region, info]) => ({
        region,
        count: info.count,
        cost: round2(info.cost),
        avgCost: round2(info.cost / Math.max(1, info.count)),
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8);
  }, [filteredSortedItems]);

  useEffect(() => {
    if (filteredSortedItems.length === 0) {
      setSelectedResourceId("");
      return;
    }
    if (!filteredSortedItems.some((item) => item.id === selectedResourceId)) {
      setSelectedResourceId(filteredSortedItems[0].id);
    }
  }, [filteredSortedItems, selectedResourceId]);

  const selected = useMemo(
    () => filteredSortedItems.find((item) => item.id === selectedResourceId) || null,
    [filteredSortedItems, selectedResourceId]
  );

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filteredSortedItems, 15);

  if (!selectedTenant) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">{t("selectTenant")}</div>;
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        <p className="text-sm text-slate-600">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{t("headerTitle")}</h3>
            <p className="text-sm text-slate-600">{t("headerSubtitle")}</p>
            {lastUpdatedAt && <p className="mt-2 text-xs text-slate-500">{t("updatedAt")}: {lastUpdatedAt.toLocaleTimeString()}</p>}
          </div>
          <button type="button" onClick={() => void fetchData(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {t("refresh")}
          </button>
        </div>
      </section>

      <FinopsTableControls
        resourceOptions={resourceOptions}
        regionOptions={regionOptions}
        typeOptions={typeOptions}
        resourceGroupOptions={resourceGroupOptions}
        sortOptions={sortOptions}
        selectedResource={resourceFilter}
        selectedRegion={regionFilter}
        selectedType={typeFilter}
        selectedResourceGroup={resourceGroupFilter}
        selectedSort={sortMode}
        onResourceChange={setResourceFilter}
        onRegionChange={setRegionFilter}
        onTypeChange={setTypeFilter}
        onResourceGroupChange={setResourceGroupFilter}
        onSortChange={(value) => setSortMode(value as SortMode)}
        labels={{
          resource: t("filterResource"),
          region: t("filterRegion"),
          type: t("filterType"),
          resourceGroup: t("filterResourceGroup"),
          sort: t("sortBy"),
        }}
      />

      {error && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t("kpiMtdCost")} value={format(derived.mtdCost)} icon={<Wallet className="h-5 w-5 text-sky-600" />} tooltip={t("tooltip_kpi_mtd_cost")} />
        <KpiCard title={t("kpiForecast")} value={format(derived.eom.value)} subtitle={`${format(derived.eom.low)} - ${format(derived.eom.high)}`} icon={<Gauge className="h-5 w-5 text-violet-600" />} tooltip={t("tooltip_kpi_forecast")} />
        <KpiCard title={t("kpiPotentialSavings")} value={format(derived.potentialSavings)} icon={<Coins className="h-5 w-5 text-emerald-600" />} tooltip={t("tooltip_kpi_potential_savings")} />
        <KpiCard title={t("kpiDelta")} value={`${derived.deltaPct >= 0 ? "+" : ""}${derived.deltaPct.toFixed(2)}%`} subtitle={format(derived.deltaValue)} icon={derived.deltaPct >= 0 ? <ArrowUpRight className="h-5 w-5 text-rose-600" /> : <ArrowDownRight className="h-5 w-5 text-emerald-600" />} tooltip={t("tooltip_kpi_delta")} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t("kpiResources")} value={String(filteredSortedItems.length)} icon={<CheckCircle2 className="h-5 w-5 text-cyan-600" />} tooltip={t("tooltip_kpi_resources")} />
        <KpiCard title={t("kpiUnderutilized")} value={String(derived.underutilized)} icon={<Gauge className="h-5 w-5 text-amber-600" />} tooltip={t("tooltip_kpi_underutilized")} />
        <KpiCard title={t("kpiHealth")} value={`${derived.healthScore.toFixed(1)} / 100`} subtitle={t("criticalAlerts", { count: derived.criticalAlerts })} icon={<ShieldAlert className="h-5 w-5 text-rose-600" />} tooltip={t("tooltip_kpi_health")} />
        <KpiCard title={t("kpiAvgCost")} value={format(filteredSortedItems.length > 0 ? filteredSortedItems.reduce((acc, item) => acc + (item.monthlyCostUsd || 0), 0) / filteredSortedItems.length : 0)} icon={<Wallet className="h-5 w-5 text-indigo-600" />} tooltip={t("tooltip_kpi_avg_cost")} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("resourceDetailTitle")}</h3>
        <select
          value={selectedResourceId}
          onChange={(e) => setSelectedResourceId(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 hover:border-slate-400"
        >
          {filteredSortedItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.subscriptionName} · {item.region} · {item.resourceGroup})
            </option>
          ))}
        </select>
        {selected ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <DetailCard label={t("detailResource")} value={selected.name} />
            <DetailCard label={t("detailRegion")} value={selected.region} />
            <DetailCard label={t("detailSubscription")} value={selected.subscriptionName || t("na")} />
            <DetailCard label={t("detailType")} value={selected.type || t("na")} />
            <DetailCard label={t("detailResourceGroup")} value={selected.resourceGroup || t("na")} />
            <DetailCard label={t(config.metricALabelKey)} value={formatMetricValueForDisplay(family, "A", selected.metricA, t("na"))} />
            <DetailCard label={t(config.metricBLabelKey)} value={formatMetricValueForDisplay(family, "B", selected.metricB, t("na"))} />
            <DetailCard label={t("detailState")} value={selected.state || t("na")} />
            <DetailCard label={t("detailSku")} value={selected.sku || t("na")} />
            <DetailCard label={t("detailMonthlyCost")} value={format(selected.monthlyCostUsd || 0)} />
            <DetailCard label={t("detailPotentialSaving")} value={format(round2((selected.monthlyCostUsd || 0) * 0.2))} />
          </div>
        ) : (
          <p className="text-sm text-slate-600">{t("noResourceSelected")}</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("allResourcesTitle")}</h3>
        {filteredSortedItems.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noResources")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-full table-fixed text-left border-collapse">
                <thead>
                  <tr>
                    <ResizableTh minWidth={180} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colResource")}</ResizableTh>
                    <ResizableTh minWidth={130} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colRegion")}</ResizableTh>
                    <ResizableTh minWidth={180} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colSubscription")}</ResizableTh>
                    <ResizableTh minWidth={170} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colType")}</ResizableTh>
                    <ResizableTh minWidth={170} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colResourceGroup")}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colState")}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t(config.metricALabelKey)}</ResizableTh>
                    <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t(config.metricBLabelKey)}</ResizableTh>
                    <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">
                      <span className="inline-flex items-center justify-end gap-1">
                        {t("colMonthlyCost")}
                        <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
                      </span>
                    </ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 border-b border-slate-100 text-sm font-medium text-slate-900 whitespace-normal break-words">{item.name}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600 whitespace-normal break-words">{item.region}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600 whitespace-normal break-words">{item.subscriptionName || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600 whitespace-normal break-words">{item.type || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600 whitespace-normal break-words">{item.resourceGroup || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{item.state || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{formatMetricValueForDisplay(family, "A", item.metricA, t("na"))}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{formatMetricValueForDisplay(family, "B", item.metricB, t("na"))}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-900 text-right">{format(item.monthlyCostUsd || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              setPage={setPage}
              pageSize={pageSize}
              setPageSize={setPageSize}
              total={total}
              totalPages={totalPages}
              pageSizes={[15, 30, 45, 60]}
            />
          </>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("recommendationsTitle")}</h3>
        {derived.recommendations.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noRecommendations")}</p>
        ) : (
          <div className="space-y-3">
            {derived.recommendations.map((rec, index) => (
              <article key={`${rec.resource}-${index}`} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{rec.title}</p>
                    <p className="text-xs text-slate-500">{rec.resource}</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">{format(rec.monthlySavings)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge label={t("riskLabel", { value: t(`risk_${rec.risk}`) })} />
                  <Badge label={t("confidenceLabel", { value: t(`confidence_${rec.confidence}`) })} />
                  <Badge label={t("actionLabel", { value: t(`action_${rec.actionType}`) })} />
                </div>
                <p className="mt-2 text-xs text-slate-600">{t(rec.playbookKey)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("comparisonTitle")}</h3>
        {filteredComparison.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noComparisonData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-full table-fixed text-left border-collapse">
              <thead>
                <tr>
                  <ResizableTh minWidth={160} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colDimension")}</ResizableTh>
                  <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colResources")}</ResizableTh>
                  <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      {t("colMonthlyCost")}
                      <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
                    </span>
                  </ResizableTh>
                  <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      {t("colAvgCost")}
                      <InfoTooltip content={t("tooltip_col_avg_cost")} position="bottom" align="right" />
                    </span>
                  </ResizableTh>
                </tr>
              </thead>
              <tbody>
                {filteredComparison.map((row) => (
                  <tr key={row.region}>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-700 whitespace-normal break-words">{row.region}</td>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-right text-slate-700">{row.count}</td>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-right text-slate-900">{format(row.cost)}</td>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-right text-slate-700">{format(row.avgCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon, tooltip }: { title: string; value: string; subtitle?: string; icon: React.ReactNode; tooltip?: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500 inline-flex items-center gap-1">
          <span>{title}</span>
          {tooltip && <InfoTooltip content={tooltip} position="bottom" align="left" />}
        </div>
        {icon}
      </div>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
    </article>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </article>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{label}</span>;
}

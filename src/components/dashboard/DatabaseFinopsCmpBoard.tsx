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
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import { useTranslations } from "next-intl";

type DatabaseFamily = "cosmos" | "sql" | "postgres" | "mongo" | "redis" | "mysql";

interface MetricPoint {
  timestamp?: string;
  [key: string]: number | string | null | undefined;
}

interface DatabaseInstance {
  id: string;
  name: string;
  type?: string;
  region?: string;
  sku?: string;
  monthlyCostUsd?: number;
  history?: MetricPoint[];
}

interface Recommendation {
  title: string;
  instanceId: string;
  monthlySavings: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
}

interface MetricsResponse {
  instances?: DatabaseInstance[];
  financialSummary?: {
    mtdCost: number;
    forecastEom: { value: number; low: number; high: number };
    deltaMoM: { value: number; percentage: number };
    potentialSavings: number;
  };
  efficiency?: {
    costPerUsedGb: number;
    costPerKOps: number;
    underutilizedCount: number;
  };
  risk?: {
    healthScore: number;
    criticalAlerts: number;
  };
  recommendations?: Recommendation[];
  message?: string;
  error?: string;
}

interface ResourceRow {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  subscriptionName: string;
  region: string;
  state: string;
  sku: string;
  monthlyCostUsd: number;
  metricA?: string;
  metricB?: string;
}

const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

function parseAzureId(resourceId: string): { resourceGroup: string; subscriptionId: string } {
  const value = String(resourceId || "");
  const parts = value.split("/").filter(Boolean);
  const subIndex = parts.findIndex((part) => part.toLowerCase() === "subscriptions");
  const rgIndex = parts.findIndex((part) => part.toLowerCase() === "resourcegroups");
  return {
    subscriptionId: subIndex >= 0 ? parts[subIndex + 1] || "" : "",
    resourceGroup: rgIndex >= 0 ? parts[rgIndex + 1] || "unknown" : "unknown",
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function forecastRobust(baseForecast: number, values: number[]) {
  if (values.length < 2) {
    const band = baseForecast * 0.08;
    return { value: round2(baseForecast), low: round2(Math.max(0, baseForecast - band)), high: round2(baseForecast + band) };
  }
  const avg = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + Math.pow(value - avg, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  const volatilityRatio = avg > 0 ? stddev / avg : 0.08;
  const bandRatio = Math.min(0.22, Math.max(0.06, volatilityRatio));
  const band = baseForecast * bandRatio;
  return { value: round2(baseForecast), low: round2(Math.max(0, baseForecast - band)), high: round2(baseForecast + band) };
}

function familyConfig(family: DatabaseFamily) {
  switch (family) {
    case "cosmos":
      return { endpoint: "cosmos-metrics", metricALabelKey: "metricACosmos", metricBLabelKey: "metricBCosmos", playbookKey: "playbookCosmos" };
    case "sql":
      return { endpoint: "sql-metrics", metricALabelKey: "metricASql", metricBLabelKey: "metricBSql", playbookKey: "playbookSql" };
    case "postgres":
      return { endpoint: "postgres-metrics", metricALabelKey: "metricAPostgres", metricBLabelKey: "metricBPostgres", playbookKey: "playbookPostgres" };
    case "mongo":
      return { endpoint: "mongo-metrics", metricALabelKey: "metricAMongo", metricBLabelKey: "metricBMongo", playbookKey: "playbookMongo" };
    case "redis":
      return { endpoint: "redis-metrics", metricALabelKey: "metricARedis", metricBLabelKey: "metricBRedis", playbookKey: "playbookRedis" };
    case "mysql":
    default:
      return { endpoint: "mysql-metrics", metricALabelKey: "metricAMysql", metricBLabelKey: "metricBMysql", playbookKey: "playbookMysql" };
  }
}

function metricAverage(history: MetricPoint[] | undefined) {
  if (!history || history.length === 0) return { a: 0, b: 0 };
  const numericKeys = Object.keys(history[0] || {}).filter((key) => key !== "timestamp");
  const pickA = numericKeys[0];
  const pickB = numericKeys[1];
  if (!pickA || !pickB) return { a: 0, b: 0 };

  const sum = (key: string) =>
    history.reduce((acc, item) => acc + (typeof item[key] === "number" ? Number(item[key]) : 0), 0);
  return {
    a: round2(sum(pickA) / Math.max(1, history.length)),
    b: round2(sum(pickB) / Math.max(1, history.length)),
  };
}

function avgMetric(history: MetricPoint[] | undefined, key: string): number | null {
  if (!history || history.length === 0) return null;
  let total = 0;
  let count = 0;
  for (const point of history) {
    const value = point[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  if (count === 0) return null;
  return total / count;
}

function sumMetric(history: MetricPoint[] | undefined, key: string): number {
  if (!history || history.length === 0) return 0;
  return history.reduce((acc, point) => {
    const value = point[key];
    return acc + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function redisMetricA(history: MetricPoint[] | undefined): string {
  const avgMemoryBytes = avgMetric(history, "UsedMemory");
  const avgCpu = avgMetric(history, "PercentProcessorTime") ?? avgMetric(history, "ServerLoad");
  if (avgMemoryBytes === null && avgCpu === null) return "N/A";

  const memoryMb = avgMemoryBytes !== null ? round2(avgMemoryBytes / (1024 * 1024)) : null;
  const memoryLabel = memoryMb !== null ? `${memoryMb} MB` : "N/A";
  const cpuLabel = avgCpu !== null ? `${round2(avgCpu)}%` : "N/A";
  return `${memoryLabel} / ${cpuLabel}`;
}

function redisMetricB(history: MetricPoint[] | undefined): string {
  const totalHits = sumMetric(history, "CacheHits");
  const totalMisses = sumMetric(history, "CacheMisses");
  const hitTotal = totalHits + totalMisses;
  const hitRatePct = hitTotal > 0 ? round2((totalHits / hitTotal) * 100) : null;
  const evictions = Math.round(sumMetric(history, "EvictedKeys"));

  const hitRateLabel = hitRatePct !== null ? `${hitRatePct}%` : "N/A";
  return `${hitRateLabel} / ${evictions}`;
}

function mysqlMetricA(history: MetricPoint[] | undefined): string {
  const avgCpu = avgMetric(history, "cpu_percent");
  const avgMemory = avgMetric(history, "memory_percent");
  if (avgCpu === null && avgMemory === null) return "N/A";
  const cpuLabel = avgCpu !== null ? `${round2(avgCpu)}%` : "N/A";
  const memoryLabel = avgMemory !== null ? `${round2(avgMemory)}%` : "N/A";
  return `${cpuLabel} / ${memoryLabel}`;
}

function mysqlMetricB(history: MetricPoint[] | undefined): string {
  const avgConnections = avgMetric(history, "active_connections");
  const avgIo = avgMetric(history, "io_consumption_percent");
  if (avgConnections === null && avgIo === null) return "N/A";
  const connectionsLabel = avgConnections !== null ? String(Math.round(avgConnections)) : "N/A";
  const ioLabel = avgIo !== null ? `${round2(avgIo)}%` : "N/A";
  return `${connectionsLabel} / ${ioLabel}`;
}

function sqlMetricA(history: MetricPoint[] | undefined): string {
  const avgCpu = avgMetric(history, "cpu_percent");
  const avgWorkload = avgMetric(history, "workload_percent");
  if (avgCpu === null && avgWorkload === null) return "N/A";
  const cpuLabel = avgCpu !== null ? `${round2(avgCpu)}%` : "N/A";
  const workloadLabel = avgWorkload !== null ? `${round2(avgWorkload)}%` : "N/A";
  return `${cpuLabel} / ${workloadLabel}`;
}

function sqlMetricB(history: MetricPoint[] | undefined): string {
  const avgConnections = avgMetric(history, "active_connections");
  const avgIo = avgMetric(history, "io_percent");
  if (avgConnections === null && avgIo === null) return "N/A";
  const connectionsLabel = avgConnections !== null ? String(Math.round(avgConnections)) : "N/A";
  const ioLabel = avgIo !== null ? `${round2(avgIo)}%` : "N/A";
  return `${connectionsLabel} / ${ioLabel}`;
}

function inferState(history: MetricPoint[] | undefined, family: DatabaseFamily) {
  if (!history || history.length === 0) return "unknown";
  if (family === "redis") {
    const avgCpu = avgMetric(history, "PercentProcessorTime") ?? avgMetric(history, "ServerLoad") ?? 0;
    const evictions = sumMetric(history, "EvictedKeys");
    const errors = sumMetric(history, "Errors");
    if (errors > 0 || evictions > 0 || avgCpu > 85) return "critical";
    if (avgCpu > 65) return "warning";
    return "healthy";
  }
  if (family === "mysql") {
    const avgCpu = avgMetric(history, "cpu_percent") ?? 0;
    const avgMemory = avgMetric(history, "memory_percent") ?? 0;
    const failedConnections = sumMetric(history, "connections_failed");
    if (failedConnections > 0 || avgCpu > 85 || avgMemory > 90) return "critical";
    if (avgCpu > 65 || avgMemory > 75) return "warning";
    return "healthy";
  }
  if (family === "sql") {
    const avgCpu = avgMetric(history, "cpu_percent") ?? 0;
    const avgWorkload = avgMetric(history, "workload_percent") ?? 0;
    const failedConnections = sumMetric(history, "connections_failed");
    if (failedConnections > 0 || avgCpu > 85 || avgWorkload > 90) return "critical";
    if (avgCpu > 65 || avgWorkload > 75) return "warning";
    return "healthy";
  }
  const last = history[history.length - 1];
  const values = Object.values(last).filter((value) => typeof value === "number") as number[];
  if (values.length === 0) return "unknown";
  const avg = values.reduce((acc, value) => acc + value, 0) / values.length;
  if (avg > 85) return "critical";
  if (avg > 65) return "warning";
  return "healthy";
}

export default function DatabaseFinopsCmpBoard({ family }: { family: DatabaseFamily }) {
  const t = useTranslations("DatabaseFinopsCmp");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();
  const config = familyConfig(family);

  const [items, setItems] = useState<ResourceRow[]>([]);
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
  const [financialSummary, setFinancialSummary] = useState({
    mtdCost: 0,
    forecastEom: { value: 0, low: 0, high: 0 },
    deltaMoM: { value: 0, percentage: 0 },
    potentialSavings: 0,
  });
  const [efficiency, setEfficiency] = useState({ costPerUsedGb: 0, costPerKOps: 0, underutilizedCount: 0 });
  const [risk, setRisk] = useState({ healthScore: 0, criticalAlerts: 0 });
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

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

      const params = new URLSearchParams({ tenantId, bust: "1" });
      const response = await fetch(`/api/intelligence/databases/${config.endpoint}?${params.toString()}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const body: MetricsResponse = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as any).error || body.message || `HTTP ${response.status}`);

      let subscriptionNameMap = new Map<string, string>();
      if (!isMockTenant(tenantId) && token) {
        try {
          const subRes = await fetch(`/api/subscriptions?tenantId=${encodeURIComponent(tenantId)}`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          });
          const subJson = await subRes.json().catch(() => ({ subscriptions: [] }));
          for (const sub of subJson.subscriptions || []) {
            if (sub?.id) subscriptionNameMap.set(String(sub.id), String(sub.name || sub.id));
          }
        } catch {}
      }

      const mapped = (body.instances || []).map((resource) => {
        const metrics = metricAverage(resource.history);
        const parsed = parseAzureId(resource.id);
        const metricA =
          family === "redis"
            ? redisMetricA(resource.history)
            : metrics.a > 0
              ? String(metrics.a)
              : "N/A";
        const metricB =
          family === "redis"
            ? redisMetricB(resource.history)
            : family === "mysql"
              ? mysqlMetricB(resource.history)
              : family === "sql"
                ? sqlMetricB(resource.history)
            : metrics.b > 0
              ? String(metrics.b)
              : "N/A";
        const finalMetricA =
          family === "mysql"
            ? mysqlMetricA(resource.history)
            : family === "sql"
              ? sqlMetricA(resource.history)
            : metricA;
        return {
          id: resource.id,
          name: resource.name,
          type: resource.type || "database",
          resourceGroup: parsed.resourceGroup,
          subscriptionName: subscriptionNameMap.get(parsed.subscriptionId) || parsed.subscriptionId || "unknown",
          region: resource.region || "unknown",
          state: inferState(resource.history, family),
          sku: resource.sku || "Unknown",
          monthlyCostUsd: Number(resource.monthlyCostUsd || 0),
          metricA: finalMetricA,
          metricB,
        };
      });

      setItems(mapped);
      setFinancialSummary(body.financialSummary || {
        mtdCost: mapped.reduce((acc, item) => acc + item.monthlyCostUsd, 0),
        forecastEom: { value: 0, low: 0, high: 0 },
        deltaMoM: { value: 0, percentage: 0 },
        potentialSavings: 0,
      });
      setEfficiency(body.efficiency || { costPerUsedGb: 0, costPerKOps: 0, underutilizedCount: 0 });
      setRisk(body.risk || { healthScore: 0, criticalAlerts: 0 });
      setRecommendations(body.recommendations || []);
      setLastUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTenant, accounts, instance, config.endpoint, t]);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const resourceOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...items.map((item) => item.name).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
  ], [items, t]);
  const regionOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...items.map((item) => item.region || "unknown").filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
  ], [items, t]);
  const typeOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...items.map((item) => item.type || "database").filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
  ], [items, t]);
  const resourceGroupOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...items.map((item) => item.resourceGroup || "unknown").filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
  ], [items, t]);
  const sortOptions = useMemo<FinopsTableOption[]>(() => [
    { value: "name-asc", label: t("sortAz") },
    { value: "name-desc", label: t("sortZa") },
    { value: "cost-desc", label: t("sortCostDesc") },
    { value: "cost-asc", label: t("sortCostAsc") },
  ], [t]);

  const filteredItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (resourceFilter !== FILTER_ALL && item.name !== resourceFilter) return false;
      if (regionFilter !== FILTER_ALL && item.region !== regionFilter) return false;
      if (typeFilter !== FILTER_ALL && item.type !== typeFilter) return false;
      if (resourceGroupFilter !== FILTER_ALL && item.resourceGroup !== resourceGroupFilter) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sortMode === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sortMode === "cost-desc") sorted.sort((a, b) => b.monthlyCostUsd - a.monthlyCostUsd);
    if (sortMode === "cost-asc") sorted.sort((a, b) => a.monthlyCostUsd - b.monthlyCostUsd);
    return sorted;
  }, [items, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);

  useEffect(() => {
    if (!selectedResourceId || !filteredItems.some((item) => item.id === selectedResourceId)) {
      setSelectedResourceId(filteredItems[0]?.id || "");
    }
  }, [filteredItems, selectedResourceId]);

  const selected = useMemo(
    () => filteredItems.find((item) => item.id === selectedResourceId) || null,
    [filteredItems, selectedResourceId]
  );

  const derived = useMemo(() => {
    const costs = filteredItems.map((item) => item.monthlyCostUsd || 0);
    const mtdCost = round2(financialSummary.mtdCost || costs.reduce((acc, value) => acc + value, 0));
    const forecastValue = financialSummary.forecastEom?.value || mtdCost;
    const robustForecast = forecastRobust(forecastValue, costs);
    const deltaValue = round2(financialSummary.deltaMoM?.value || 0);
    const deltaPct = round2(financialSummary.deltaMoM?.percentage || 0);

    const recommendationsNormalized = recommendations
      .map((rec) => ({
        ...rec,
        title: rec.title || t("defaultRecommendation"),
      }))
      .sort((a, b) => b.monthlySavings - a.monthlySavings)
      .slice(0, 8);

    const potentialSavings = round2(
      Math.max(
        financialSummary.potentialSavings || 0,
        recommendationsNormalized.reduce((acc, rec) => acc + (rec.monthlySavings || 0), 0),
      )
    );

    const byRegion = new Map<string, { count: number; cost: number }>();
    for (const item of filteredItems) {
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
      forecast: robustForecast,
      deltaValue,
      deltaPct,
      potentialSavings,
      efficiency,
      risk,
      recommendations: recommendationsNormalized,
      comparison,
    };
  }, [filteredItems, financialSummary, recommendations, efficiency, risk, t]);

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filteredItems, 15);

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
        <KpiCard title={t("kpiMtdCost")} value={format(derived.mtdCost)} icon={<Wallet className="h-5 w-5 text-sky-600" />} />
        <KpiCard title={t("kpiForecast")} value={format(derived.forecast.value)} subtitle={`${format(derived.forecast.low)} - ${format(derived.forecast.high)}`} icon={<Gauge className="h-5 w-5 text-violet-600" />} />
        <KpiCard title={t("kpiPotentialSavings")} value={format(derived.potentialSavings)} icon={<Coins className="h-5 w-5 text-emerald-600" />} />
        <KpiCard title={t("kpiDelta")} value={`${derived.deltaPct >= 0 ? "+" : ""}${derived.deltaPct.toFixed(2)}%`} subtitle={format(derived.deltaValue)} icon={derived.deltaPct >= 0 ? <ArrowUpRight className="h-5 w-5 text-rose-600" /> : <ArrowDownRight className="h-5 w-5 text-emerald-600" />} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t("kpiResources")} value={String(filteredItems.length)} icon={<CheckCircle2 className="h-5 w-5 text-cyan-600" />} />
        <KpiCard title={t("kpiEfficiency")} value={format(derived.efficiency.costPerUsedGb || 0)} subtitle={t("kpiEfficiencySubtitle")} icon={<Gauge className="h-5 w-5 text-amber-600" />} />
        <KpiCard title={t("kpiUnderutilized")} value={String(derived.efficiency.underutilizedCount || 0)} icon={<Gauge className="h-5 w-5 text-orange-600" />} />
        <KpiCard title={t("kpiHealth")} value={`${(derived.risk.healthScore || 0).toFixed(1)} / 100`} subtitle={t("criticalAlerts", { count: derived.risk.criticalAlerts || 0 })} icon={<ShieldAlert className="h-5 w-5 text-rose-600" />} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("resourceDetailTitle")}</h3>
        <select
          value={selectedResourceId}
          onChange={(e) => setSelectedResourceId(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 hover:border-slate-400"
        >
          {filteredItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.subscriptionName} · {item.region})
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
            <DetailCard label={t(config.metricALabelKey)} value={selected.metricA || t("na")} />
            <DetailCard label={t(config.metricBLabelKey)} value={selected.metricB || t("na")} />
            <DetailCard label={t("detailState")} value={selected.state || t("na")} />
            <DetailCard label={t("detailSku")} value={selected.sku || t("na")} />
            <DetailCard label={t("detailMonthlyCost")} value={format(selected.monthlyCostUsd || 0)} />
            <DetailCard label={t("detailPotentialSaving")} value={format(round2((selected.monthlyCostUsd || 0) * 0.18))} />
          </div>
        ) : (
          <p className="text-sm text-slate-600">{t("noResourceSelected")}</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("allResourcesTitle")}</h3>
        {filteredItems.length === 0 ? (
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
                    <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colMonthlyCost")}</ResizableTh>
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
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{item.metricA || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600">{item.metricB || t("na")}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-900 text-right">{format(item.monthlyCostUsd || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={total} totalPages={totalPages} pageSizes={[15,30,45,60]} />
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
              <article key={`${rec.instanceId}-${index}`} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{rec.title}</p>
                    <p className="text-xs text-slate-500">{rec.instanceId}</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">{format(rec.monthlySavings || 0)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge label={t("riskLabel", { value: t(`risk_${rec.risk}`) })} />
                  <Badge label={t("confidenceLabel", { value: t(`confidence_${rec.confidence}`) })} />
                  <Badge label={t("actionLabel", { value: t(`action_${rec.actionType}`) })} />
                </div>
                <p className="mt-2 text-xs text-slate-600">{t(config.playbookKey)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("comparisonTitle")}</h3>
        {derived.comparison.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noComparisonData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase">{t("colDimension")}</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colResources")}</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colMonthlyCost")}</th>
                  <th className="py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">{t("colAvgCost")}</th>
                </tr>
              </thead>
              <tbody>
                {derived.comparison.map((row) => (
                  <tr key={row.region}>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-700">{row.region}</td>
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

function KpiCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle?: string; icon: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
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

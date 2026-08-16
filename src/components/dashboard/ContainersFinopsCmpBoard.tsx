"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Coins,
  ExternalLink,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import ContainerAppDetailModal from "@/components/ContainerAppDetailModal";
import InfoTooltip from "@/components/InfoTooltip";

type ActionType = "manual" | "guided" | "automatic";
type RiskLevel = "low" | "medium" | "high";
type Confidence = "low" | "medium" | "high";
type ResourceType = "containerapp" | "registry" | "environment";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

interface AppRow {
  name: string;
  resourceGroup: string;
  environment: string;
  cpuCores: number;
  memoryGb: number;
  minReplicas: number;
  maxReplicas: number;
  monthlyCost: number;
  potentialSaving: number;
  scaleToZeroCandidate: boolean;
}

interface RegistryRow {
  name: string;
  resourceGroup: string;
  sku: string;
  location?: string;
  monthlyCost: number;
}

interface EnvironmentRow {
  name: string;
  resourceGroup: string;
  appCount: number;
  location?: string;
  monthlyCost: number;
}

interface ContainersResponse {
  empty?: boolean;
  message?: string;
  totalMonthlyCost?: number;
  totalRegistryMonthlyCost?: number;
  totalEnvironmentMonthlyCost?: number;
  totalContainersMonthlyCost?: number;
  totalPotentialSaving?: number;
  scaleToZeroCandidates?: number;
  appCount?: number;
  registryCount?: number;
  environmentCount?: number;
  apps?: AppRow[];
  registries?: RegistryRow[];
  environments?: EnvironmentRow[];
  selectedSubscriptionName?: string;
  selectedSubscriptionId?: string;
}

interface Recommendation {
  titleKey: string;
  target: string;
  monthlySavings: number;
  risk: RiskLevel;
  confidence: Confidence;
  actionType: ActionType;
  playbookKey: string;
}

interface UnifiedRow {
  id: string;
  type: ResourceType;
  name: string;
  resourceGroup: string;
  region: string;
  subscriptionName: string;
  location?: string;
  monthlyCost: number;
  potentialSaving: number;
  cpuCores?: number;
  memoryGb?: number;
  minReplicas?: number;
  maxReplicas?: number;
  sku?: string;
  appCount?: number;
}

const FILTER_ALL = "__all__";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function forecast(costMtd: number, now: Date) {
  const day = Math.max(1, now.getDate());
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const base = (costMtd / day) * days;
  const band = base * 0.08;
  return {
    value: round2(base),
    low: round2(Math.max(0, base - band)),
    high: round2(base + band),
  };
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

function buildRecommendations(apps: AppRow[], registries: RegistryRow[], environments: EnvironmentRow[]): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const app of apps) {
    if (app.potentialSaving > 0) {
      recs.push({
        titleKey: "recScaleToZero",
        target: `${app.name} (${app.resourceGroup})`,
        monthlySavings: round2(app.potentialSaving),
        risk: "medium",
        confidence: "high",
        actionType: "guided",
        playbookKey: "playbookScaleToZero",
      });
    }
  }

  for (const reg of registries) {
    if (/premium|standard/i.test(reg.sku) && reg.monthlyCost > 0) {
      recs.push({
        titleKey: "recAcrOptimize",
        target: `${reg.name} (${reg.resourceGroup})`,
        monthlySavings: round2(reg.monthlyCost * 0.12),
        risk: "low",
        confidence: "medium",
        actionType: "guided",
        playbookKey: "playbookAcrOptimize",
      });
    }
  }

  for (const env of environments) {
    if (env.appCount <= 1 && env.monthlyCost > 0) {
      recs.push({
        titleKey: "recEnvironmentConsolidation",
        target: `${env.name} (${env.resourceGroup})`,
        monthlySavings: round2(env.monthlyCost * 0.15),
        risk: "medium",
        confidence: "low",
        actionType: "manual",
        playbookKey: "playbookEnvironmentConsolidation",
      });
    }
  }

  return recs.sort((a, b) => b.monthlySavings - a.monthlySavings).slice(0, 8);
}

export function ContainersFinopsCmpBoard() {
  const t = useTranslations("ComputeContainersFinops");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [data, setData] = useState<ContainersResponse | null>(null);
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
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [subscriptionIdForDetail, setSubscriptionIdForDetail] = useState<string>("");
  const [selectedAppForDetail, setSelectedAppForDetail] = useState<{
    subscriptionId: string;
    resourceGroup: string;
    appName: string;
  } | null>(null);

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

      const response = await fetch(
        `/api/intelligence/container-apps?tenantId=${encodeURIComponent(tenantId)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.message || `HTTP ${response.status}`);
      }

      setData(body);
      setSubscriptionIdForDetail(body.selectedSubscriptionId || "");
      setLastUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTenant, accounts, instance, t]);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const derived = useMemo(() => {
    const apps = data?.apps || [];
    const registries = data?.registries || [];
    const environments = data?.environments || [];
    const mtdCost = Number(
      data?.totalContainersMonthlyCost ??
      ((data?.totalMonthlyCost || 0) + (data?.totalRegistryMonthlyCost || 0) + (data?.totalEnvironmentMonthlyCost || 0))
    ) || 0;
    const baselineForecast = forecast(mtdCost, new Date()).value;
    const eom = forecastRobust(baselineForecast, [
      ...apps.map((item) => item.monthlyCost || 0),
      ...registries.map((item) => item.monthlyCost || 0),
      ...environments.map((item) => item.monthlyCost || 0),
    ]);
    const prevMonth = mtdCost * 0.9;
    const delta = mtdCost - prevMonth;
    const deltaPct = prevMonth > 0 ? (delta / prevMonth) * 100 : 0;
    const potentialSavings = Number(data?.totalPotentialSaving || 0);
    const underutilized = apps.filter((a) => a.scaleToZeroCandidate || (a.maxReplicas > 0 && a.minReplicas / Math.max(1, a.maxReplicas) > 0.5)).length;
    const criticalAlerts =
      apps.filter((a) => a.minReplicas >= 1 && a.maxReplicas <= 1).length +
      environments.filter((e) => e.appCount === 0).length;
    const healthScore = Math.max(0, 100 - criticalAlerts * 8);
    const recs = buildRecommendations(apps, registries, environments);
    const costPerApp = apps.length > 0 ? mtdCost / apps.length : 0;
    const costPerEnvironment = environments.length > 0 ? mtdCost / environments.length : 0;

    const unifiedRows: UnifiedRow[] = [
      ...apps.map((a) => ({
        id: `app:${a.resourceGroup}:${a.name}`,
        type: "containerapp" as const,
        name: a.name,
        resourceGroup: a.resourceGroup,
        region: "-",
        subscriptionName: data?.selectedSubscriptionName || "-",
        location: undefined,
        monthlyCost: a.monthlyCost,
        potentialSaving: a.potentialSaving,
        cpuCores: a.cpuCores,
        memoryGb: a.memoryGb,
        minReplicas: a.minReplicas,
        maxReplicas: a.maxReplicas,
      })),
      ...registries.map((r) => ({
        id: `acr:${r.resourceGroup}:${r.name}`,
        type: "registry" as const,
        name: r.name,
        resourceGroup: r.resourceGroup,
        region: r.location || "-",
        subscriptionName: data?.selectedSubscriptionName || "-",
        location: r.location || "-",
        monthlyCost: r.monthlyCost,
        potentialSaving: round2(r.monthlyCost * 0.12),
        sku: r.sku || "-",
      })),
      ...environments.map((e) => ({
        id: `env:${e.resourceGroup}:${e.name}`,
        type: "environment" as const,
        name: e.name,
        resourceGroup: e.resourceGroup,
        region: e.location || "-",
        subscriptionName: data?.selectedSubscriptionName || "-",
        location: e.location || "-",
        monthlyCost: e.monthlyCost,
        potentialSaving: e.appCount <= 1 ? round2(e.monthlyCost * 0.15) : 0,
        appCount: e.appCount,
      })),
    ].sort((a, b) => b.monthlyCost - a.monthlyCost);

    const byResourceGroup = new Map<string, { count: number; cost: number }>();
    for (const row of unifiedRows) {
      const key = row.resourceGroup || "unknown";
      const curr = byResourceGroup.get(key) || { count: 0, cost: 0 };
      curr.count += 1;
      curr.cost += row.monthlyCost || 0;
      byResourceGroup.set(key, curr);
    }
    const comparison = Array.from(byResourceGroup.entries())
      .map(([resourceGroup, info]) => ({
        resourceGroup,
        count: info.count,
        cost: round2(info.cost),
        avgCost: round2(info.cost / Math.max(1, info.count)),
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8);

    return {
      apps,
      registries,
      environments,
      unifiedRows,
      mtdCost: round2(mtdCost),
      forecast: eom,
      deltaValue: round2(delta),
      deltaPct: round2(deltaPct),
      potentialSavings: round2(potentialSavings),
      underutilized,
      criticalAlerts,
      healthScore: round2(healthScore),
      recs,
      costPerApp: round2(costPerApp),
      costPerEnvironment: round2(costPerEnvironment),
      comparison,
    };
  }, [data]);

  const resourceOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...derived.unifiedRows
      .map((row) => row.name)
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ], [derived.unifiedRows, t]);

  const regionOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...derived.unifiedRows
      .map((row) => row.region || "-")
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ], [derived.unifiedRows, t]);

  const typeOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...derived.unifiedRows
      .map((row) => row.type)
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: t(`type_${value}`) })),
  ], [derived.unifiedRows, t]);

  const resourceGroupOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...derived.unifiedRows
      .map((row) => row.resourceGroup || "unknown")
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
  ], [derived.unifiedRows, t]);

  const sortOptions = useMemo<FinopsTableOption[]>(() => [
    { value: "name-asc", label: t("sortAz") },
    { value: "name-desc", label: t("sortZa") },
    { value: "cost-desc", label: t("sortCostDesc") },
    { value: "cost-asc", label: t("sortCostAsc") },
  ], [t]);

  const filteredRows = useMemo(() => {
    const filtered = derived.unifiedRows.filter((row) => {
      if (resourceFilter !== FILTER_ALL && row.name !== resourceFilter) return false;
      if (regionFilter !== FILTER_ALL && (row.region || "-") !== regionFilter) return false;
      if (typeFilter !== FILTER_ALL && row.type !== typeFilter) return false;
      if (resourceGroupFilter !== FILTER_ALL && (row.resourceGroup || "unknown") !== resourceGroupFilter) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortMode === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sortMode === "cost-desc") sorted.sort((a, b) => b.monthlyCost - a.monthlyCost);
    if (sortMode === "cost-asc") sorted.sort((a, b) => a.monthlyCost - b.monthlyCost);
    return sorted;
  }, [derived.unifiedRows, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);

  const filteredComparison = useMemo(() => {
    const byResourceGroup = new Map<string, { count: number; cost: number }>();
    for (const row of filteredRows) {
      const key = row.resourceGroup || "unknown";
      const curr = byResourceGroup.get(key) || { count: 0, cost: 0 };
      curr.count += 1;
      curr.cost += row.monthlyCost || 0;
      byResourceGroup.set(key, curr);
    }
    return Array.from(byResourceGroup.entries())
      .map(([resourceGroup, info]) => ({
        resourceGroup,
        count: info.count,
        cost: round2(info.cost),
        avgCost: round2(info.cost / Math.max(1, info.count)),
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8);
  }, [filteredRows]);

  useEffect(() => {
    if (filteredRows.length === 0) {
      setSelectedResourceId("");
      return;
    }
    if (!filteredRows.some((row) => row.id === selectedResourceId)) {
      setSelectedResourceId(filteredRows[0].id);
    }
  }, [filteredRows, selectedResourceId]);

  const selectedResource = useMemo(
    () => filteredRows.find((r) => r.id === selectedResourceId) || null,
    [filteredRows, selectedResourceId]
  );

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    total,
    totalPages,
    paged,
  } = usePagination(filteredRows, 15);

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
        <KpiCard title={t("kpiForecast")} value={format(derived.forecast.value)} subtitle={`${format(derived.forecast.low)} - ${format(derived.forecast.high)}`} icon={<Gauge className="h-5 w-5 text-violet-600" />} tooltip={t("tooltip_kpi_forecast")} />
        <KpiCard title={t("kpiPotentialSavings")} value={format(derived.potentialSavings)} icon={<Coins className="h-5 w-5 text-emerald-600" />} tooltip={t("tooltip_kpi_potential_savings")} />
        <KpiCard title={t("kpiDelta")} value={`${derived.deltaPct >= 0 ? "+" : ""}${derived.deltaPct.toFixed(2)}%`} subtitle={format(derived.deltaValue)} icon={derived.deltaPct >= 0 ? <ArrowUpRight className="h-5 w-5 text-rose-600" /> : <ArrowDownRight className="h-5 w-5 text-emerald-600" />} tooltip={t("tooltip_kpi_delta")} />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t("kpiCostPerApp")} value={format(derived.costPerApp)} icon={<Boxes className="h-5 w-5 text-indigo-600" />} tooltip={t("tooltip_kpi_cost_per_app")} />
        <KpiCard title={t("kpiCostPerEnvironment")} value={format(derived.costPerEnvironment)} icon={<Gauge className="h-5 w-5 text-amber-600" />} tooltip={t("tooltip_kpi_cost_per_env")} />
        <KpiCard title={t("kpiUnderutilized")} value={String(derived.underutilized)} icon={<CheckCircle2 className="h-5 w-5 text-cyan-600" />} tooltip={t("tooltip_kpi_underutilized")} />
        <KpiCard title={t("kpiHealth")} value={`${derived.healthScore.toFixed(1)} / 100`} subtitle={t("criticalAlerts", { count: derived.criticalAlerts })} icon={<ShieldAlert className="h-5 w-5 text-rose-600" />} tooltip={t("tooltip_kpi_health")} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("resourceDetailTitle")}</h3>
        <select
          value={selectedResourceId}
          onChange={(e) => setSelectedResourceId(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 hover:border-slate-400"
        >
          {filteredRows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} ({row.subscriptionName} · {row.region} · {row.resourceGroup})
            </option>
          ))}
        </select>

        {selectedResource ? (
          <>
            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-5">
              <DetailCard label={t("detailResource")} value={selectedResource.name} />
              <DetailCard label={t("detailRegion")} value={selectedResource.region || "-"} />
              <DetailCard label={t("detailSubscription")} value={selectedResource.subscriptionName || "-"} />
              <DetailCard label={t("detailType")} value={t(`type_${selectedResource.type}`)} />
              <DetailCard label={t("detailResourceGroup")} value={selectedResource.resourceGroup || "-"} />
            </div>
            {selectedResource.type === "containerapp" && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <DetailCard
                  label={t("detailAppCpuMem")}
                  value={`${selectedResource.cpuCores ?? "-"} / ${selectedResource.memoryGb ?? "-"} GiB`}
                />
                <DetailCard
                  label={t("detailAppReplicas")}
                  value={`${selectedResource.minReplicas ?? "-"} - ${selectedResource.maxReplicas ?? "-"}`}
                />
                <DetailCard label={t("detailAppMonthlyCost")} value={format(selectedResource.monthlyCost)} />
                <DetailCard label={t("detailAppPotentialSaving")} value={format(selectedResource.potentialSaving)} />
              </div>
            )}
            {selectedResource.type === "registry" && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <DetailCard label={t("detailRegistryName")} value={selectedResource.name} />
                <DetailCard label={t("detailRegistrySku")} value={selectedResource.sku || "-"} />
                <DetailCard label={t("detailRegistryLocation")} value={selectedResource.location || "-"} />
                <DetailCard label={t("detailRegistryMonthlyCost")} value={format(selectedResource.monthlyCost)} />
              </div>
            )}
            {selectedResource.type === "environment" && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <DetailCard label={t("detailEnvironmentName")} value={selectedResource.name} />
                <DetailCard label={t("detailEnvironmentApps")} value={String(selectedResource.appCount ?? 0)} />
                <DetailCard label={t("detailEnvironmentLocation")} value={selectedResource.location || "-"} />
                <DetailCard label={t("detailEnvironmentMonthlyCost")} value={format(selectedResource.monthlyCost)} />
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600">{t("noResourceSelected")}</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("allResourcesTitle")}</h3>
        {filteredRows.length === 0 ? (
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
                    <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">
                      <span className="inline-flex items-center justify-end gap-1">
                        {t("colMonthlyCost")}
                        <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
                      </span>
                    </ResizableTh>
                    <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">
                      <span className="inline-flex items-center justify-end gap-1">
                        {t("colPotentialSaving")}
                        <InfoTooltip content={t("tooltip_col_potential_saving")} position="bottom" align="right" />
                      </span>
                    </ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row) => (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        row.type === "containerapp"
                          ? "cursor-pointer hover:bg-blue-50"
                          : "hover:bg-slate-50"
                      }`}
                      onClick={() => {
                        if (row.type === "containerapp") {
                          setSelectedAppForDetail({
                            subscriptionId: subscriptionIdForDetail,
                            resourceGroup: row.resourceGroup,
                            appName: row.name,
                          });
                          setIsDetailModalOpen(true);
                        }
                      }}
                    >
                      <td className="py-3 px-4 border-b border-slate-100 font-medium text-sm text-slate-900 whitespace-normal break-words">
                        <div className="flex items-center gap-2">
                          <span>{row.name}</span>
                          {row.type === "containerapp" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                              <ExternalLink className="h-3 w-3" />
                              {t("clickForDetails")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600 whitespace-normal break-words">{row.region || "-"}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600 whitespace-normal break-words">{row.subscriptionName || "-"}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600 whitespace-normal break-words">{t(`type_${row.type}`)}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-600 whitespace-normal break-words">{row.resourceGroup}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-900 text-right">{format(row.monthlyCost)}</td>
                      <td className="py-3 px-4 border-b border-slate-100 text-sm text-emerald-700 text-right">{format(row.potentialSaving)}</td>
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
            <p className="mt-3 text-xs text-slate-500">{t("clickContainerHint")}</p>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">{t("recommendationsTitle")}</h3>
        {derived.recs.length === 0 ? (
          <p className="text-sm text-slate-600">{t("noRecommendations")}</p>
        ) : (
          <div className="space-y-3">
            {derived.recs.map((rec) => (
              <div key={`${rec.target}-${rec.titleKey}`} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{t(rec.titleKey)}</p>
                    <p className="text-xs text-slate-500">{rec.target}</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-700">{format(rec.monthlySavings)} / {t("perMonth")}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge label={t("riskLabel", { value: t(`risk_${rec.risk}`) })} />
                  <Badge label={t("confidenceLabel", { value: t(`confidence_${rec.confidence}`) })} />
                  <Badge label={t("actionLabel", { value: t(`action_${rec.actionType}`) })} />
                </div>
                <p className="mt-2 text-xs text-slate-600">{t(rec.playbookKey)}</p>
              </div>
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
                  <tr key={row.resourceGroup}>
                    <td className="py-3 px-4 border-b border-slate-100 text-sm text-slate-700 whitespace-normal break-words">{row.resourceGroup}</td>
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

      {selectedAppForDetail && (
        <ContainerAppDetailModal
          isOpen={isDetailModalOpen}
          onClose={() => {
            setIsDetailModalOpen(false);
            setSelectedAppForDetail(null);
          }}
          subscriptionId={selectedAppForDetail.subscriptionId}
          resourceGroup={selectedAppForDetail.resourceGroup}
          appName={selectedAppForDetail.appName}
        />
      )}
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon, tooltip }: { title: string; value: string; subtitle?: string; icon: React.ReactNode; tooltip?: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 inline-flex items-center gap-1">
          {title}
          {tooltip && <InfoTooltip content={tooltip} position="bottom" align="left" />}
        </p>
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

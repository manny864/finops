"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconRotateClockwise,
  IconServer,
  IconCpu,
  IconCoins,
  IconShieldCheck,
  IconAlertTriangle,
  IconSparkles,
  IconArrowsSplit,
  IconCloudUpload,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useTextoDeRecomendacion } from "@/lib/computeRecommendationText";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import type { VmssWorkloadItem, VmssRemediationAction } from "@/lib/computeWorkloadTypes";
import InfoTooltip from "@/components/InfoTooltip";
import VmssRemediationModal from "@/components/dashboard/VmssRemediationModal";
import { errorMessage } from '@/lib/apiErrors';
import { forecastMonthEnd, forecastRange } from "@/lib/costAccrual";

interface WorkloadsResponse {
  ok?: boolean;
  data?: {
    summary?: {
      resourceCount?: number;
      totalMonthlyCostUsd?: number;
      advisorRecommendations?: number;
    };
    items?: VmssWorkloadItem[];
  };
  message?: string;
}

const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

function round2(value: number) {
  return Math.round(value * 100) / 100;
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

export default function VmssFinopsCmpBoard() {
  const t = useTranslations("VmssFinopsCmp");
  const { titulo: tituloDeAccion, descripcion: descripcionDeAccion } = useTextoDeRecomendacion();
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WorkloadsResponse["data"] | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");

  // Filters & Sorting state
  const [selectedResource, setSelectedResource] = useState(FILTER_ALL);
  const [selectedRegion, setSelectedRegion] = useState(FILTER_ALL);
  const [selectedType, setSelectedType] = useState(FILTER_ALL);
  const [selectedResourceGroup, setSelectedResourceGroup] = useState(FILTER_ALL);
  const [selectedSort, setSelectedSort] = useState<SortMode>("cost-desc");

  // Remediation Modal state
  const [activeModalAction, setActiveModalAction] = useState<VmssRemediationAction | null>(null);
  const [activeModalResourceName, setActiveModalResourceName] = useState("");

  const fetchData = useCallback(async () => {
    if (!selectedTenant || selectedTenant.id === "default") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let headers: HeadersInit = {};
      if (accounts.length > 0 && !isMockTenant(selectedTenant.id)) {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers = { Authorization: `Bearer ${idToken}` };
      }
      const res = await fetch(
        `/api/intelligence/compute/workloads?tenantId=${encodeURIComponent(selectedTenant.id)}&family=vmss`,
        { headers }
      );
      if (!res.ok) throw new Error(t("errorFetch"));
      const json: WorkloadsResponse = await res.json();
      if (json.ok && json.data) {
        setData(json.data);
      } else {
        setError(json.message || t("errorUnknown"));
      }
    } catch (e) {
      setError(errorMessage(e) || t("errorUnknown"));
    } finally {
      setLoading(false);
    }
  }, [selectedTenant?.id, accounts.length, instance, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const items = useMemo(() => data?.items || [], [data?.items]);

  useEffect(() => {
    if (items.length > 0 && !selectedResourceId) {
      setSelectedResourceId(items[0].id);
    }
  }, [items, selectedResourceId]);

  const selected = useMemo(
    () => items.find((it) => it.id === selectedResourceId) || items[0] || null,
    [items, selectedResourceId]
  );

  // Filter options
  const resourceOptions: FinopsTableOption[] = useMemo(() => {
    const set = new Set(items.map((i) => i.name));
    return [
      { value: FILTER_ALL, label: t("filterAllResources") },
      ...Array.from(set).map((n) => ({ value: n, label: n })),
    ];
  }, [items, t]);

  const regionOptions: FinopsTableOption[] = useMemo(() => {
    const set = new Set(items.map((i) => i.region));
    return [
      { value: FILTER_ALL, label: t("filterAllRegions") },
      ...Array.from(set).map((r) => ({ value: r, label: r })),
    ];
  }, [items, t]);

  const typeOptions: FinopsTableOption[] = useMemo(() => {
    const set = new Set(items.map((i) => i.sku));
    return [
      { value: FILTER_ALL, label: t("filterAllSkus") },
      ...Array.from(set).map((s) => ({ value: s, label: s })),
    ];
  }, [items, t]);

  const resourceGroupOptions: FinopsTableOption[] = useMemo(() => {
    const set = new Set(items.map((i) => i.resourceGroup));
    return [
      { value: FILTER_ALL, label: t("filterAllResourceGroups") },
      ...Array.from(set).map((rg) => ({ value: rg, label: rg })),
    ];
  }, [items, t]);

  const sortOptions: FinopsTableOption[] = [
    { value: "cost-desc", label: t("sortCostDesc") },
    { value: "cost-asc", label: t("sortCostAsc") },
    { value: "name-asc", label: t("sortNameAsc") },
    { value: "name-desc", label: t("sortNameDesc") },
  ];

  // Filtering & Sorting
  const filteredSortedItems = useMemo(() => {
    let result = [...items];
    if (selectedResource !== FILTER_ALL) {
      result = result.filter((i) => i.name === selectedResource);
    }
    if (selectedRegion !== FILTER_ALL) {
      result = result.filter((i) => i.region === selectedRegion);
    }
    if (selectedType !== FILTER_ALL) {
      result = result.filter((i) => i.sku === selectedType);
    }
    if (selectedResourceGroup !== FILTER_ALL) {
      result = result.filter((i) => i.resourceGroup === selectedResourceGroup);
    }

    result.sort((a, b) => {
      switch (selectedSort) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "cost-asc":
          return (a.monthlyCostUsd || 0) - (b.monthlyCostUsd || 0);
        case "cost-desc":
        default:
          return (b.monthlyCostUsd || 0) - (a.monthlyCostUsd || 0);
      }
    });

    return result;
  }, [items, selectedResource, selectedRegion, selectedType, selectedResourceGroup, selectedSort]);

  // Aggregated KPIs
  const totalMtd = useMemo(
    () => items.reduce((acc, i) => acc + (i.monthlyCostUsd || 0), 0),
    [items]
  );
  const now = useMemo(() => new Date(), []);
  const forecastData = useMemo(() => forecast(totalMtd, now), [totalMtd, now]);

  const totalInstances = useMemo(
    () => items.reduce((acc, i) => acc + (i.capacity || 0), 0),
    [items]
  );
  const maxPoolCapacity = useMemo(
    () => items.reduce((acc, i) => acc + (i.maxCapacity || i.capacity || 0), 0),
    [items]
  );

  const totalPotentialSavings = useMemo(() => {
    return items.reduce((acc, i) => {
      const actionsTotal = (i.remediationActions || []).reduce(
        (sum, a) => sum + a.monthlySavingsUsd,
        0
      );
      return acc + (actionsTotal > 0 ? actionsTotal : (i.potentialSavingUsd || 0));
    }, 0);
  }, [items]);

  // All prioritized recommendations
  const allRecommendations = useMemo(() => {
    const list: Array<{ resource: VmssWorkloadItem; action: VmssRemediationAction }> = [];
    items.forEach((item) => {
      (item.remediationActions || []).forEach((action) => {
        list.push({ resource: item, action });
      });
    });
    return list.sort((a, b) => b.action.monthlySavingsUsd - a.action.monthlySavingsUsd);
  }, [items]);

  // Regional distribution comparison
  const regionalComparison = useMemo(() => {
    const map = new Map<string, { region: string; count: number; cost: number; instances: number }>();
    items.forEach((i) => {
      const r = i.region || "unknown";
      const curr = map.get(r) || { region: r, count: 0, cost: 0, instances: 0 };
      curr.count += 1;
      curr.cost += i.monthlyCostUsd || 0;
      curr.instances += i.capacity || 0;
      map.set(r, curr);
    });
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [items]);

  const { paged, page, setPage, pageSize, setPageSize, total, totalPages } = usePagination(
    filteredSortedItems,
    15
  );

  if (loading) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3">
        <IconRotateClockwise className="h-8 w-8 animate-spin text-[#0054A6]" />
        <p className="text-sm font-medium text-slate-500">{t("loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
        <div className="flex items-center gap-2 font-semibold">
          <IconAlertTriangle className="h-5 w-5" />
          <span>{t("errorTitle")}</span>
        </div>
        <p className="mt-1 text-sm">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 dark:bg-slate-900"
        >
          <IconRotateClockwise className="h-3.5 w-3.5" />
          {t("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* FinOps Controls / Filters (Regla #19: Ubicación obligatoria de filtros debajo del título) */}
      <FinopsTableControls
        resourceOptions={resourceOptions}
        regionOptions={regionOptions}
        typeOptions={typeOptions}
        resourceGroupOptions={resourceGroupOptions}
        sortOptions={sortOptions}
        selectedResource={selectedResource}
        selectedRegion={selectedRegion}
        selectedType={selectedType}
        selectedResourceGroup={selectedResourceGroup}
        selectedSort={selectedSort}
        onResourceChange={setSelectedResource}
        onRegionChange={setSelectedRegion}
        onTypeChange={setSelectedType}
        onResourceGroupChange={setSelectedResourceGroup}
        onSortChange={(val) => setSelectedSort(val as SortMode)}
        labels={{
          resource: t("filterResourceLabel"),
          region: t("filterRegionLabel"),
          type: t("filterSkuLabel"),
          resourceGroup: t("filterResourceGroupLabel"),
          sort: t("filterSortLabel"),
        }}
      />

      {/* KPI Cards (Regla #20 & #22) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t("kpiCostMtdTitle")}
          value={format(totalMtd)}
          subtitle={t("kpiCostMtdSubtitle")}
          icon={<IconCoins className="h-5 w-5 text-[#0054A6]" />}
          tooltip={t("tooltip_kpi_cost_mtd")}
        />
        <KpiCard
          title={t("kpiForecastTitle")}
          value={format(forecastData.value)}
          subtitle={t("kpiForecastRange", {
            low: format(forecastData.low),
            high: format(forecastData.high),
          })}
          icon={<IconCloudUpload className="h-5 w-5 text-[#00AEEF]" />}
          tooltip={t("tooltip_kpi_forecast")}
        />
        <KpiCard
          title={t("kpiInstancesTitle")}
          value={`${totalInstances} / ${maxPoolCapacity}`}
          subtitle={t("kpiInstancesSubtitle", { sets: items.length })}
          icon={<IconServer className="h-5 w-5 text-[#8B5CF6]" />}
          tooltip={t("tooltip_kpi_instances")}
        />
        <KpiCard
          title={t("kpiSavingsTitle")}
          value={format(totalPotentialSavings)}
          subtitle={t("kpiSavingsSubtitle")}
          icon={<IconSparkles className="h-5 w-5 text-[#10B981]" />}
          tooltip={t("tooltip_kpi_savings")}
        />
      </div>

      {/* Detalle por Recurso (3 Columnas Funcionales: Identidad/Red, Capacidad/Elasticidad, Métricas/FinOps) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {t("resourceDetailTitle")}
            </h3>
            <InfoTooltip content={t("tooltip_resource_detail")} position="bottom" align="left" />
          </div>
          {items.length > 1 && (
            <select
              value={selectedResourceId}
              onChange={(e) => setSelectedResourceId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 shadow-sm focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} ({it.sku} · {it.region})
                </option>
              ))}
            </select>
          )}
        </div>

        {selected ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Columna 1: Identidad & Red */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/75 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
                <IconServer className="h-4 w-4 text-[#0054A6]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {t("col1Title")}
                </h4>
              </div>
              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelResource")}:</dt>
                  <dd className="font-semibold text-slate-900 dark:text-white">{selected.name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelRegionZones")}:</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">
                    {selected.region} {selected.zones && selected.zones.length > 0 ? `(Zonas ${selected.zones.join(",")})` : "(Regional)"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelSubscription")}:</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[180px]" title={selected.subscriptionName}>
                    {selected.subscriptionName || t("na")}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelResourceGroup")}:</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">{selected.resourceGroup}</dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelState")}:</dt>
                  <dd>
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-bold uppercase text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      {selected.state || "Running"}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>

            {/* Columna 2: Capacidad & Elasticidad */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/75 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
                <IconArrowsSplit className="h-4 w-4 text-[#00AEEF]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {t("col2Title")}
                </h4>
              </div>
              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelInstances")}:</dt>
                  <dd className="font-bold text-slate-900 dark:text-white">
                    {t("capacityLine", { n: selected.capacity, active: t("activeWord"), min: selected.minCapacity, max: selected.maxCapacity })}
                  </dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelAutoscale")}:</dt>
                  <dd>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold text-[10px] ${
                      selected.autoscaleMode === "metric"
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                        : selected.autoscaleMode === "schedule"
                        ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                        : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                    }`}>
                      {selected.autoscaleMode === "metric" ? t("autoscaleMetric") : selected.autoscaleMode === "schedule" ? t("autoscaleSchedule") : t("autoscaleManual")}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelOrchestration")}:</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">{selected.orchestrationMode || "Uniform"}</dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelPriority")}:</dt>
                  <dd>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-bold uppercase text-[10px] ${
                      selected.priority === "Spot"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                    }`}>
                      {selected.priority || "Regular"} {selected.priority === "Spot" ? "(100% Spot)" : "(0% Spot)"}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelOsDisk")}:</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">{selected.osDiskType || "Premium_LRS"}</dd>
                </div>
              </dl>
            </div>

            {/* Columna 3: Métricas & FinOps */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/75 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
                <IconCpu className="h-4 w-4 text-[#10B981]" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {t("col3Title")}
                </h4>
              </div>
              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelCpuAvgMax")}:</dt>
                  <dd className="font-bold text-slate-900 dark:text-white">
                    {selected.cpuAvg !== undefined ? `${selected.cpuAvg}%` : selected.metricA || "N/A"} / {selected.cpuMax !== undefined ? `${selected.cpuMax}%` : "N/A"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelIopsFlows")}:</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">
                    {selected.iops !== undefined ? `${selected.iops} ops/s` : `${selected.metricB || "N/A"} ops/s`}
                  </dd>
                </div>
                <div className="flex justify-between items-center">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelAhub")}:</dt>
                  <dd>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold text-[10px] ${
                      selected.ahubActive
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                    }`}>
                      {selected.ahubActive ? `${selected.licenseType} (Activo)` : t("ahubDisabled")}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelMonthlyCost")}:</dt>
                  <dd className="font-bold text-slate-900 dark:text-white">{format(selected.monthlyCostUsd || 0)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">{t("labelPotentialSaving")}:</dt>
                  <dd className="font-bold text-emerald-600 dark:text-emerald-400">
                    {format(selected.potentialSavingUsd || round2((selected.monthlyCostUsd || 0) * 0.25))}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t("noResourceSelected")}</p>
        )}
      </section>

      {/* Recomendaciones Priorizadas (Resolutiva con Botones de Remediación y Playbooks) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {t("recommendationsTitle")}
            </h3>
            <InfoTooltip content={t("tooltip_recommendations")} position="bottom" align="left" />
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            {allRecommendations.length} {t("activeRecommendations")}
          </span>
        </div>

        {allRecommendations.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
            <IconShieldCheck className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
            <p>{t("noRecommendations")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {allRecommendations.map(({ resource, action }) => (
              <div
                key={action.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-[#0054A6]/40 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-[#0054A6] dark:bg-blue-900/30 dark:text-blue-400">
                        <IconSparkles className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{tituloDeAccion(action)}</h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{resource.name} ({resource.sku})</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      +{format(action.monthlySavingsUsd)}/m
                    </span>
                  </div>

                  <p className="mt-2.5 text-xs text-slate-600 leading-relaxed dark:text-slate-300">
                    {descripcionDeAccion(action)}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {t("risk")}: {action.risk}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {t("confidence")}: {action.confidence}
                    </span>
                  </div>
                </div>

                {/* Botón de acción resolutivo (Regla #21: fondo blanco, borde y texto #0054A6) */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    onClick={() => {
                      setActiveModalAction(action);
                      setActiveModalResourceName(resource.name);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] bg-white px-3 py-1.5 text-xs font-semibold text-[#0054A6] shadow-sm transition-all hover:bg-blue-50/50 dark:bg-slate-900 dark:text-blue-400 dark:border-blue-400 dark:hover:bg-slate-800"
                  >
                    <IconSparkles className="h-3.5 w-3.5" />
                    {action.type === "rightsizing"
                      ? t("btnActionRightsizing")
                      : action.type === "autoscale"
                      ? t("btnActionAutoscale")
                      : action.type === "spot"
                      ? t("btnActionSpot")
                      : action.type === "ahub"
                      ? t("btnActionAhub")
                      : t("btnActionOsDisk")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tabla CMP Completa de Recursos (Regla #19: Columnas obligatorias, sort, paginación 15/30/45/60, full-width) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {t("allResourcesTitle")}
            </h3>
            <InfoTooltip content={t("tooltip_all_resources")} position="bottom" align="left" />
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {filteredSortedItems.length} {t("resourcesCount")}
          </span>
        </div>

        {filteredSortedItems.length === 0 ? (
          <p className="text-sm text-slate-500">{t("noResourcesFound")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-full table-fixed text-left border-collapse">
                <thead>
                  <tr>
                    <ResizableTh minWidth={180} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center gap-1">
                        <span>{t("colResource")}</span>
                        <InfoTooltip content={t("tooltip_col_resource")} position="bottom" align="left" />
                      </div>
                    </ResizableTh>
                    <ResizableTh minWidth={130} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center gap-1">
                        <span>{t("colRegion")}</span>
                        <InfoTooltip content={t("tooltip_col_region")} position="bottom" align="left" />
                      </div>
                    </ResizableTh>
                    <ResizableTh minWidth={180} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center gap-1">
                        <span>{t("colSubscription")}</span>
                        <InfoTooltip content={t("tooltip_col_subscription")} position="bottom" align="left" />
                      </div>
                    </ResizableTh>
                    <ResizableTh minWidth={150} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center gap-1">
                        <span>{t("colType")}</span>
                        <InfoTooltip content={t("tooltip_col_type")} position="bottom" align="left" />
                      </div>
                    </ResizableTh>
                    <ResizableTh minWidth={160} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center gap-1">
                        <span>{t("colResourceGroup")}</span>
                        <InfoTooltip content={t("tooltip_col_resource_group")} position="bottom" align="left" />
                      </div>
                    </ResizableTh>
                    <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center gap-1">
                        <span>{t("colCapacity")}</span>
                        <InfoTooltip content={t("tooltip_col_capacity")} position="bottom" align="left" />
                      </div>
                    </ResizableTh>
                    <ResizableTh minWidth={130} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center gap-1">
                        <span>{t("colAutoscale")}</span>
                        <InfoTooltip content={t("tooltip_col_autoscale")} position="bottom" align="left" />
                      </div>
                    </ResizableTh>
                    <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center gap-1">
                        <span>{t("colCpu")}</span>
                        <InfoTooltip content={t("tooltip_col_cpu")} position="bottom" align="left" />
                      </div>
                    </ResizableTh>
                    <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right dark:bg-slate-900 dark:border-slate-700">
                      <div className="inline-flex items-center justify-end gap-1 w-full">
                        <span>{t("colMonthlyCost")}</span>
                        <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
                      </div>
                    </ResizableTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paged.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedResourceId(item.id)}
                      className={`cursor-pointer transition-colors ${
                        item.id === selectedResourceId
                          ? "bg-blue-50/50 dark:bg-blue-950/20"
                          : "hover:bg-slate-50/75 dark:hover:bg-slate-800/50"
                      }`}
                    >
                      <td className="py-3 px-4 text-sm font-semibold text-slate-900 dark:text-white break-words">
                        {item.name}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300 break-words">
                        {item.region}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300 break-words" title={item.subscriptionName}>
                        {item.subscriptionName || t("na")}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300">
                        <span className="font-mono text-xs">{item.sku}</span>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300 break-words">
                        {item.resourceGroup}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium text-slate-800 dark:text-slate-200">
                        {item.capacity} ({item.minCapacity}-{item.maxCapacity})
                      </td>
                      <td className="py-3 px-4 text-sm">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.autoscaleMode === "metric"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            : item.autoscaleMode === "schedule"
                            ? "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}>
                          {item.autoscaleMode === "metric" ? "Métricas" : item.autoscaleMode === "schedule" ? "Calendario" : "Manual"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-700 dark:text-slate-300">
                        {item.cpuAvg !== undefined ? `${item.cpuAvg}%` : item.metricA || "N/A"}
                      </td>
                      <td className="py-3 px-4 text-sm font-semibold text-slate-900 text-right dark:text-white">
                        {format(item.monthlyCostUsd || 0)}
                      </td>
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

      {/* Comparativa Regional */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {t("comparisonTitle")}
            </h3>
            <InfoTooltip content={t("tooltip_comparison")} position="bottom" align="left" />
          </div>
        </div>
        {regionalComparison.length === 0 ? (
          <p className="text-sm text-slate-500">{t("noComparisonData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-full table-fixed text-left border-collapse">
              <thead>
                <tr>
                  <ResizableTh minWidth={160} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    {t("colDimension")}
                  </ResizableTh>
                  <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right dark:bg-slate-900 dark:border-slate-700">
                    {t("colScaleSetsCount")}
                  </ResizableTh>
                  <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right dark:bg-slate-900 dark:border-slate-700">
                    {t("colTotalInstances")}
                  </ResizableTh>
                  <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center justify-end gap-1 w-full">
                      <span>{t("colMonthlyCost")}</span>
                      <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
                    </div>
                  </ResizableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {regionalComparison.map((row) => (
                  <tr key={row.region} className="hover:bg-slate-50/75 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-slate-800 dark:text-slate-200">{row.region}</td>
                    <td className="py-3 px-4 text-sm text-right text-slate-600 dark:text-slate-400">{row.count}</td>
                    <td className="py-3 px-4 text-sm text-right text-slate-600 dark:text-slate-400">{row.instances}</td>
                    <td className="py-3 px-4 text-sm font-semibold text-right text-slate-900 dark:text-white">{format(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal de Remediación Resolutiva */}
      <VmssRemediationModal
        isOpen={Boolean(activeModalAction)}
        onClose={() => setActiveModalAction(null)}
        action={activeModalAction}
        resourceName={activeModalResourceName}
      />
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon,
  tooltip,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-start justify-between">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span>{title}</span>
          {tooltip && <InfoTooltip content={tooltip} position="bottom" align="left" />}
        </div>
        {icon}
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </article>
  );
}

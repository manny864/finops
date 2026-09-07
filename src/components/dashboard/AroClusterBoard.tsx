"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  IconRefresh,
  IconServer2,
  IconSparkles,
  IconSearch,
  IconWorld,
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconDatabase,
  IconStack2,
  IconLock,
  IconLockOpen,
  IconGauge,
  IconCopy,
  IconCheck,
  IconX,
  IconCode,
  IconLayersSubtract,
  IconTerminal2,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import VmRemediationModal from "@/components/dashboard/VmRemediationModal";
import {
  generateMachineAutoscalerYaml,
  getManagedRgResourceList,
} from "@/lib/aroUtils";
import type {
  AroClusterDetail,
  AroWorkloadItem,
  AroRemediationAction,
  RemediationAction,
  ComputeWorkloadApiResponse,
  AroManagedRgResource,
} from "@/lib/computeWorkloadTypes";
import { errorMessage } from '@/lib/apiErrors';

export default function AroClusterBoard() {
  const t = useTranslations("AroFinopsCmp");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AroClusterDetail[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [justSelected, setJustSelected] = useState(false);
  const detailRef = React.useRef<HTMLDivElement>(null);

  // Modals state
  const [modalAction, setModalAction] = useState<{
    action: RemediationAction;
    resourceName: string;
  } | null>(null);
  const [showManagedRgModal, setShowManagedRgModal] = useState(false);
  const [showAutoscalerModal, setShowAutoscalerModal] = useState(false);
  const [copiedYaml, setCopiedYaml] = useState(false);

  const handleSelectCluster = (id: string) => {
    setSelectedClusterId(id);
    setJustSelected(true);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    setTimeout(() => setJustSelected(false), 900);
  };

  // Filters (estándar CMP: Recurso, Región, Tipo/SKU, Grupo de recursos)
  const [filterResource, setFilterResource] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [filterSku, setFilterSku] = useState("");
  const [filterRg, setFilterRg] = useState("");
  const [sortBy, setSortBy] = useState<"cost_desc" | "cost_asc" | "name_asc" | "name_desc">("cost_desc");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<15 | 30 | 45 | 60>(15);

  const fetchData = async (bustCache = false) => {
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

      const url = `/api/intelligence/compute/workloads?tenantId=${encodeURIComponent(
        selectedTenant.id
      )}&family=aro${bustCache ? "&bust=1" : ""}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error(t("errorUnauthorized") || "No autorizado para consultar este tenant");
        }
        throw new Error(t("errorFetch"));
      }
      const json: ComputeWorkloadApiResponse<AroWorkloadItem> = await res.json();
      if (!json.ok) {
        throw new Error(json.message || t("errorFetch"));
      }
      setData(json.data.items || []);
      if (json.data.items?.length > 0 && !selectedClusterId) {
        setSelectedClusterId(json.data.items[0].id);
      }
    } catch (err) {
      setError(errorMessage(err) || t("errorUnknown"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id, accounts.length, instance]);

  const availableRegions = useMemo(() => Array.from(new Set(data.map((d) => d.region))).filter(Boolean), [data]);
  const availableSkus = useMemo(() => Array.from(new Set(data.map((d) => d.sku))).filter(Boolean), [data]);
  const availableRgs = useMemo(() => Array.from(new Set(data.map((d) => d.resourceGroup))).filter(Boolean), [data]);

  const getClusterMonthlyTotal = (cluster: AroClusterDetail) => {
    return cluster.costBreakdown?.totalCostMonthlyUsd ?? cluster.monthlyCostUsd ?? 0;
  };

  const filteredItems = useMemo(() => {
    return data
      .filter((item) => {
        if (filterResource && !item.name.toLowerCase().includes(filterResource.toLowerCase())) return false;
        if (filterRegion && item.region !== filterRegion) return false;
        if (filterSku && item.sku !== filterSku) return false;
        if (filterRg && item.resourceGroup !== filterRg) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "cost_desc") return getClusterMonthlyTotal(b) - getClusterMonthlyTotal(a);
        if (sortBy === "cost_asc") return getClusterMonthlyTotal(a) - getClusterMonthlyTotal(b);
        if (sortBy === "name_asc") return a.name.localeCompare(b.name);
        if (sortBy === "name_desc") return b.name.localeCompare(a.name);
        return 0;
      });
  }, [data, filterResource, filterRegion, filterSku, filterRg, sortBy]);

  const selectedCluster = useMemo(() => {
    return data.find((d) => d.id === selectedClusterId) || filteredItems[0] || data[0] || null;
  }, [data, selectedClusterId, filteredItems]);

  const totalCostMtd = useMemo(() => data.reduce((acc, c) => acc + getClusterMonthlyTotal(c), 0), [data]);
  const totalComputeCost = useMemo(() => data.reduce((acc, c) => acc + (c.costBreakdown?.computeCostMonthlyUsd || 0), 0), [data]);
  const totalRedHatCost = useMemo(() => data.reduce((acc, c) => acc + (c.costBreakdown?.redHatLicenseCostMonthlyUsd || 0), 0), [data]);
  const totalStorageCost = useMemo(() => data.reduce((acc, c) => acc + (c.costBreakdown?.storageCostMonthlyUsd || 0), 0), [data]);
  const totalWorkerNodes = useMemo(() => data.reduce((acc, c) => acc + (c.totalWorkerCount || 0), 0), [data]);
  const totalMasterNodes = useMemo(() => data.reduce((acc, c) => acc + (c.masterProfile?.count || 0), 0), [data]);
  const totalPotentialSavings = useMemo(() => data.reduce((acc, c) => acc + (c.potentialSavingUsd || 0), 0), [data]);
  const devTestClusterCount = useMemo(() => data.filter((c) => c.isDevTestCandidate).length, [data]);
  const aggregatedRecommendations = useMemo(
    () => data.flatMap((item) => (item.remediationActions || []).map((action) => ({ action, cluster: item }))),
    [data]
  );

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;

  // Manifiesto YAML computado para el clúster seleccionado
  const currentAutoscalerYaml = useMemo(() => {
    if (!selectedCluster) return "";
    const workerName = selectedCluster.workerProfiles?.[0]?.name || "worker";
    const count = selectedCluster.workerProfiles?.[0]?.count || 3;
    return generateMachineAutoscalerYaml(selectedCluster.name, workerName, 1, count);
  }, [selectedCluster]);

  // Lista de recursos en Managed RG para el clúster seleccionado
  const currentManagedRgResources: AroManagedRgResource[] = useMemo(() => {
    if (!selectedCluster) return [];
    if (selectedCluster.managedRgResources && selectedCluster.managedRgResources.length > 0) {
      return selectedCluster.managedRgResources;
    }
    return getManagedRgResourceList(
      selectedCluster.managedResourceGroup || `aro-infra-${selectedCluster.name}`,
      selectedCluster.name,
      selectedCluster.region,
      selectedCluster.masterProfile?.vmSize,
      selectedCluster.workerProfiles?.[0]?.vmSize,
      selectedCluster.totalWorkerCount || 3
    );
  }, [selectedCluster]);

  const handleCopyYaml = () => {
    if (!currentAutoscalerYaml) return;
    navigator.clipboard.writeText(currentAutoscalerYaml);
    setCopiedYaml(true);
    setTimeout(() => setCopiedYaml(false), 2500);
  };

  const renderLifecycleBadge = (version: string, status?: string) => {
    let badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";
    let label = t("lifecycleActive");

    if (status === "extended_support" || (version.startsWith("4.14") || version.startsWith("4.15"))) {
      badgeColor = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800";
      label = t("lifecycleExtended");
    } else if (status === "end_of_life" || version.startsWith("4.13") || version.startsWith("4.12") || version.startsWith("4.11")) {
      badgeColor = "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
      label = t("lifecycleEol");
    }

    return (
      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-bold ${badgeColor}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
        <span>v{version}</span>
        <span>·</span>
        <span>{label}</span>
      </span>
    );
  };

  if (loading && data.length === 0) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Filters Skeleton */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-8 w-full rounded-lg bg-slate-100 dark:bg-slate-800/60" />
              </div>
            ))}
          </div>
        </div>

        {/* KPIs Skeleton */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
              <div className="flex justify-between items-center">
                <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-4 w-4 rounded bg-slate-100 dark:bg-slate-800/50" />
              </div>
              <div className="h-7 w-32 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-3 w-40 rounded bg-slate-100 dark:bg-slate-800/60" />
            </div>
          ))}
        </div>

        {/* Detail Card Skeleton */}
        <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 p-6 space-y-4">
          <div className="flex justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
            <div className="h-5 w-48 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-5 w-24 rounded bg-slate-100 dark:bg-slate-800" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[1, 2, 3].map((col) => (
              <div key={col} className="space-y-3">
                <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((row) => (
                    <div key={row} className="flex justify-between">
                      <div className="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800/60" />
                      <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Table Skeleton */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 space-y-3">
          <div className="h-4 w-36 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 w-full rounded bg-slate-50 dark:bg-slate-800/40" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
        <IconAlertTriangle className="mx-auto h-8 w-8 text-rose-500" />
        <h3 className="mt-2 text-sm font-semibold text-rose-800 dark:text-rose-300">{t("errorTitle")}</h3>
        <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>
        <button
          onClick={() => fetchData(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#0054A6] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 shadow-sm transition-all hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <IconRefresh className="h-4 w-4" />
          {t("retry")}
        </button>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <IconServer2 className="mx-auto h-8 w-8 text-slate-400" />
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("noClusters")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. TOP FILTERS BAR (Regla #19) */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          <div className="relative">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("filterResourceLabel")}
            </label>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder={t("filterAllResources")}
                value={filterResource}
                onChange={(e) => { setFilterResource(e.target.value); setCurrentPage(1); }}
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("filterRegionLabel")}
            </label>
            <select
              value={filterRegion}
              onChange={(e) => { setFilterRegion(e.target.value); setCurrentPage(1); }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">{t("filterAllRegions")}</option>
              {availableRegions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("filterSkuLabel")}
            </label>
            <select
              value={filterSku}
              onChange={(e) => { setFilterSku(e.target.value); setCurrentPage(1); }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">{t("filterAllSkus")}</option>
              {availableSkus.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("filterResourceGroupLabel")}
            </label>
            <select
              value={filterRg}
              onChange={(e) => { setFilterRg(e.target.value); setCurrentPage(1); }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">{t("filterAllResourceGroups")}</option>
              {availableRgs.map((rg) => <option key={rg} value={rg}>{rg}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("filterSortLabel")}
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="cost_desc">{t("sortCostDesc")}</option>
              <option value="cost_asc">{t("sortCostAsc")}</option>
              <option value="name_asc">{t("sortNameAsc")}</option>
              <option value="name_desc">{t("sortNameDesc")}</option>
            </select>
          </div>
        </div>
      </div>

      {/* 2. EXECUTIVE KPIS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <IconServer2 className="h-4 w-4 text-[#0054A6] dark:text-blue-400" />
              <span>{t("kpiCostMtdTitle")}</span>
              <InfoTooltip content={t("tooltip_kpi_cost_mtd")} position="bottom" align="left" />
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{format(totalCostMtd)}</span>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Compute: {format(totalComputeCost)} · RH Fee: {format(totalRedHatCost)} · Storage: {format(totalStorageCost)}
            </p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <IconStack2 className="h-4 w-4 text-[#00AEEF] dark:text-cyan-400" />
              <span>{t("kpiNodesTitle")}</span>
              <InfoTooltip content={t("tooltip_kpi_nodes")} position="bottom" align="left" />
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{totalMasterNodes + totalWorkerNodes} nodos</span>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {totalMasterNodes} master · {totalWorkerNodes} worker
            </p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <IconGauge className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span>{t("kpiClustersTitle")}</span>
              <InfoTooltip content={t("tooltip_kpi_clusters")} position="bottom" align="left" />
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{data.length}</span>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {devTestClusterCount} {t("kpiClustersDevTestSubtitle")}
            </p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-5 shadow-sm transition-all hover:shadow-md dark:border-emerald-900/40 dark:bg-emerald-950/10">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <IconSparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t("kpiSavingsTitle")}</span>
              <InfoTooltip content={t("tooltip_kpi_savings")} position="bottom" align="left" />
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{format(totalPotentialSavings)}</span>
            <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">{t("kpiSavingsSubtitle")}</p>
          </div>
        </div>
      </div>

      {/* 3. DETALLE POR RECURSO (Grid de 3 Columnas: Identidad&Red / Arquitectura&MachineSets / Métricas&FinOps) */}
      {selectedCluster && (
        <div
          ref={detailRef}
          className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow dark:bg-slate-900 ${
            justSelected
              ? "border-[#0054A6] ring-2 ring-[#0054A6]/40 dark:border-blue-400 dark:ring-blue-400/30"
              : "border-slate-200/90 dark:border-slate-800"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 bg-slate-50/75 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex items-center gap-2">
              <IconServer2 className="h-5 w-5 text-[#0054A6] dark:text-blue-400" />
              <h3 className="font-semibold text-slate-900 dark:text-white">{t("resourceDetailTitle")}</h3>
              <InfoTooltip content={t("tooltip_resource_detail")} position="bottom" align="left" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#0054A6] dark:bg-blue-900/30 dark:text-blue-400">
                {selectedCluster.name}
              </span>
              {renderLifecycleBadge(selectedCluster.openshiftVersion, selectedCluster.openShiftLifecycleStatus)}
              {selectedCluster.isDevTestCandidate && (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  Dev/Test
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-slate-100 p-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-800">
            {/* Columna 1: Identidad & Red */}
            <div className="space-y-3 sm:pr-6">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#0054A6] dark:text-blue-400">
                <IconWorld className="h-4 w-4" />
                <span>{t("col1Title")}</span>
              </div>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelResource")}:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{selectedCluster.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelRegionVisibility")}:</span>
                  <span className="inline-flex items-center gap-1 font-medium text-slate-900 dark:text-slate-100">
                    {selectedCluster.apiVisibility === "Private" ? <IconLock className="h-3.5 w-3.5 text-amber-600" /> : <IconLockOpen className="h-3.5 w-3.5 text-emerald-600" />}
                    {selectedCluster.region} ({selectedCluster.apiVisibility})
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelSubscription")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedCluster.subscriptionName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelResourceGroup")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedCluster.resourceGroup}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelProvisioningState")}:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{selectedCluster.provisioningState}</span>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-slate-500 dark:text-slate-400">{t("labelManagedRg")}:</span>
                    <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate max-w-[160px]" title={selectedCluster.managedResourceGroup || ""}>
                      {selectedCluster.managedResourceGroup || "—"}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowManagedRgModal(true)}
                    className="w-full mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#0054A6] bg-white py-1.5 px-2.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 shadow-sm transition-all hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                  >
                    <IconLayersSubtract className="h-3.5 w-3.5" />
                    <span>{t("btnViewManagedRg")}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Columna 2: Arquitectura & MachineSets */}
            <div className="space-y-3 pt-4 sm:px-6 sm:pt-0">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#00AEEF] dark:text-cyan-400">
                <IconStack2 className="h-4 w-4" />
                <span>{t("col2Title")}</span>
              </div>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelControlPlane")}:</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedCluster.masterProfile.count} x {selectedCluster.masterProfile.vmSize}
                  </span>
                </div>
                {selectedCluster.workerProfiles.map((w, i) => (
                  <div className="flex justify-between items-center" key={i}>
                    <span className="text-slate-500 dark:text-slate-400">{t("labelWorkers")} ({w.name}):</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">{w.count} x {w.vmSize}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelAutoscaler")}:</span>
                  <span className={`font-semibold ${selectedCluster.autoscalerActive ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                    {selectedCluster.autoscalerActive
                      ? t("labelAutoscalerActive")
                      : t("labelAutoscalerInactive", { count: selectedCluster.totalWorkerCount })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelStoragePvcs")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {selectedCluster.storagePvcDescription
                      ? selectedCluster.storagePvcDescription
                      : selectedCluster.orphanPvcCount > 0
                      ? `${selectedCluster.orphanPvcCount} ${t("labelOrphanPvcs")}`
                      : t("labelNoOrphanPvcs")}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => setShowAutoscalerModal(true)}
                    className="w-full mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#0054A6] bg-white py-1.5 px-2.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 shadow-sm transition-all hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                  >
                    <IconCode className="h-3.5 w-3.5" />
                    <span>{t("btnGenerateAutoscalerYaml")}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Columna 3: Métricas, FinOps & Licencia */}
            <div className="space-y-3 pt-4 sm:pl-6 sm:pt-0">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                <IconDatabase className="h-4 w-4" />
                <span>{t("col3Title")}</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelCpuAvgMax")}:</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {typeof selectedCluster.cpuAvg === "number"
                      ? `${selectedCluster.cpuAvg}% / ${typeof selectedCluster.cpuMax === "number" ? selectedCluster.cpuMax : (selectedCluster.cpuAvg * 1.4).toFixed(1)}%`
                      : "N/D"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelMemoryUsage")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {typeof selectedCluster.memoryAvgPercent === "number" ? `${selectedCluster.memoryAvgPercent}%` : "N/D"}
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-slate-100 pt-1.5 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelComputeCost")}:</span>
                  <span className="font-bold text-slate-900 dark:text-white">{format(selectedCluster.costBreakdown.computeCostMonthlyUsd)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelRedHatFee")}:</span>
                  <span className="font-bold text-purple-600 dark:text-purple-400">{format(selectedCluster.costBreakdown.redHatLicenseCostMonthlyUsd)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelStorageCost")}:</span>
                  <span className="font-bold text-amber-600 dark:text-amber-400">{format(selectedCluster.costBreakdown.storageCostMonthlyUsd)}</span>
                </div>
                <div className="flex justify-between items-center border-t border-slate-100 pt-1.5 dark:border-slate-800">
                  <span className="font-semibold text-slate-900 dark:text-white">{t("kpiCostMtdTitle")}:</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {format(selectedCluster.costBreakdown.totalCostMonthlyUsd)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">{t("labelPotentialSaving")}:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    +{format(selectedCluster.potentialSavingUsd || 0)}/mes
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. MOTOR DE RECOMENDACIONES PRIORIZADAS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="h-5 w-5 text-[#0054A6] dark:text-blue-400" />
            <h3 className="font-semibold text-slate-900 dark:text-white">{t("recommendationsTitle")}</h3>
            <InfoTooltip content={t("tooltip_recommendations")} position="bottom" align="left" />
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {aggregatedRecommendations.length} {t("activeRecommendations")}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {aggregatedRecommendations.map(({ action, cluster }) => {
            const btnLabels: Record<AroRemediationAction["type"], string> = {
              consolidate_cluster: t("btnActionConsolidate"),
              rightsizing_workers: t("btnActionResize"),
              enable_autoscaler: t("btnGenerateAutoscalerYaml"),
              savings_plan: t("btnActionSavingsPlan"),
              orphan_pvc: t("btnActionOrphanPvc"),
            };
            return (
              <div
                key={`${cluster.id}-${action.id}`}
                className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition-all hover:border-[#0054A6] hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {cluster.name} ({cluster.region})
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      +{format(action.monthlySavingsUsd)}/mes
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{action.title}</h4>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{action.description}</p>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Riesgo: <span className="uppercase text-emerald-600 dark:text-emerald-400 font-bold">{action.risk}</span>
                  </span>
                  <button
                    onClick={() => {
                      if (action.type === "enable_autoscaler") {
                        setSelectedClusterId(cluster.id);
                        setShowAutoscalerModal(true);
                      } else {
                        setModalAction({ action, resourceName: cluster.name });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] bg-white px-3 py-1.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 shadow-sm transition-all hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                  >
                    <IconSparkles className="h-3.5 w-3.5" />
                    {btnLabels[action.type] || "Optimizar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. TABLA DE RECURSOS CON ESTÁNDAR CMP (Regla #19) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconServer2 className="h-5 w-5 text-[#0054A6] dark:text-blue-400" />
            <h3 className="font-semibold text-slate-900 dark:text-white">{t("allResourcesTitle")}</h3>
            <InfoTooltip content={t("tooltip_all_resources")} position="bottom" align="left" />
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {filteredItems.length} {t("resourcesCount")}
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-900 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-100">
                <tr>
                  <ResizableTh minWidth={220} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <span>{t("colResource")}</span>
                  </ResizableTh>
                  <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <span>{t("colRegion")}</span>
                  </ResizableTh>
                  <ResizableTh minWidth={200} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <span>{t("colSku")}</span>
                  </ResizableTh>
                  <ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <span>{t("colVersion")}</span>
                  </ResizableTh>
                  <ResizableTh minWidth={100} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <span>{t("colCpuAvg")}</span>
                  </ResizableTh>
                  <ResizableTh minWidth={130} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right dark:bg-slate-900 dark:border-slate-700">
                    <span>{t("colMonthlyCost")}</span>
                  </ResizableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedItems.map((item) => {
                  const isSelected = item.id === selectedCluster?.id;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleSelectCluster(item.id)}
                      className={`cursor-pointer transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50 ${isSelected ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <IconServer2 className="h-4 w-4 text-[#0054A6] dark:text-blue-400 shrink-0" />
                          <span className="truncate">{item.name}</span>
                          {item.isDevTestCandidate && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Dev/Test</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.region}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">{item.sku}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {renderLifecycleBadge(item.openshiftVersion, item.openShiftLifecycleStatus)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.metricsAvailable && item.cpuAvg !== null ? `${item.cpuAvg}%` : "N/D"}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">{format(getClusterMonthlyTotal(item))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>{t("pageSizeLabel")}</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value) as 15 | 30 | 45 | 60); setCurrentPage(1); }}
                className="rounded border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
              >
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={45}>45</option>
                <option value={60}>60</option>
              </select>
              <span>{t("pageSizeSuffix")}</span>
            </div>

            <div className="flex items-center gap-2">
              <span>{t("pageOf", { current: currentPage, total: totalPages })}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="rounded border border-slate-200 bg-white p-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
                >
                  <IconChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded border border-slate-200 bg-white p-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
                >
                  <IconChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal 1: Explorador del Managed Resource Group */}
      {showManagedRgModal && selectedCluster && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <div className="flex items-center gap-2.5">
                <IconLayersSubtract className="h-5 w-5 text-[#0054A6] dark:text-blue-400" />
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">{t("modalManagedRgTitle")}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {selectedCluster.managedResourceGroup || `aro-infra-${selectedCluster.name}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowManagedRgModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {t("modalManagedRgSubtitle")}
              </p>

              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                  <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-200">
                    <tr>
                      <th className="py-2.5 px-3.5">{t("managedRgColName")}</th>
                      <th className="py-2.5 px-3.5">{t("managedRgColType")}</th>
                      <th className="py-2.5 px-3.5">{t("managedRgColSku")}</th>
                      <th className="py-2.5 px-3.5">{t("managedRgColStatus")}</th>
                      <th className="py-2.5 px-3.5 text-right">{t("managedRgColCost")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {currentManagedRgResources.map((res, i) => (
                      <tr key={i} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3.5 font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">{res.name}</td>
                        <td className="py-2 px-3.5 text-slate-500 dark:text-slate-400">{res.type}</td>
                        <td className="py-2 px-3.5 font-mono text-[11px]">{res.sku || "—"}</td>
                        <td className="py-2 px-3.5">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            res.category === "master_vm"
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300"
                              : res.category === "worker_vm"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}>
                            {res.status || "Active"}
                          </span>
                        </td>
                        <td className="py-2 px-3.5 text-right font-bold text-slate-900 dark:text-white">
                          {typeof res.costMonthlyUsd === "number" ? format(res.costMonthlyUsd) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50/60 px-6 py-3 dark:border-slate-800 dark:bg-slate-800/40 flex justify-end">
              <button
                onClick={() => setShowManagedRgModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {t("modalClose")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Generador de MachineAutoscaler YAML */}
      {showAutoscalerModal && selectedCluster && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <div className="flex items-center gap-2.5">
                <IconCode className="h-5 w-5 text-[#0054A6] dark:text-blue-400" />
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">{t("modalAutoscalerTitle")}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {selectedCluster.name} · OpenShift MachineSet
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAutoscalerModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {t("modalAutoscalerSubtitle")}
              </p>

              <div className="relative rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-emerald-400 shadow-inner">
                <button
                  onClick={handleCopyYaml}
                  className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 transition-colors"
                >
                  {copiedYaml ? (
                    <>
                      <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">{t("yamlCopied")}</span>
                    </>
                  ) : (
                    <>
                      <IconCopy className="h-3.5 w-3.5" />
                      <span>{t("copyYamlButton")}</span>
                    </>
                  )}
                </button>
                <pre className="overflow-x-auto whitespace-pre leading-relaxed pt-6">
                  {currentAutoscalerYaml}
                </pre>
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 dark:border-blue-900/40 dark:bg-blue-950/20">
                <div className="flex items-center gap-2 mb-1 text-xs font-bold text-[#0054A6] dark:text-blue-400">
                  <IconTerminal2 className="h-4 w-4" />
                  <span>{t("applyWithOcCli")}</span>
                </div>
                <div className="rounded bg-white p-2 font-mono text-[11px] text-slate-800 border border-blue-200 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200">
                  oc create -f - &lt;&lt;EOF<br />
                  {currentAutoscalerYaml}<br />
                  EOF
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50/60 px-6 py-3 dark:border-slate-800 dark:bg-slate-800/40 flex justify-end gap-2">
              <button
                onClick={handleCopyYaml}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] bg-white px-4 py-1.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 shadow-sm hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                {copiedYaml ? <IconCheck className="h-4 w-4 text-emerald-600" /> : <IconCopy className="h-4 w-4" />}
                <span>{copiedYaml ? t("yamlCopied") : t("copyYamlButton")}</span>
              </button>
              <button
                onClick={() => setShowAutoscalerModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {t("modalClose")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remediation Modal — handles general actions via RemediationAction */}
      {modalAction && (
        <VmRemediationModal
          isOpen={true}
          onClose={() => setModalAction(null)}
          action={modalAction.action}
          resourceName={modalAction.resourceName}
        />
      )}
    </div>
  );
}

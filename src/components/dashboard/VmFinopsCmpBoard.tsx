"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useTextoDeRecomendacion } from "@/lib/recommendationText";
import {
  IconRefresh,
  IconCpu,
  IconServer2,
  IconSparkles,
  IconSearch,
  IconWorld,
  IconAlertTriangle,
  IconActivity,
  IconChevronLeft,
  IconChevronRight,
  IconDatabase,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import InfoTooltip from "@/components/InfoTooltip";
import ResizableTh from "@/components/ResizableTh";
import VmRemediationModal from "@/components/dashboard/VmRemediationModal";
import type {
  VirtualMachineWorkloadItem,
  VmRemediationAction,
  ComputeWorkloadApiResponse,
} from "@/lib/computeWorkloadTypes";
import { errorMessage } from '@/lib/apiErrors';
import { forecastMonthEnd as computeForecastMonthEnd } from "@/lib/costAccrual";

export default function VmFinopsCmpBoard() {
  const t = useTranslations("VmFinopsCmp");
  const { titulo: tituloDeAccion, descripcion: descripcionDeAccion } = useTextoDeRecomendacion();
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<VirtualMachineWorkloadItem[]>([]);
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [modalAction, setModalAction] = useState<{
    action: VmRemediationAction;
    resourceName: string;
  } | null>(null);

  // Filters
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
      )}&family=vms${bustCache ? "&bust=1" : ""}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error(t("errorUnauthorized") || "No autorizado para consultar este tenant");
        }
        throw new Error(t("errorFetch"));
      }
      const json: ComputeWorkloadApiResponse<VirtualMachineWorkloadItem> = await res.json();
      if (!json.ok) {
        throw new Error(json.message || t("errorFetch"));
      }
      setData(json.data.items || []);
      if (json.data.items?.length > 0 && !selectedVmId) {
        setSelectedVmId(json.data.items[0].id);
      }
    } catch (err) {
      setError(errorMessage(err) || t("errorUnknown"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedTenant?.id, accounts.length, instance]);

  // Unique filter lists
  const availableRegions = useMemo(() => Array.from(new Set(data.map((d) => d.region))).filter(Boolean), [data]);
  const availableSkus = useMemo(() => Array.from(new Set(data.map((d) => d.sku))).filter(Boolean), [data]);
  const availableRgs = useMemo(() => Array.from(new Set(data.map((d) => d.resourceGroup))).filter(Boolean), [data]);

  // Filtered & Sorted items
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
        const costA = a.totalCostMonthlyUsd ?? a.monthlyCostUsd;
        const costB = b.totalCostMonthlyUsd ?? b.monthlyCostUsd;
        if (sortBy === "cost_desc") return costB - costA;
        if (sortBy === "cost_asc") return costA - costB;
        if (sortBy === "name_asc") return a.name.localeCompare(b.name);
        if (sortBy === "name_desc") return b.name.localeCompare(a.name);
        return 0;
      });
  }, [data, filterResource, filterRegion, filterSku, filterRg, sortBy]);

  // Selected item
  const selectedVm = useMemo(() => {
    return data.find((d) => d.id === selectedVmId) || filteredItems[0] || data[0] || null;
  }, [data, selectedVmId, filteredItems]);

  // Aggregated KPIs
  const totalCostMtd = useMemo(() => {
    return data.reduce((acc, curr) => acc + (curr.totalCostMonthlyUsd ?? curr.monthlyCostUsd), 0);
  }, [data]);
  const totalComputeCost = useMemo(() => {
    return data.reduce((acc, curr) => acc + (curr.computeCostMonthlyUsd ?? curr.monthlyCostUsd * 0.75), 0);
  }, [data]);
  const totalStorageCost = useMemo(() => {
    return data.reduce((acc, curr) => acc + (curr.storageCostMonthlyUsd ?? curr.monthlyCostUsd * 0.25), 0);
  }, [data]);
  // Proyección por run-rate del gasto acumulado. Antes era el acumulado
  // por un multiplicador fijo (×1.05), que no dependía de cuántos días
  // del mes quedaban ni del gasto diario real.
  const forecastMonthEnd = useMemo(() => {
    // Se suma el forecast que calcula la API por recurso: ahí se conoce la
    // fecha de creación, y el run-rate de un recurso de horas debe dividirse
    // por esas horas y no por los días transcurridos del mes. Recalcularlo acá
    // sobre el total agregado proyectaba de menos.
    const perResource = data.reduce((acc, curr) => acc + (curr.forecastMonthEndUsd ?? 0), 0);
    return perResource > 0 ? perResource : computeForecastMonthEnd(totalCostMtd, new Date());
  }, [data, totalCostMtd]);
  const totalVcpus = useMemo(() => {
    return data.reduce((acc, curr) => acc + (curr.vCpu || 2), 0);
  }, [data]);
  const totalRamGb = useMemo(() => {
    return data.reduce((acc, curr) => acc + (curr.ramGb || 8), 0);
  }, [data]);
  const runningVmsCount = useMemo(() => {
    return data.filter((d) => d.powerState === "running" || d.state === "running").length;
  }, [data]);
  const deallocatedVmsCount = useMemo(() => {
    return data.filter((d) => d.powerState === "deallocated" || d.state === "deallocated").length;
  }, [data]);
  const totalPotentialSavings = useMemo(() => {
    return data.reduce((acc, curr) => acc + (curr.potentialSavingUsd || 0), 0);
  }, [data]);

  // Regional breakdown
  const regionalDistribution = useMemo(() => {
    const map = new Map<string, { region: string; count: number; running: number; deallocated: number; cost: number }>();
    for (const item of filteredItems) {
      const reg = item.region || "unknown";
      const existing = map.get(reg) || { region: reg, count: 0, running: 0, deallocated: 0, cost: 0 };
      existing.count += 1;
      if (item.powerState === "running" || item.state === "running") existing.running += 1;
      else existing.deallocated += 1;
      existing.cost += item.totalCostMonthlyUsd ?? item.monthlyCostUsd;
      map.set(reg, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [filteredItems]);

  // Pagination slice
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;

  if (loading && data.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0054A6] border-t-transparent"></div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("loading")}</p>
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

  return (
    <div className="space-y-6">
      {/* 1. TOP FILTERS BAR (Regla #19) */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          {/* Recurso / VM */}
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
                onChange={(e) => {
                  setFilterResource(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Región */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("filterRegionLabel")}
            </label>
            <select
              value={filterRegion}
              onChange={(e) => {
                setFilterRegion(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">{t("filterAllRegions")}</option>
              {availableRegions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* SKU / Tamaño */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("filterSkuLabel")}
            </label>
            <select
              value={filterSku}
              onChange={(e) => {
                setFilterSku(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">{t("filterAllSkus")}</option>
              {availableSkus.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Grupo de Recursos */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("filterResourceGroupLabel")}
            </label>
            <select
              value={filterRg}
              onChange={(e) => {
                setFilterRg(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm transition-colors focus:border-[#0054A6] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">{t("filterAllResourceGroups")}</option>
              {availableRgs.map((rg) => (
                <option key={rg} value={rg}>
                  {rg}
                </option>
              ))}
            </select>
          </div>

          {/* Ordenar por */}
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

      {/* 2. EXECUTIVE KPIS (4 Cards con InfoTooltip) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Costo MTD Consolidado */}
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
              Compute: {format(totalComputeCost)} · Storage: {format(totalStorageCost)}
            </p>
          </div>
        </div>

        {/* Forecast Fin de Mes */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <IconActivity className="h-4 w-4 text-[#00AEEF] dark:text-cyan-400" />
              <span>{t("kpiForecastTitle")}</span>
              <InfoTooltip content={t("tooltip_kpi_forecast")} position="bottom" align="left" />
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">{format(forecastMonthEnd)}</span>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {t("kpiForecastRange", { low: format(forecastMonthEnd * 0.9), high: format(forecastMonthEnd * 1.1) })}
            </p>
          </div>
        </div>

        {/* Total vCPUs y RAM Gestionada */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <IconCpu className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span>{t("kpiHardwareTitle")}</span>
              <InfoTooltip content={t("tooltip_kpi_hardware")} position="bottom" align="left" />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{totalVcpus} vCPUs</span>
              <span className="text-xs font-medium text-slate-500">({totalRamGb} GB RAM)</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {runningVmsCount} running · {deallocatedVmsCount} deallocated
            </p>
          </div>
        </div>

        {/* Ahorro Potencial Total */}
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

      {/* 3. CARD "DETALLE POR RECURSO" (Grid de 3 Columnas Funcionales) */}
      {selectedVm && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 bg-slate-50/75 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex items-center gap-2">
              <IconServer2 className="h-5 w-5 text-[#0054A6] dark:text-blue-400" />
              <h3 className="font-semibold text-slate-900 dark:text-white">{t("resourceDetailTitle")}</h3>
              <InfoTooltip content={t("tooltip_resource_detail")} position="bottom" align="left" />
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#0054A6] dark:bg-blue-900/30 dark:text-blue-400">
                {selectedVm.name}
              </span>
              {selectedVm.powerState === "deallocated" ? (
                <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {t("deallocatedStorageActive")}
                </span>
              ) : (
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Running (Uptime: {selectedVm.uptimePercent ?? 99}%)
                </span>
              )}
              {selectedVm.ahubActive && (
                <span className="rounded-md bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
                  {t("ahubActive")}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-slate-100 p-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-800">
            {/* Columna 1: Identidad & Estado */}
            <div className="space-y-3 sm:pr-6">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#0054A6] dark:text-blue-400">
                <IconWorld className="h-4 w-4" />
                <span>{t("col1Title")}</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelResource")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedVm.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelRegion")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedVm.region}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelSubscription")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedVm.subscriptionName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelResourceGroup")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedVm.resourceGroup}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelState")}:</span>
                  <span
                    className={`inline-flex items-center gap-1 font-semibold ${
                      selectedVm.powerState === "running"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        selectedVm.powerState === "running" ? "bg-emerald-500" : "bg-slate-400"
                      }`}
                    ></span>
                    {selectedVm.powerState || selectedVm.state}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelPriority")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedVm.priority || "Regular (PAYG)"}</span>
                </div>
              </div>
            </div>

            {/* Columna 2: Hardware & Almacenamiento */}
            <div className="space-y-3 pt-4 sm:px-6 sm:pt-0">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#00AEEF] dark:text-cyan-400">
                <IconDeviceFloppy className="h-4 w-4" />
                <span>{t("col2Title")}</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelSkuHardware")}:</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedVm.sku} ({selectedVm.vCpu} vCPU / {selectedVm.ramGb} GB)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelOsDisk")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {selectedVm.osDiskType} ({selectedVm.osDiskSizeGb || 128} GiB)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelDataDisks")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {selectedVm.dataDisksCount > 0
                      ? t("disksCountSize", { n: selectedVm.dataDisksCount, gb: selectedVm.dataDisksTotalGb })
                      : t("noExtraDisks")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelOsType")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedVm.os}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelPublicIp")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {selectedVm.publicIp || "No asignada"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelIops")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{selectedVm.iops ?? 45} ops/s</span>
                </div>
              </div>
            </div>

            {/* Columna 3: Métricas, FinOps & Licencias */}
            <div className="space-y-3 pt-4 sm:pl-6 sm:pt-0">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                <IconDatabase className="h-4 w-4" />
                <span>{t("col3Title")}</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelCpuAvgMax")}:</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedVm.cpuAvg ?? 0}% (Max P95: {selectedVm.cpuMax ?? 0}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelMemoryUsage")}:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {selectedVm.memoryInUsePercent ?? 0}% ({selectedVm.memoryAvailableGb !== undefined ? `${(selectedVm.ramGb - selectedVm.memoryAvailableGb).toFixed(1)} / ${selectedVm.ramGb} GB` : "RAM"})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelAhub")}:</span>
                  <span
                    className={`font-semibold ${
                      selectedVm.ahubActive ? "text-purple-600 dark:text-purple-400" : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {selectedVm.ahubActive ? t("ahubOn") : t("ahubOff")}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1.5 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelComputeCost")}:</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {format(selectedVm.computeCostMonthlyUsd ?? selectedVm.monthlyCostUsd)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{t("labelStorageCost")}:</span>
                  <span className="font-bold text-amber-600 dark:text-amber-400">
                    {format(selectedVm.storageCostMonthlyUsd ?? 0.00)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-1 dark:border-slate-800">
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{t("labelPotentialSaving")}:</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-300">
                    {format(selectedVm.potentialSavingUsd || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. MOTOR DE RECOMENDACIONES PRIORIZADAS (Tarjetas Resolutivas con Botones Corporativos) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="h-5 w-5 text-[#0054A6] dark:text-blue-400" />
            <h3 className="font-semibold text-slate-900 dark:text-white">{t("recommendationsTitle")}</h3>
            <InfoTooltip content={t("tooltip_recommendations")} position="bottom" align="left" />
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {data.reduce((acc, curr) => acc + (curr.remediationActions?.length || 0), 0)} {t("activeRecommendations")}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data
            .flatMap((item) =>
              (item.remediationActions || []).map((action) => ({
                action,
                vm: item,
              }))
            )
            .map(({ action, vm }) => {
              const getActionBtnText = (actionObj: VmRemediationAction) => {
                switch (actionObj.type) {
                  case "rightsizing_sku":
                    return actionObj.targetSku ? t("btnActionResizeTo", { sku: actionObj.targetSku }) : t("btnActionResize");
                  case "deallocated_disk":
                    return t("btnActionDisk");
                  case "power_schedule":
                    return t("btnActionSchedule");
                  case "ahub":
                    return t("btnActionAhub");
                  case "abandoned_vm":
                    return t("btnActionSnapshot");
                  default:
                    return t("btnActionOptimize");
                }
              };

              return (
                <div
                  key={`${vm.id}-${action.id}`}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition-all hover:border-[#0054A6] hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {vm.name} ({vm.region} · {vm.sku})
                      </span>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                        +{format(action.monthlySavingsUsd)}{t("perMonthSuffix")}
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{tituloDeAccion(action)}</h4>
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{descripcionDeAccion(action)}</p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {t("risk")}: <span className="uppercase text-emerald-600 dark:text-emerald-400 font-bold">{action.risk}</span>
                    </span>
                    {/* Botón Corporativo según Regla #21 */}
                    <button
                      onClick={() => setModalAction({ action, resourceName: vm.name })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] bg-white px-3 py-1.5 text-xs font-semibold text-[#0054A6] dark:text-blue-400 shadow-sm transition-all hover:bg-blue-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      <IconSparkles className="h-3.5 w-3.5" />
                      {getActionBtnText(action)}
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
                  <ResizableTh minWidth={180} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("colResource")}</span>
                      <InfoTooltip content={t("tooltip_col_resource")} position="bottom" align="left" />
                    </div>
                  </ResizableTh>
                  <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("colRegion")}</span>
                      <InfoTooltip content={t("tooltip_col_region")} position="bottom" align="left" />
                    </div>
                  </ResizableTh>
                  <ResizableTh minWidth={160} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("colSubscription")}</span>
                      <InfoTooltip content={t("tooltip_col_subscription")} position="bottom" align="left" />
                    </div>
                  </ResizableTh>
                  <ResizableTh minWidth={150} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("colSku")}</span>
                      <InfoTooltip content={t("tooltip_col_sku")} position="bottom" align="left" />
                    </div>
                  </ResizableTh>
                  <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("colState")}</span>
                      <InfoTooltip content={t("tooltip_col_state")} position="bottom" align="left" />
                    </div>
                  </ResizableTh>
                  <ResizableTh minWidth={130} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("colOsDisk")}</span>
                      <InfoTooltip content={t("tooltip_col_os_disk")} position="bottom" align="left" />
                    </div>
                  </ResizableTh>
                  <ResizableTh minWidth={110} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("colCpuAvg")}</span>
                      <InfoTooltip content={t("tooltip_col_cpu")} position="bottom" align="left" />
                    </div>
                  </ResizableTh>
                  <ResizableTh minWidth={110} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center gap-1">
                      <span>{t("colRamUsage")}</span>
                      <InfoTooltip content={t("tooltip_col_ram")} position="bottom" align="left" />
                    </div>
                  </ResizableTh>
                  <ResizableTh minWidth={120} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right dark:bg-slate-900 dark:border-slate-700">
                    <div className="inline-flex items-center justify-end gap-1 w-full">
                      <span>{t("colMonthlyCost")}</span>
                      <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
                    </div>
                  </ResizableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedItems.map((item) => {
                  const isSelected = item.id === selectedVm?.id;
                  const totalCost = item.totalCostMonthlyUsd ?? item.monthlyCostUsd;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedVmId(item.id)}
                      className={`cursor-pointer transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50 ${
                        isSelected ? "bg-blue-50/60 dark:bg-blue-950/30" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <IconServer2 className="h-4 w-4 text-[#0054A6] dark:text-blue-400 shrink-0" />
                          <span className="truncate">{item.name}</span>
                          {item.isZombie && (
                            <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                              Zombie
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.region}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.subscriptionName}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {item.sku}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                            item.powerState === "running"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              item.powerState === "running" ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          ></span>
                          {item.powerState || item.state}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        <span className="text-[11px]">
                          {item.osDiskType} ({item.osDiskSizeGb || 128}G)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-semibold">
                        {item.cpuAvg !== undefined ? `${item.cpuAvg}%` : item.metricA || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {item.memoryInUsePercent !== undefined ? `${item.memoryInUsePercent}%` : item.metricB || "N/A"}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                        {format(totalCost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación CMP 15/30/45/60 */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <span>{t("pageSizeLabel")}</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) as any);
                  setCurrentPage(1);
                }}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={45}>45</option>
                <option value={60}>60</option>
              </select>
              <span>{t("perPage")}</span>
            </div>

            <div className="flex items-center gap-2">
              <span>
                {t("pageOf", { current: currentPage, total: totalPages })}
              </span>
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

      {/* 6. COMPARATIVA POR REGIÓN Y ESTADO */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconWorld className="h-5 w-5 text-[#0054A6] dark:text-blue-400" />
            <h3 className="font-semibold text-slate-900 dark:text-white">{t("comparisonTitle")}</h3>
            <InfoTooltip content={t("tooltip_comparison")} position="bottom" align="left" />
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-900 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-100">
                <tr>
                  <th className="px-4 py-3">{t("colDimension")}</th>
                  <th className="px-4 py-3">{t("colVmsCount")}</th>
                  <th className="px-4 py-3">{t("colRunningCount")}</th>
                  <th className="px-4 py-3">{t("colDeallocatedCount")}</th>
                  <th className="px-4 py-3 text-right">{t("colMonthlyCost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {regionalDistribution.map((r) => (
                  <tr key={r.region} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{r.region}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 font-semibold">{r.count}</td>
                    <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-medium">{r.running}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">{r.deallocated}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                      {format(r.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Remediation Modal */}
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

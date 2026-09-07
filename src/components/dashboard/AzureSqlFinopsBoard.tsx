"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconDatabase,
  IconServer,
  IconActivity,
  IconCoin,
  IconShield,
  IconTarget,
  IconBolt,
  IconSparkles,
  IconCopy,
  IconCheck,
  IconX,
  IconCpu,
  IconWallet,
  IconGauge,
  IconCircleCheck,
  IconLayersIntersect,
  IconShieldExclamation,
  IconRefresh,
  IconChartBar,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import { useTranslations } from "next-intl";
import InfoTooltip from "@/components/InfoTooltip";
import {
  AzureSqlResourceDetail,
  AzureSqlFinopsSummaryResponse,
} from "@/types/azureSql";
import { errorMessage } from '@/lib/apiErrors';

const FILTER_ALL = "__all__";
type SortMode = "cost-desc" | "cost-asc" | "name-asc" | "name-desc";

export default function AzureSqlFinopsBoard() {
  const t = useTranslations("AzureSql");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<AzureSqlFinopsSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filtros FinOps CMP
  const [resourceFilter, setResourceFilter] = useState(FILTER_ALL);
  const [regionFilter, setRegionFilter] = useState(FILTER_ALL);
  const [typeFilter, setTypeFilter] = useState(FILTER_ALL);
  const [resourceGroupFilter, setResourceGroupFilter] = useState(FILTER_ALL);
  const [sortMode, setSortMode] = useState<SortMode>("cost-desc");

  // Selección de recurso para detalle
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);

  // Modal interactivo de optimización / script
  const [optimizationModalOpen, setOptimizationModalOpen] = useState(false);
  const [modalResource, setModalResource] = useState<AzureSqlResourceDetail | null>(null);
  const [activeRecommendationIndex, setActiveRecommendationIndex] = useState(0);
  const [activeScriptTab, setActiveScriptTab] = useState<"cli" | "bicep">("cli");
  const [copied, setCopied] = useState(false);

  const fetchSqlData = useCallback(
    async (isRefresh = false) => {
      if (!selectedTenant?.id) {
        setLoading(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        let token: string | undefined;
        try {
          const account = accounts && accounts.length > 0 ? accounts[0] : undefined;
          if (account) {
            const fresh = await getFreshIdToken(instance, account);
            token = fresh ?? undefined;
          }
        } catch {
          // Token auth fallback
        }

        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const params = new URLSearchParams({
          tenantId: selectedTenant.id,
          bust: isRefresh ? "1" : "0",
        });

        const res = await fetch(
          `/api/intelligence/databases/sql-metrics?${params.toString()}`,
          { headers }
        );

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const json: AzureSqlFinopsSummaryResponse = await res.json();
        setData(json);
        if (json.instances?.length) {
          const firstNonSystem = json.instances.find((i) => !i.isSystemDatabase) || json.instances[0];
          setSelectedResourceId((prev) => prev || firstNonSystem.id);
        }
      } catch (err) {
        setError(errorMessage(err) || "Error al consultar telemetría y costos de Azure SQL");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedTenant?.id, instance, accounts]
  );

  useEffect(() => {
    fetchSqlData();
  }, [fetchSqlData]);

  const items = useMemo(() => {
    const raw = data?.instances || [];
    const seen = new Set<string>();
    return raw.filter((i) => {
      const k = (i.id || "").toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [data]);

  // Opciones de filtros
  const resourceOptions = useMemo<FinopsTableOption[]>(() => {
    return [
      { value: FILTER_ALL, label: t("allOption", { fallback: "Todos" }) },
      ...items.map((i) => ({ value: i.name, label: i.name })),
    ];
  }, [items, t]);

  const regionOptions = useMemo<FinopsTableOption[]>(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.region) set.add(i.region);
    });
    return [
      { value: FILTER_ALL, label: t("allOption", { fallback: "Todos" }) },
      ...Array.from(set).map((r) => ({ value: r, label: r })),
    ];
  }, [items, t]);

  const typeOptions = useMemo<FinopsTableOption[]>(() => {
    return [
      { value: FILTER_ALL, label: t("allOption", { fallback: "Todos" }) },
      { value: "single-database", label: "Single Database" },
      { value: "elastic-pool", label: "Elastic Pool" },
      { value: "managed-instance", label: "Managed Instance" },
    ];
  }, [t]);

  const resourceGroupOptions = useMemo<FinopsTableOption[]>(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.resourceGroup) set.add(i.resourceGroup);
    });
    return [
      { value: FILTER_ALL, label: t("allOption", { fallback: "Todos" }) },
      ...Array.from(set).map((rg) => ({ value: rg, label: rg })),
    ];
  }, [items, t]);

  const sortOptions = useMemo<FinopsTableOption[]>(() => [
    { value: "cost-desc", label: t("sortCostDesc", { fallback: "Costo: mayor a menor" }) },
    { value: "cost-asc", label: t("sortCostAsc", { fallback: "Costo: menor a mayor" }) },
    { value: "name-asc", label: t("sortAz", { fallback: "Nombre: A-Z" }) },
    { value: "name-desc", label: t("sortZa", { fallback: "Nombre: Z-A" }) },
  ], [t]);

  // Filtrado y ordenamiento
  const filteredItems = useMemo(() => {
    const list = items.filter((item) => {
      if (resourceFilter !== FILTER_ALL && item.name !== resourceFilter) return false;
      if (regionFilter !== FILTER_ALL && item.region !== regionFilter) return false;
      if (typeFilter !== FILTER_ALL && item.architecture !== typeFilter) return false;
      if (resourceGroupFilter !== FILTER_ALL && item.resourceGroup !== resourceGroupFilter) return false;
      return true;
    });

    const sorted = [...list];
    if (sortMode === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sortMode === "cost-desc") sorted.sort((a, b) => b.cost.monthlyCostUsd - a.cost.monthlyCostUsd);
    if (sortMode === "cost-asc") sorted.sort((a, b) => a.cost.monthlyCostUsd - b.cost.monthlyCostUsd);

    return sorted;
  }, [items, resourceFilter, regionFilter, typeFilter, resourceGroupFilter, sortMode]);

  useEffect(() => {
    if (!selectedResourceId || !filteredItems.some((i) => i.id === selectedResourceId)) {
      setSelectedResourceId(filteredItems[0]?.id || "");
    }
  }, [filteredItems, selectedResourceId]);

  const selectedAccount = useMemo(() => {
    return filteredItems.find((i) => i.id === selectedResourceId) || items[0] || null;
  }, [filteredItems, items, selectedResourceId]);

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged } = usePagination(filteredItems, 15);

  const handleOpenOptimizationModal = (resource: AzureSqlResourceDetail, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setModalResource(resource);
    setActiveRecommendationIndex(0);
    setActiveScriptTab("cli");
    setCopied(false);
    setOptimizationModalOpen(true);
  };

  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (!selectedTenant?.id) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center bg-white dark:bg-slate-900">
        <IconDatabase size={40} stroke={1.5} className="mx-auto text-[#0078D4] mb-3" />
        <p className="text-sm font-semibold text-[#1B2A41] dark:text-slate-200">
          {t("selectTenant")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado y Acción de Refresh */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
              <IconDatabase size={24} stroke={1.5} className="text-[#0078D4]" />
              {t("moduleTitle", { fallback: "Optimización y FinOps de Azure SQL & Managed Instance" })}
            </h2>
            <InfoTooltip
              content={t("moduleTooltip", {
                fallback:
                  "Auditoría integral de bases de datos relacionales: Single DB, Elastic Pools y Managed Instances. Análisis de esquemas DTU vs vCore Serverless, reducción de almacenamiento asignado y beneficio híbrido (AHUB).",
              })}
              position="bottom"
              align="left"
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("moduleSubtitle", {
              fallback:
                "Monitoreo de rendimiento CPU/DTU, storage overprovisioning, conexiones activas y recomendaciones resolutivas de ahorro.",
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data?.lastUpdatedAt && (
            <span className="text-xs text-slate-400 dark:text-slate-500 hidden md:inline">
              {t("updatedAt", { fallback: "Actualizado" })}: {new Date(data.lastUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => fetchSqlData(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 h-8 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50 shrink-0 whitespace-nowrap"
          >
            <IconRefresh size={14} stroke={1.5} className={refreshing ? "animate-spin text-[#0054A6]" : "text-[#0054A6]"} />
            <span>{refreshing ? t("refreshing", { fallback: "Actualizando..." }) : t("refresh", { fallback: "Actualizar datos" })}</span>
          </button>
        </div>
      </section>

      {/* 8 Tarjetas KPI Principales */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* KPI 1: Costo MTD */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              {t("kpiMtdCost", { fallback: "Costo MTD" })}
            </span>
            <IconWallet size={18} stroke={1.5} className="text-[#0054A6]" />
          </div>
          <div className="text-base font-black text-[#1B2A41] dark:text-white">
            {format(data?.financialSummary?.mtdCost || 0)}
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            {t("currentBillingCycle", { fallback: "Ciclo actual" })}
          </span>
        </div>

        {/* KPI 2: Forecast EOM */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              {t("kpiForecast", { fallback: "Forecast EOM" })}
            </span>
            <IconGauge size={18} stroke={1.5} className="text-[#0054A6]" />
          </div>
          <div className="text-base font-black text-[#1B2A41] dark:text-white">
            {format(data?.financialSummary?.forecastEom?.value || 0)}
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            ±{format((data?.financialSummary?.forecastEom?.high || 0) - (data?.financialSummary?.forecastEom?.value || 0))}
          </span>
        </div>

        {/* KPI 3: Ahorro Potencial */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              {t("kpiSavings", { fallback: "Ahorro Potencial" })}
            </span>
            <IconCoin size={18} stroke={1.5} className="text-[#0054A6]" />
          </div>
          <div className="text-base font-black text-[#1B2A41] dark:text-white">
            {format(data?.financialSummary?.potentialSavings || 0)}
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            {data?.recommendations?.length || 0} {t("actionsDetected", { fallback: "acciones" })}
          </span>
        </div>

        {/* KPI 4: Variación MoM */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              {t("kpiDeltaMoM", { fallback: "Variación MoM" })}
            </span>
            <IconChartBar size={18} stroke={1.5} className="text-[#0054A6]" />
          </div>
          <div className="text-base font-black text-[#1B2A41] dark:text-white">
            {data?.financialSummary?.deltaMoM?.percentage ? `${data.financialSummary.deltaMoM.percentage.toFixed(1)}%` : "0.0%"}
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            vs. {t("previousMonth", { fallback: "mes anterior" })}
          </span>
        </div>

        {/* KPI 5: Recursos Detectados */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              {t("kpiResources", { fallback: "Recursos SQL" })}
            </span>
            <IconLayersIntersect size={18} stroke={1.5} className="text-[#0054A6]" />
          </div>
          <div className="text-base font-black text-[#1B2A41] dark:text-white">
            {items.length}
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            {items.filter((i) => i.architecture === "single-database").length} DBs / {items.filter((i) => i.architecture === "elastic-pool").length} Pools
          </span>
        </div>

        {/* KPI 6: Eficiencia ($/vCore) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              {t("kpiEfficiency", { fallback: "Eficiencia ($/vCore)" })}
            </span>
            <IconActivity size={18} stroke={1.5} className="text-[#0054A6]" />
          </div>
          <div className="text-base font-black text-[#1B2A41] dark:text-white">
            {format(data?.efficiency?.costPerEffectiveVcore || 0)}
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            {t("perActiveVcore", { fallback: "/ vCore activo" })}
          </span>
        </div>

        {/* KPI 7: Recursos Subutilizados */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              {t("kpiUnderutilized", { fallback: "Subutilizados" })}
            </span>
            <IconShieldExclamation size={18} stroke={1.5} className="text-[#0054A6]" />
          </div>
          <div className="text-base font-black text-[#1B2A41] dark:text-white">
            {data?.efficiency?.underutilizedCount || 0}
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            {data?.efficiency?.serverlessCandidateCount || 0} {t("candidatesServerless", { fallback: "a Serverless" })}
          </span>
        </div>

        {/* KPI 8: Salud Operativa */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
              {t("kpiHealth", { fallback: "Salud Operativa" })}
            </span>
            <IconCircleCheck size={18} stroke={1.5} className="text-[#0054A6]" />
          </div>
          <div className="text-base font-black text-[#1B2A41] dark:text-white">
            {data?.risk?.healthScore || 100}/100
          </div>
          <span className="text-[10px] text-slate-400 mt-1">
            0 {t("connectionErrors", { fallback: "errores de conexión" })}
          </span>
        </div>
      </section>

      {/* Filtros Estándar FinOps CMP (Debajo de los KPIs) */}
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
          resource: t("filterResource", { fallback: "Recurso" }),
          region: t("filterRegion", { fallback: "Región" }),
          type: t("filterType", { fallback: "Tipo / Modelo" }),
          resourceGroup: t("filterResourceGroup", { fallback: "Grupo de Recursos" }),
          sort: t("sortBy", { fallback: "Ordenar por" }),
        }}
      />

      {error && (
        <section className="rounded-2xl border border-rose-200 bg-white dark:bg-slate-900 p-4 text-sm text-rose-700 dark:text-rose-400">
          <div className="flex items-start gap-2">
            <IconAlertTriangle size={18} stroke={1.5} className="mt-0.5 text-rose-600 shrink-0" />
            <p>{error}</p>
          </div>
        </section>
      )}

      {/* Detalle por Recurso (Grid de 3 Columnas) */}
      {selectedAccount && (
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-slate-100 dark:border-slate-800 gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {t("resourceDetailTitle", { fallback: "Detalle de Recurso Seleccionado" })}:
              </span>
              <span className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                <IconDatabase size={18} stroke={1.5} className="text-[#0078D4]" />
                {selectedAccount.name}
              </span>
              {selectedAccount.isSystemDatabase && (
                <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                  {t("badgeSystemDb", { fallback: "Base de Datos del Sistema (Metadata)" })}
                </span>
              )}
            </div>
            {selectedAccount.recommendations.length > 0 && (
              <button
                onClick={(e) => handleOpenOptimizationModal(selectedAccount, e)}
                className="flex items-center gap-1.5 px-3 py-1.5 h-8 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
              >
                <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                <span>{t("inspect", { fallback: "Optimizar" })} ({selectedAccount.recommendations.length})</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Columna 1: Identidad, Motor & Topología */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <IconServer size={18} stroke={1.5} className="text-[#0078D4]" />
                {t("colIdentity", { fallback: "Identidad, Motor & Topología" })}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelResource", { fallback: "Recurso" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedAccount.name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelArchitecture", { fallback: "Tipo de Arquitectura" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                    {selectedAccount.architecture.replace("-", " ")}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelServer", { fallback: "Servidor / Instancia" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedAccount.serverName}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelSubscription", { fallback: "Suscripción" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                    {selectedAccount.subscriptionName}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelResourceGroupRegion", { fallback: "Grupo / Región" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.resourceGroup} ({selectedAccount.region})
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelRedundancy", { fallback: "Redundancia Backup" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedAccount.storage.redundancy}</span>
                </div>
              </div>
            </div>

            {/* Columna 2: Capacidad & Modelo de Compra */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <IconActivity size={18} stroke={1.5} className="text-[#0078D4]" />
                {t("colPurchasingModel", { fallback: "Capacidad & Modelo de Compra" })}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelPurchasingModel", { fallback: "Modelo de Compra" })}:</span>
                  <span className="font-bold text-[#0054A6] uppercase">
                    {selectedAccount.purchasingModel.type.replace("-", " ")}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelSkuTier", { fallback: "Tier / SKU" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.purchasingModel.tier} ({selectedAccount.purchasingModel.skuName})
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelElasticPool", { fallback: "Elastic Pool" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.elasticPoolName || t("noneIsolated", { fallback: "Ninguno (Single DB)" })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelAutoPause", { fallback: "Auto-Pause (Serverless)" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.purchasingModel.autoPauseDelayMinutes
                      ? `${t("active", { fallback: "Activo" })} (${selectedAccount.purchasingModel.autoPauseDelayMinutes} min)`
                      : t("inactive", { fallback: "Inactivo" })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelAhub", { fallback: "AHUB (Beneficio Híbrido)" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.licensing.hasHybridBenefit
                      ? t("activeBenefit", { fallback: "Activo (BasePrice)" })
                      : t("inactiveFullPrice", { fallback: "Inactivo (LicenseIncluded)" })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelStatus", { fallback: "Estado Operativo" })}:</span>
                  <span className="font-semibold text-emerald-600 uppercase">{selectedAccount.state}</span>
                </div>
              </div>
            </div>

            {/* Columna 3: Métricas, FinOps & Licencia */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <IconCpu size={18} stroke={1.5} className="text-[#0078D4]" />
                {t("colFinopsMetrics", { fallback: "Métricas, FinOps & Licencia" })}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelCpuDtu", { fallback: "CPU / DTU % (Avg/Max)" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.metrics.avgCpuPercent.toFixed(1)}% / {selectedAccount.metrics.maxCpuPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelStorageUsage", { fallback: "Almacenamiento (Uso/Asignado)" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.storage.usedStorageGb} GB / {selectedAccount.storage.allocatedStorageGb} GB ({selectedAccount.storage.storageUtilizationPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelSessionsWorkers", { fallback: "Sesiones / Workers" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.metrics.activeSessions} ses. ({selectedAccount.metrics.sessionsPercent.toFixed(1)}%) / {selectedAccount.metrics.activeWorkers} wrk.
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelLogIo", { fallback: "Log IO / Data IO" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.metrics.logWritePercent.toFixed(1)}% / {selectedAccount.metrics.dataIoPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between py-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="font-bold text-[#1B2A41] dark:text-white">{t("labelCostSavings", { fallback: "Costo / Ahorro Mensual" })}:</span>
                  <span className="font-black text-[#0054A6]">
                    {selectedAccount.elasticPoolName ? (
                      <span className="text-slate-600 dark:text-slate-300 font-semibold text-xs">
                        $0.00 <span className="text-[11px] text-slate-400 font-normal">({t("includedInPool", { fallback: "Incluido en Elastic Pool" })})</span>
                      </span>
                    ) : (
                      <>
                        {format(selectedAccount.cost.monthlyCostUsd)}{" "}
                        {selectedAccount.cost.potentialSavingsUsd > 0 && (
                          <span className="text-emerald-600 font-bold ml-1">
                            (-{format(selectedAccount.cost.potentialSavingsUsd)})
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Tabla FinOps CMP: Inventario Detallado de Azure SQL */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
              <IconDatabase size={20} stroke={1.5} className="text-[#0078D4]" />
              <span>{t("tableTitle", { fallback: "Inventario Detallado de Azure SQL & Managed Instance" })}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {t("tableSubtitle", { fallback: "Mapeo completo de instancias, pools y single databases con análisis de capacidad y sobredimensionamiento." })}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {total} {t("resourcesFound", { fallback: "recursos encontrados" })}
            </span>
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50">
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">{t("colResource", { fallback: "Recurso" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">{t("colRegion", { fallback: "Región & RG" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">{t("colSubscription", { fallback: "Suscripción" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">{t("colArchitecture", { fallback: "Tipo / Modelo" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">{t("colSku", { fallback: "Tier / SKU" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-center">{t("colState", { fallback: "Estado" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colCpuDtu", { fallback: "CPU / DTU (Avg %)" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colStorageUsedAllocated", { fallback: "Almacenamiento (Uso/Asig)" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colCost", { fallback: "Costo Mensual" })}</ResizableTh>
                <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colSavings", { fallback: "Ahorro Potencial" })}</ResizableTh>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 text-center">{t("colActions", { fallback: "Acción" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400 dark:text-slate-500">
                    {t("noRecords", { fallback: "No se encontraron recursos de Azure SQL con los filtros seleccionados." })}
                  </td>
                </tr>
              ) : (
                paged.map((item: AzureSqlResourceDetail) => {
                  const isSelected = item.id === selectedResourceId;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedResourceId(item.id)}
                      className={`hover:bg-blue-50/30 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${
                        isSelected ? "bg-blue-50/50 dark:bg-slate-800/80 font-medium" : ""
                      }`}
                    >
                      <td className="p-3 font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <IconDatabase size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />
                        <div className="flex flex-col">
                          <span className="truncate max-w-[170px]">{item.name}</span>
                          {item.isSystemDatabase && (
                            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400">
                              System DB (master)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{item.region}</span>
                          <span className="text-[10px] text-slate-400">{item.resourceGroup}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400 truncate max-w-[140px]">
                        {item.subscriptionName}
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400 capitalize">
                        {item.architecture.replace("-", " ")}
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono">
                          {item.purchasingModel.skuName}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            item.state === "online"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                          }`}
                        >
                          {item.state}
                        </span>
                      </td>
                      <td className="p-3 text-right font-semibold text-slate-800 dark:text-slate-200">
                        {item.metrics.avgCpuPercent.toFixed(1)}%
                      </td>
                      <td className="p-3 text-right text-slate-600 dark:text-slate-400">
                        {item.storage.usedStorageGb} / {item.storage.allocatedStorageGb} GB
                      </td>
                      <td className="p-3 text-right font-bold text-[#1B2A41] dark:text-slate-100">
                        {item.elasticPoolName ? (
                          <div className="flex flex-col items-end">
                            <span className="text-slate-500 dark:text-slate-400 font-normal text-xs">{format(0)}</span>
                            <span className="text-[10px] text-slate-400 font-normal leading-tight">({t("inPool", { fallback: "En Pool" })})</span>
                          </div>
                        ) : (
                          format(item.cost.monthlyCostUsd)
                        )}
                      </td>
                      <td className="p-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                        {item.cost.potentialSavingsUsd > 0 ? `+${format(item.cost.potentialSavingsUsd)}` : "—"}
                      </td>
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        {item.recommendations.length > 0 ? (
                          <button
                            onClick={(e) => handleOpenOptimizationModal(item, e)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
                          >
                            <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                            <span>{t("inspect", { fallback: "Optimizar" })}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <Pagination
            page={page}
            setPage={setPage}
            pageSize={pageSize}
            setPageSize={setPageSize}
            total={total}
            totalPages={totalPages}
            pageSizes={[15, 30, 45, 60]}
            labels={{
              perPage: "por página",
              of: "de",
            }}
          />
        </div>
      </section>

      {/* Modal Interactivo de Remediación y Optimización Resolutiva */}
      {optimizationModalOpen && modalResource && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header del Modal */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <IconSparkles size={24} stroke={1.5} className="text-[#0078D4]" />
                <h3 className="text-base font-bold text-[#1B2A41] dark:text-white">
                  {t("optimizationModalTitle", { fallback: "Sugerencias de Optimización para Azure SQL" })}
                </h3>
              </div>
              <button
                onClick={() => setOptimizationModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <IconX size={18} stroke={1.5} />
              </button>
            </div>

            {/* Selector de Recomendaciones si existen varias */}
            <div className="mt-4">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t("targetResource", { fallback: "Recurso destino" })}:{" "}
                <strong className="text-slate-800 dark:text-slate-200">{modalResource.name}</strong> (
                {modalResource.purchasingModel.skuName})
              </span>

              {modalResource.recommendations.length > 0 ? (
                <>
                  {modalResource.recommendations.length > 1 && (
                    <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                      {modalResource.recommendations.map((rec, idx) => (
                        <button
                          key={rec.id}
                          onClick={() => {
                            setActiveRecommendationIndex(idx);
                            setCopied(false);
                          }}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shrink-0 ${
                            activeRecommendationIndex === idx
                              ? "bg-white dark:bg-slate-900 border-2 border-[#0054A6] text-[#0054A6] dark:text-blue-400 shadow-sm"
                              : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {rec.title.split("(")[0]}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Detalle de la recomendación activa */}
                  {(() => {
                    const currentRec =
                      modalResource.recommendations[activeRecommendationIndex] ||
                      modalResource.recommendations[0];
                    const activeCode =
                      activeScriptTab === "cli"
                        ? currentRec.cliCommand || ""
                        : currentRec.bicepSnippet || "";

                    return (
                      <div className="mt-4 space-y-4">
                        <div className="p-4 bg-blue-50/30 dark:bg-slate-800/50 rounded-xl border border-blue-100 dark:border-slate-700 space-y-2">
                          <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                            <IconBolt size={18} stroke={1.5} className="text-[#0078D4]" />
                            {currentRec.title}
                          </h4>
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {currentRec.description}
                          </p>

                          <div className="flex flex-wrap items-center gap-4 pt-2 text-xs">
                            <span className="flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                              <IconCoin size={16} stroke={1.5} />
                              {t("estimatedSaving", { fallback: "Ahorro Estimado" })}: +{format(currentRec.savingsMonthlyUsd)}/mes
                            </span>
                            <span className="flex items-center gap-1 text-slate-500">
                              <IconShield size={16} stroke={1.5} className="text-[#0078D4]" />
                              {t("risk", { fallback: "Riesgo" })}: <strong className="uppercase">{currentRec.risk}</strong>
                            </span>
                            <span className="flex items-center gap-1 text-slate-500">
                              <IconTarget size={16} stroke={1.5} className="text-[#0078D4]" />
                              {t("confidence", { fallback: "Confianza" })}: <strong className="uppercase">{currentRec.confidence}</strong>
                            </span>
                          </div>
                        </div>

                        {/* Pestañas CLI vs Bicep */}
                        {activeCode && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setActiveScriptTab("cli")}
                                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                    activeScriptTab === "cli"
                                      ? "bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400"
                                      : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500"
                                  }`}
                                >
                                  Azure CLI
                                </button>
                                <button
                                  onClick={() => setActiveScriptTab("bicep")}
                                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                                    activeScriptTab === "bicep"
                                      ? "bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] dark:text-blue-400"
                                      : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500"
                                  }`}
                                >
                                  Bicep / IaC
                                </button>
                              </div>
                              <button
                                onClick={() => handleCopyCode(activeCode)}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-emerald-600 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50/40 transition-colors shadow-sm"
                              >
                                {copied ? (
                                  <>
                                    <IconCheck size={14} stroke={1.5} />
                                    {t("copied", { fallback: "Copiado" })}
                                  </>
                                ) : (
                                  <>
                                    <IconCopy size={14} stroke={1.5} />
                                    {t("copy", { fallback: "Copiar" })}
                                  </>
                                )}
                              </button>
                            </div>

                            <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800">
                              <code>{activeCode}</code>
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="p-6 text-center text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-xl mt-4">
                  <IconCircleCheck size={32} stroke={1.5} className="mx-auto text-emerald-500 mb-2" />
                  <p className="text-xs font-semibold">
                    {t("noPendingOptimizations", {
                      fallback: "Este recurso está operando de manera óptima o es una base de datos del sistema.",
                    })}
                  </p>
                </div>
              )}
            </div>

            {/* Footer del Modal */}
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setOptimizationModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shadow-sm"
              >
                {t("close", { fallback: "Cerrar" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

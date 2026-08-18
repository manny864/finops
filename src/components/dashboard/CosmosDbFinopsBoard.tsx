"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconCircleCheck,
  IconCoin,
  IconCopy,
  IconCheck,
  IconDatabase,
  IconExternalLink,
  IconGauge,
  IconLayersIntersect,
  IconRefresh,
  IconServer,
  IconShieldExclamation,
  IconShield,
  IconTarget,
  IconBolt,
  IconSparkles,
  IconTerminal2,
  IconWallet,
  IconX,
  IconCpu,
  IconActivity,
  IconBrandAzure,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import FinopsTableControls, { type FinopsTableOption } from "@/components/dashboard/FinopsTableControls";
import { useTranslations } from "next-intl";
import InfoTooltip from "@/components/InfoTooltip";
import {
  CosmosDbAccountDetail,
  CosmosFinopsSummaryResponse,
  CosmosRemediationAction,
} from "@/types/cosmosDb";
import { toast } from "sonner";

const FILTER_ALL = "__all__";
type SortMode = "name-asc" | "name-desc" | "cost-desc" | "cost-asc";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function CosmosDbFinopsBoard() {
  const t = useTranslations("CosmosDb");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CosmosFinopsSummaryResponse | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  // Filtros
  const [resourceFilter, setResourceFilter] = useState(FILTER_ALL);
  const [regionFilter, setRegionFilter] = useState(FILTER_ALL);
  const [typeFilter, setTypeFilter] = useState(FILTER_ALL);
  const [resourceGroupFilter, setResourceGroupFilter] = useState(FILTER_ALL);
  const [sortMode, setSortMode] = useState<SortMode>("cost-desc");

  // Recurso seleccionado para el detalle en Grid de 3 columnas
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");

  // Modal de Remediación (CLI / Bicep)
  const [activeRemediation, setActiveRemediation] = useState<{
    action: CosmosRemediationAction;
    allActions?: CosmosRemediationAction[];
    resourceName: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"cli" | "bicep">("cli");
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(
    async (isManualRefresh = false) => {
      if (!selectedTenant || selectedTenant.id === "default") {
        setLoading(false);
        return;
      }
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const tenantId = selectedTenant.id;
        let token: string | null = null;
        if (!isMockTenant(tenantId)) {
          if (accounts[0]) {
            token = await getFreshIdToken(instance, accounts[0]);
          }
        }

        const params = new URLSearchParams({ tenantId, bust: isManualRefresh ? "1" : "0" });
        const res = await fetch(`/api/intelligence/databases/cosmos-metrics?${params.toString()}`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }

        const json: CosmosFinopsSummaryResponse = await res.json();
        setData(json);
        setLastUpdatedAt(new Date());

        if (json.instances && json.instances.length > 0) {
          if (!selectedResourceId || !json.instances.some((i) => i.id === selectedResourceId)) {
            setSelectedResourceId(json.instances[0].id);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error al consultar Cosmos DB";
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedTenant, accounts, instance, selectedResourceId]
  );

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

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
  const resourceOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption", { fallback: "Todos los recursos" }) },
    ...items
      .map((i) => i.name)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name })),
  ], [items, t]);

  const regionOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption", { fallback: "Todas las regiones" }) },
    ...items
      .map((i) => i.region)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .sort((a, b) => a.localeCompare(b))
      .map((region) => ({ value: region, label: region })),
  ], [items, t]);

  const typeOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption", { fallback: "Todos los tipos / APIs" }) },
    ...items
      .map((i) => i.apiLabel || i.kind)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .sort((a, b) => a.localeCompare(b))
      .map((api) => ({ value: api, label: api })),
  ], [items, t]);

  const resourceGroupOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption", { fallback: "Todos los grupos de recursos" }) },
    ...items
      .map((i) => i.resourceGroup)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .sort((a, b) => a.localeCompare(b))
      .map((rg) => ({ value: rg, label: rg })),
  ], [items, t]);

  const sortOptions = useMemo<FinopsTableOption[]>(() => [
    { value: "cost-desc", label: t("sortCostDesc", { fallback: "Costo: mayor a menor" }) },
    { value: "cost-asc", label: t("sortCostAsc", { fallback: "Costo: menor a mayor" }) },
    { value: "name-asc", label: t("sortAz", { fallback: "Nombre: A-Z" }) },
    { value: "name-desc", label: t("sortZa", { fallback: "Nombre: Z-A" }) },
  ], [t]);

  const filteredItems = useMemo(() => {
    const list = items.filter((item) => {
      if (resourceFilter !== FILTER_ALL && item.name !== resourceFilter) return false;
      if (regionFilter !== FILTER_ALL && item.region !== regionFilter) return false;
      if (typeFilter !== FILTER_ALL && (item.apiLabel !== typeFilter && item.kind !== typeFilter)) return false;
      if (resourceGroupFilter !== FILTER_ALL && item.resourceGroup !== resourceGroupFilter) return false;
      return true;
    });

    const sorted = [...list];
    if (sortMode === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (sortMode === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
    if (sortMode === "cost-desc") sorted.sort((a, b) => b.cost.totalMonthlyCostUsd - a.cost.totalMonthlyCostUsd);
    if (sortMode === "cost-asc") sorted.sort((a, b) => a.cost.totalMonthlyCostUsd - b.cost.totalMonthlyCostUsd);

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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(t("copiedCode", { fallback: "Código copiado al portapapeles" }));
    setTimeout(() => setCopied(false), 2000);
  };

  if (!selectedTenant || selectedTenant.id === "default") {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-600 dark:text-slate-400">
        {t("selectTenant", { fallback: "Por favor, seleccione un inquilino (Tenant) para visualizar el análisis FinOps de Azure Cosmos DB." })}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center shadow-sm">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#0054A6]" />
          <p className="text-base font-semibold text-slate-800 dark:text-slate-200">{t("loadingTitle", { fallback: "Cargando telemetría y costos de Azure Cosmos DB..." })}</p>
          <p className="text-xs text-slate-500 mt-1">{t("loadingSubtitle", { fallback: "Consultando Azure Resource Graph, métricas de RU/s y Cost Management..." })}</p>
        </div>
      </div>
    );
  }

  const finSummary = data?.financialSummary;
  const efficiency = data?.efficiency;
  const risk = data?.risk;
  const allRecommendations = data?.recommendations || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Encabezado y Barra de Actualización */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconDatabase size={24} stroke={1.5} className="text-[#0078D4]" />
              <span>{t("moduleTitle", { fallback: "Optimización y FinOps de Azure Cosmos DB" })}</span>
              <InfoTooltip
                content={t("moduleTooltip", {
                  fallback: "Análisis exhaustivo de arquitectura NoSQL y MongoDB vCore: throughput RU/s, almacenamiento de índices, multi-región y motor de recomendaciones de ahorro.",
                })}
                position="bottom"
                align="left"
              />
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {t("moduleSubtitle", {
                fallback: "Auditoría de sobreprovisionamiento de RU/s, consumo normalizado, latencia y detección de oportunidades Serverless / Autoscale.",
              })}
            </p>
            {lastUpdatedAt && (
              <p className="mt-2 text-xs text-slate-400">
                {t("updatedAt", { fallback: "Última sincronización" })}: {lastUpdatedAt.toLocaleTimeString()}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void fetchData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 px-4 py-2 text-xs font-semibold text-[#0054A6] hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all"
          >
            <IconRefresh size={18} stroke={1.5} className={refreshing ? "animate-spin text-[#0078D4]" : "text-[#0078D4]"} />
            {refreshing ? t("refreshing", { fallback: "Actualizando..." }) : t("refresh", { fallback: "Actualizar datos" })}
          </button>
        </div>
      </section>

      {/* 8 KPI Cards Corporativas */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Costo MTD */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconWallet size={18} stroke={1.5} className="text-[#0054A6]" />
              {t("kpiMtdCost", { fallback: "Costo MTD" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_mtd", { fallback: "Gasto acumulado en el mes en curso por todas las cuentas Cosmos DB." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white">
            {format(finSummary?.mtdCost || 0)}
          </p>
          <p className="mt-1 text-xs text-slate-400">{t("currentBillingCycle", { fallback: "Ciclo de facturación actual" })}</p>
        </div>

        {/* KPI 2: Forecast Fin de Mes */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconGauge size={18} stroke={1.5} className="text-[#0054A6]" />
              {t("kpiForecast", { fallback: "Forecast EOM" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_forecast", { fallback: "Proyección estimada de cierre de mes con banda de volatilidad estadística." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white">
            {format(finSummary?.forecastEom?.value || 0)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {format(finSummary?.forecastEom?.low || 0)} - {format(finSummary?.forecastEom?.high || 0)}
          </p>
        </div>

        {/* KPI 3: Ahorro Potencial Total */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconCoin size={18} stroke={1.5} className="text-[#0054A6]" />
              {t("kpiSavings", { fallback: "Ahorro Potencial" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_savings", { fallback: "Suma de ahorros mensuales estimados por migración a Autoscale/Serverless, Free Tier y reservas." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white">
            {format(finSummary?.potentialSavings || 0)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {allRecommendations.length} {t("actionsDetected", { fallback: "oportunidades detectadas" })}
          </p>
        </div>

        {/* KPI 4: Variación MoM */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconBolt size={18} stroke={1.5} className="text-[#0054A6]" />
              {t("kpiDeltaMoM", { fallback: "Variación MoM" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_delta", { fallback: "Incremento o reducción porcentual del costo respecto al mismo período del mes anterior." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white flex items-center gap-1">
            {(finSummary?.deltaMoM?.percentage || 0) >= 0 ? (
              <IconArrowUpRight size={20} stroke={1.5} className="text-slate-600 dark:text-slate-400" />
            ) : (
              <IconArrowDownRight size={20} stroke={1.5} className="text-slate-600 dark:text-slate-400" />
            )}
            {Math.abs(finSummary?.deltaMoM?.percentage || 0).toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-400">{format(finSummary?.deltaMoM?.value || 0)} MoM</p>
        </div>

        {/* KPI 5: Recursos Detectados */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconCircleCheck size={18} stroke={1.5} className="text-[#0054A6]" />
              {t("kpiResources", { fallback: "Recursos Cosmos DB" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_resources", { fallback: "Total de cuentas Cosmos DB y clústeres MongoDB vCore detectados en las suscripciones activas." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white">
            {filteredItems.length}
          </p>
          <p className="mt-1 text-xs text-slate-400">{items.length} {t("totalInTenant", { fallback: "en el tenant" })}</p>
        </div>

        {/* KPI 6: Eficiencia $/1k RU o $/GB */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconActivity size={18} stroke={1.5} className="text-[#0054A6]" />
              {t("kpiEfficiency", { fallback: "Eficiencia ($/GB)" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_efficiency", { fallback: "Costo promedio por Gigabyte gestionado (datos + índices) en Azure Cosmos DB." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white">
            {format(efficiency?.costPerUsedGb || 0)}
          </p>
          <p className="mt-1 text-xs text-slate-400">{format(efficiency?.costPerKOps || 0)} / 1k req</p>
        </div>

        {/* KPI 7: Recursos Subutilizados */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconLayersIntersect size={18} stroke={1.5} className="text-[#0054A6]" />
              {t("kpiUnderutilized", { fallback: "RU Subutilizadas" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_underutilized", { fallback: "Cuentas con Throughput Manual cuya utilización normalizada es inferior al 20%." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white">
            {efficiency?.underutilizedCount || 0}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("candidatesForAutoscale", { fallback: "candidatas a Autoscale" })}
          </p>
        </div>

        {/* KPI 8: Salud Operativa */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconShieldExclamation size={18} stroke={1.5} className="text-[#0054A6]" />
              {t("kpiHealth", { fallback: "Salud Operativa" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_health", { fallback: "Puntuación de 0 a 100 basada en tasa de errores HTTP 429 (throttling), latencia y sobrecosto." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white">
            {(risk?.healthScore || 100).toFixed(0)} <span className="text-sm font-normal text-slate-400">/ 100</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {risk?.throttledInstancesCount || 0} {t("throttledInstances", { fallback: "cuentas con 429s" })}
          </p>
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
          type: t("filterType", { fallback: "Tipo / API" }),
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

      {/* Detalle del Recurso Seleccionado en Grid de 3 Columnas */}
      {selectedAccount && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <IconDatabase size={24} stroke={1.5} className="text-[#0078D4] shrink-0" />
              <div>
                <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                  <span>{selectedAccount.name}</span>
                  <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    {selectedAccount.apiLabel}
                  </span>
                  {selectedAccount.throughputProfile.freeTierEnabled && (
                    <span className="inline-flex items-center rounded-md bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                      Free Tier
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedAccount.subscriptionName} · {selectedAccount.resourceGroup} · {selectedAccount.region}
                </p>
              </div>
            </div>
            <div className="w-full sm:w-auto">
              <select
                value={selectedAccount.id}
                onChange={(e) => setSelectedResourceId(e.target.value)}
                className="w-full sm:w-72 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0054A6]"
              >
                {filteredItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({format(item.cost.totalMonthlyCostUsd)}/mes)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Columna 1: Identidad & Red */}
            <div className="space-y-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/60 dark:border-slate-700 pb-2">
                <IconServer size={18} stroke={1.5} className="text-[#0078D4]" />
                {t("colIdentity", { fallback: "Identidad & Red" })}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelApi", { fallback: "API" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedAccount.apiLabel}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelArchitecture", { fallback: "Arquitectura" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.architecture === "vcore-based" ? "MongoDB vCore" : "Request Units (RU/s)"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelDedicatedGateway", { fallback: "Dedicated Gateway" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.throughputProfile.dedicatedGatewayEnabled ? t("active", { fallback: "Activo" }) : t("inactive", { fallback: "Inactivo" })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelSynapseLink", { fallback: "Synapse Link" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.throughputProfile.analyticalStoreEnabled ? t("active", { fallback: "Activo" }) : t("inactive", { fallback: "Inactivo" })}
                  </span>
                </div>
                {selectedAccount.endpoints?.documentEndpoint && (
                  <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">{t("labelEndpoint", { fallback: "Endpoint" })}:</span>
                    <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400 truncate max-w-[170px]" title={selectedAccount.endpoints.documentEndpoint}>
                      {selectedAccount.endpoints.documentEndpoint}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Columna 2: Rendimiento & Replicación */}
            <div className="space-y-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/60 dark:border-slate-700 pb-2">
                <IconActivity size={18} stroke={1.5} className="text-[#0078D4]" />
                {t("colPerformance", { fallback: "Rendimiento & Replicación" })}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelThroughputMode", { fallback: "Modo Throughput" })}:</span>
                  <span className="font-bold text-[#0054A6] uppercase">{selectedAccount.throughputProfile.mode}</span>
                </div>
                {selectedAccount.architecture === "ru-based" ? (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelProvisionedRu", { fallback: "RU Asignadas" })}:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedAccount.throughputProfile.mode === "serverless"
                          ? "On-Demand (Serverless)"
                          : `${(selectedAccount.throughputProfile.totalProvisionedRu || 0).toLocaleString()} RU/s`}
                      </span>
                    </div>
                    {selectedAccount.throughputProfile.maxAutoscaleRu && (
                      <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-slate-500">{t("labelMaxAutoscaleRu", { fallback: "Máximo Autoscale" })}:</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {selectedAccount.throughputProfile.maxAutoscaleRu.toLocaleString()} RU/s
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelVcoresRam", { fallback: "vCores / RAM" })}:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedAccount.throughputProfile.vCores || 4} vCores · {selectedAccount.throughputProfile.ramGb || 16} GB
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelHighAvailability", { fallback: "Alta Disponibilidad" })}:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedAccount.throughputProfile.highAvailability || "Disabled"}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelRegionsCount", { fallback: "Regiones / Réplicas" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.throughputProfile.regionsCount} {selectedAccount.throughputProfile.isMultiRegionWrite ? "(Multi-Write)" : "(Single-Write)"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelFreeTier", { fallback: "Beneficio Free Tier" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.throughputProfile.freeTierEnabled ? t("freeTierApplied", { fallback: "1,000 RU + 25GB Gratis" }) : t("notApplied", { fallback: "No aplicado" })}
                  </span>
                </div>
              </div>
            </div>

            {/* Columna 3: Telemetría & Desglose de Costos */}
            <div className="space-y-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/60 dark:border-slate-700 pb-2">
                <IconCpu size={18} stroke={1.5} className="text-[#0078D4]" />
                {t("colTelemetryCost", { fallback: "Telemetría & Desglose de Costos" })}
              </h4>
              <div className="space-y-2 text-xs">
                {selectedAccount.architecture === "ru-based" ? (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelNormalizedRu", { fallback: "RU Normalizado (Avg/P95)" })}:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedAccount.metrics.avgNormalizedRuPct.toFixed(1)}% / {selectedAccount.metrics.p95NormalizedRuPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelThrottlingRate", { fallback: "Tasa Throttling 429" })}:</span>
                      <span className={`font-semibold ${selectedAccount.metrics.throttling429Rate > 0.05 ? "text-rose-600 font-bold" : "text-emerald-600"}`}>
                        {(selectedAccount.metrics.throttling429Rate * 100).toFixed(2)}%
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">CPU / Memoria %:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedAccount.metrics.cpuPercent?.toFixed(1) || 0}% CPU · {selectedAccount.metrics.memoryPercent?.toFixed(1) || 0}% RAM
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelStorageDataIndex", { fallback: "Storage Datos / Índices" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.storage.dataUsageGb} GB / {selectedAccount.storage.indexUsageGb} GB
                  </span>
                </div>
                <div className="flex justify-between py-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="font-bold text-[#1B2A41] dark:text-white">{t("labelTotalMonthlyCost", { fallback: "Costo Mensual Total" })}:</span>
                  <span className="text-sm font-black text-[#0054A6]">
                    {format(selectedAccount.cost.totalMonthlyCostUsd)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Oportunidades de Remediación Específicas del Recurso */}
          {selectedAccount.recommendations.length > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                <IconSparkles size={18} stroke={1.5} className="text-[#0078D4]" />
                {t("recommendationsForResource", { fallback: "Oportunidades de Optimización Detectadas para este Recurso" })}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedAccount.recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h5 className="text-xs font-bold text-[#1B2A41] dark:text-white flex items-center gap-1.5">
                          <span>{rec.title}</span>
                        </h5>
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:text-emerald-400">
                          <IconCoin size={14} stroke={1.5} className="text-emerald-600 dark:text-emerald-400" />
                          +{format(rec.savingsMonthlyUsd)}/mes
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
                        {rec.description}
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">
                          {t("risk", { fallback: "Riesgo" })}: {rec.risk}
                        </span>
                        <span className="text-[10px] text-slate-300">·</span>
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">
                          {t("confidence", { fallback: "Confianza" })}: {rec.confidence}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveRemediation({
                            action: rec,
                            resourceName: selectedAccount.name,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-[#0054A6] hover:bg-blue-50 dark:hover:bg-blue-950 transition-all shadow-xs"
                      >
                        <IconTerminal2 size={16} stroke={1.5} />
                        {t("viewScript", { fallback: "Ver Script ✨" })}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tabla FinOps CMP: Todos los recursos Cosmos DB */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
              <IconDatabase size={20} stroke={1.5} className="text-[#0078D4]" />
              <span>{t("tableTitle", { fallback: "Inventario Detallado de Azure Cosmos DB" })}</span>
              <InfoTooltip content={t("tableTooltip", { fallback: "Lista exhaustiva de cuentas NoSQL y clústeres MongoDB vCore con métricas operativas y costos mensuales." })} />
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t("tableSubtitle", { fallback: "Monitoreo de throughput, tasa de 429 throttling, costo y potencial de ahorro." })}
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {total} {t("resourcesCount", { fallback: "recursos encontrados" })}
          </span>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50">
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300">{t("colAccount", { fallback: "Recurso" })}</ResizableTh>
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300">{t("colApi", { fallback: "API / Tipo" })}</ResizableTh>
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300">{t("colRegion", { fallback: "Región & RG" })}</ResizableTh>
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300">{t("colMode", { fallback: "Modo" })}</ResizableTh>
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colCapacity", { fallback: "Capacidad" })}</ResizableTh>
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colUtilization", { fallback: "RU % (Avg/P95)" })}</ResizableTh>
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colThrottling", { fallback: "429 Rate" })}</ResizableTh>
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colCost", { fallback: "Costo Mensual" })}</ResizableTh>
                <ResizableTh className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colSavings", { fallback: "Ahorro Potencial" })}</ResizableTh>
                <th className="py-3 px-3 font-bold text-slate-700 dark:text-slate-300 text-center">{t("colActions", { fallback: "Acción" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    {t("noRecords", { fallback: "No se encontraron cuentas de Cosmos DB con los filtros seleccionados." })}
                  </td>
                </tr>
              ) : (
                paged.map((acc) => {
                  const isSelected = acc.id === selectedResourceId;
                  const maxSaving = acc.recommendations.reduce((max, r) => Math.max(max, r.savingsMonthlyUsd), 0);

                  return (
                    <tr
                      key={acc.id}
                      onClick={() => setSelectedResourceId(acc.id)}
                      className={`cursor-pointer transition-colors hover:bg-blue-50/40 dark:hover:bg-slate-800/40 ${
                        isSelected ? "bg-blue-50/60 dark:bg-slate-800/60 font-medium" : ""
                      }`}
                    >
                      <td className="py-3 px-3 font-bold text-[#1B2A41] dark:text-white">
                        <div className="flex items-center gap-1.5">
                          <IconDatabase size={16} stroke={1.5} className="text-[#0078D4] shrink-0" />
                          <span className="truncate max-w-[180px]">{acc.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                        <span className="truncate max-w-[140px] block">{acc.apiLabel}</span>
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                        <div className="text-[11px]">{acc.region}</div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[120px]">{acc.resourceGroup}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            acc.throughputProfile.mode === "autoscale"
                              ? "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300"
                              : acc.throughputProfile.mode === "serverless"
                              ? "bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300"
                              : acc.throughputProfile.mode === "vcore"
                              ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {acc.throughputProfile.mode}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-slate-800 dark:text-slate-200">
                        {acc.architecture === "ru-based"
                          ? acc.throughputProfile.mode === "serverless"
                            ? "Serverless"
                            : `${(acc.throughputProfile.totalProvisionedRu || 0).toLocaleString()} RU`
                          : `${acc.throughputProfile.vCores} vCores`}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {acc.architecture === "ru-based" ? (
                          <span
                            className={
                              acc.metrics.avgNormalizedRuPct < 20 && acc.throughputProfile.mode === "manual"
                                ? "font-bold text-amber-600"
                                : "text-slate-700 dark:text-slate-300"
                            }
                          >
                            {acc.metrics.avgNormalizedRuPct.toFixed(1)}% / {acc.metrics.p95NormalizedRuPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-400">
                            {acc.metrics.cpuPercent?.toFixed(1)}% CPU
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span
                          className={
                            acc.metrics.throttling429Rate > 0.01
                              ? "font-bold text-rose-600"
                              : "text-emerald-600"
                          }
                        >
                          {(acc.metrics.throttling429Rate * 100).toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-[#1B2A41] dark:text-white">
                        {format(acc.cost.totalMonthlyCostUsd)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {maxSaving > 0 ? (
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            +{format(maxSaving)}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedResourceId(acc.id);
                            const recs = acc.recommendations.length > 0
                              ? acc.recommendations
                              : [
                                  {
                                    id: `${acc.id}-default-tuning`,
                                    ruleKey: "index_overhead" as const,
                                    title: "Optimización y Tuning de Directiva de Indexación",
                                    description: `Cosmos DB indexa automáticamente todas las propiedades por defecto. Configurar directivas 'excludedPaths' para rutas no consultadas reduce el consumo de RU/s en inserciones y previene sobrecostos de almacenamiento de índices.`,
                                    savingsMonthlyUsd: 15,
                                    risk: "low" as const,
                                    confidence: "high" as const,
                                    actionType: "guided" as const,
                                    cliCommand: `az cosmosdb sql container update \\
  --account-name ${acc.name} \\
  --resource-group ${acc.resourceGroup} \\
  --database-name defaultDb \\
  --name defaultContainer \\
  --idx @indexingPolicy.json`,
                                    bicepSnippet: `resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '${acc.name}/defaultDb/defaultContainer'
  properties: {
    resource: {
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [{ path: '/id/?' }, { path: '/tenantId/?' }]
        excludedPaths: [{ path: '/*' }]
      }
    }
  }
}`,
                                  },
                                ];
                            setActiveRemediation({
                              action: recs[0],
                              allActions: recs,
                              resourceName: acc.name,
                            });
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-[#0054A6] hover:bg-blue-50 dark:hover:bg-blue-950 transition-all shadow-xs"
                        >
                          <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                          {t("inspect", { fallback: "Optimizar" })}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <Pagination
            page={page}
            setPage={setPage}
            pageSize={pageSize}
            setPageSize={setPageSize}
            total={total}
            totalPages={totalPages}
            pageSizes={[15, 30, 45, 60]}
          />
        </div>
      </section>

      {/* Modal / Portal de Sugerencias de Optimización Interactivas (Azure CLI & Bicep) */}
      {activeRemediation &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <IconSparkles size={24} stroke={1.5} className="text-[#0078D4] shrink-0" />
                  <div>
                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                      <span>Sugerencias de Optimización</span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:text-emerald-400">
                        <IconCoin size={16} stroke={1.5} className="text-emerald-600 dark:text-emerald-400" />
                        +{format(activeRemediation.action.savingsMonthlyUsd)}/mes
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t("targetResource", { fallback: "Recurso destino" })}: <strong className="text-slate-700 dark:text-slate-200">{activeRemediation.resourceName}</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveRemediation(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 transition-colors"
                >
                  <IconX size={20} stroke={1.5} />
                </button>
              </div>

              {/* Selector de Sugerencias si existen múltiples */}
              {activeRemediation.allActions && activeRemediation.allActions.length > 1 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Oportunidades de Optimización Detectadas ({activeRemediation.allActions.length}):
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {activeRemediation.allActions.map((act, idx) => {
                      const isCur = act.id === activeRemediation.action.id;
                      return (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() =>
                            setActiveRemediation({
                              action: act,
                              allActions: activeRemediation.allActions,
                              resourceName: activeRemediation.resourceName,
                            })
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            isCur
                              ? "bg-[#0054A6] text-white shadow-xs"
                              : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                          }`}
                        >
                          <span>{idx + 1}. {act.title}</span>
                          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${isCur ? "text-emerald-200" : "text-emerald-600 dark:text-emerald-400"}`}>
                            <IconCoin size={12} stroke={1.5} />
                            +{format(act.savingsMonthlyUsd)}/m
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tarjeta de Detalle de la Recomendación */}
              <div className="rounded-xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 leading-relaxed space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white">
                    {activeRemediation.action.title}
                  </h4>
                  <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-600 dark:text-emerald-400">
                    <IconCoin size={18} stroke={1.5} className="text-emerald-600 dark:text-emerald-400" />
                    Ahorro Estimado: +{format(activeRemediation.action.savingsMonthlyUsd)}/mes
                  </span>
                </div>
                <p>{activeRemediation.action.description}</p>
                <div className="pt-2 flex items-center gap-4 text-xs font-semibold text-slate-500 border-t border-slate-100 dark:border-slate-800">
                  <span className="inline-flex items-center gap-1">
                    <IconShield size={16} stroke={1.5} className="text-[#0078D4]" />
                    {t("risk", { fallback: "Riesgo" })}: <strong className="text-slate-700 dark:text-slate-200 uppercase">{activeRemediation.action.risk}</strong>
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <IconTarget size={16} stroke={1.5} className="text-[#0078D4]" />
                    {t("confidence", { fallback: "Confianza" })}: <strong className="text-slate-700 dark:text-slate-200 uppercase">{activeRemediation.action.confidence}</strong>
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <IconBolt size={16} stroke={1.5} className="text-[#0078D4]" />
                    Tipo de acción: <strong className="text-slate-700 dark:text-slate-200 uppercase">{activeRemediation.action.actionType}</strong>
                  </span>
                </div>
              </div>

              {/* Selector de Pestañas CLI / Bicep */}
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("cli")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTab === "cli"
                      ? "bg-[#0054A6] text-white shadow-xs"
                      : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                  }`}
                >
                  Azure CLI
                </button>
                {activeRemediation.action.bicepSnippet && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("bicep")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeTab === "bicep"
                        ? "bg-[#0054A6] text-white shadow-xs"
                        : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    Bicep / ARM
                  </button>
                )}
              </div>

              {/* Bloque de Código */}
              <div className="relative">
                <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 font-mono text-xs overflow-x-auto max-h-60 leading-relaxed border border-slate-800">
                  {activeTab === "cli"
                    ? activeRemediation.action.cliCommand || "# No hay comando CLI disponible para esta acción"
                    : activeRemediation.action.bicepSnippet || "# No hay snippet Bicep disponible"}
                </pre>
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      activeTab === "cli"
                        ? activeRemediation.action.cliCommand || ""
                        : activeRemediation.action.bicepSnippet || ""
                    )
                  }
                  className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition-all shadow-sm"
                >
                  {copied ? <IconCheck size={16} stroke={1.5} className="text-emerald-400" /> : <IconCopy size={16} stroke={1.5} />}
                  {copied ? t("copied", { fallback: "Copiado" }) : t("copy", { fallback: "Copiar" })}
                </button>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs text-slate-400">
                  Ejecute estos comandos en Azure Cloud Shell o pipeline de CI/CD para aplicar la optimización.
                </span>
                <button
                  type="button"
                  onClick={() => setActiveRemediation(null)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  {t("close", { fallback: "Cerrar" })}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

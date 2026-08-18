"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Copy,
  Check,
  Database,
  ExternalLink,
  Gauge,
  Info,
  Layers,
  Orbit,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
  Terminal,
  Wallet,
  X,
  Zap,
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

  const items = useMemo(() => data?.instances || [], [data]);

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
              <Orbit className="w-5 h-5 text-[#0054A6]" />
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
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-[#0054A6]" : "text-[#0054A6]"}`} />
            {refreshing ? t("refreshing", { fallback: "Actualizando..." }) : t("refresh", { fallback: "Actualizar datos" })}
          </button>
        </div>
      </section>

      {/* Filtros Superiores Estándar FinOps CMP */}
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
        <section className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-950/20 p-4 text-sm text-rose-700 dark:text-rose-400">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        </section>
      )}

      {/* 8 KPI Cards Corporativas */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Costo MTD */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="h-4 w-4 text-[#0054A6]" />
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
              <Gauge className="h-4 w-4 text-[#6B35C1]" />
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
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="h-4 w-4 text-emerald-600" />
              {t("kpiSavings", { fallback: "Ahorro Potencial" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_savings", { fallback: "Suma de ahorros mensuales estimados por migración a Autoscale/Serverless, Free Tier y reservas." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {format(finSummary?.potentialSavings || 0)}
          </p>
          <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-400/80">
            {allRecommendations.length} {t("actionsDetected", { fallback: "oportunidades detectadas" })}
          </p>
        </div>

        {/* KPI 4: Variación MoM */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-500" />
              {t("kpiDeltaMoM", { fallback: "Variación MoM" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_delta", { fallback: "Incremento o reducción porcentual del costo respecto al mismo período del mes anterior." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-[#1B2A41] dark:text-white flex items-center gap-1">
            {(finSummary?.deltaMoM?.percentage || 0) >= 0 ? (
              <ArrowUpRight className="w-6 h-6 text-rose-500" />
            ) : (
              <ArrowDownRight className="w-6 h-6 text-emerald-500" />
            )}
            {Math.abs(finSummary?.deltaMoM?.percentage || 0).toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-400">{format(finSummary?.deltaMoM?.value || 0)} MoM</p>
        </div>

        {/* KPI 5: Recursos Detectados */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-[#00AEEF]" />
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
              <Gauge className="h-4 w-4 text-[#0054A6]" />
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
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-amber-600" />
              {t("kpiUnderutilized", { fallback: "RU Subutilizadas" })}
            </span>
            <InfoTooltip content={t("tooltip_kpi_underutilized", { fallback: "Cuentas con Throughput Manual cuya utilización normalizada es inferior al 20%." })} />
          </div>
          <p className="mt-3 text-2xl font-black text-amber-600 dark:text-amber-400">
            {efficiency?.underutilizedCount || 0}
          </p>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/80">
            {t("candidatesForAutoscale", { fallback: "candidatas a Autoscale" })}
          </p>
        </div>

        {/* KPI 8: Salud Operativa */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
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

      {/* Detalle del Recurso Seleccionado en Grid de 3 Columnas */}
      {selectedAccount && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#0054A6]">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                  <span>{selectedAccount.name}</span>
                  <span className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-xs font-semibold text-[#0054A6] border border-blue-200 dark:border-blue-800">
                    {selectedAccount.apiLabel}
                  </span>
                  {selectedAccount.throughputProfile.freeTierEnabled && (
                    <span className="inline-flex items-center rounded-md bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-300">
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
            {/* Columna 1: Identidad, API y Topología */}
            <div className="space-y-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-4">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/60 dark:border-slate-700 pb-2">
                <Server className="w-4 h-4 text-[#0054A6]" />
                {t("colIdentity", { fallback: "Identidad & Red" })}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelApiKind", { fallback: "Modelo de API" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedAccount.kind}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelArchitecture", { fallback: "Arquitectura" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 capitalize">{selectedAccount.architecture}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelDedicatedGateway", { fallback: "Dedicated Gateway" })}:</span>
                  <span className={`font-semibold ${selectedAccount.throughputProfile.dedicatedGatewayEnabled ? "text-emerald-600" : "text-slate-400"}`}>
                    {selectedAccount.throughputProfile.dedicatedGatewayEnabled ? t("enabled", { fallback: "Habilitado" }) : t("disabled", { fallback: "Deshabilitado" })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelAnalyticalStore", { fallback: "Analytical Store" })}:</span>
                  <span className={`font-semibold ${selectedAccount.throughputProfile.analyticalStoreEnabled ? "text-emerald-600" : "text-slate-400"}`}>
                    {selectedAccount.throughputProfile.analyticalStoreEnabled ? t("enabled", { fallback: "Habilitado (Synapse Link)" }) : t("disabled", { fallback: "Deshabilitado" })}
                  </span>
                </div>
                {selectedAccount.endpoints?.documentEndpoint && (
                  <div className="pt-2">
                    <span className="text-slate-500 block mb-1">{t("labelEndpoint", { fallback: "URI de Conexión" })}:</span>
                    <code className="block p-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 truncate">
                      {selectedAccount.endpoints.documentEndpoint}
                    </code>
                  </div>
                )}
              </div>
            </div>

            {/* Columna 2: Rendimiento & Replicación */}
            <div className="space-y-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-4">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/60 dark:border-slate-700 pb-2">
                <Gauge className="w-4 h-4 text-[#00AEEF]" />
                {t("colThroughput", { fallback: "Rendimiento & Replicación" })}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelMode", { fallback: "Modo Throughput" })}:</span>
                  <span className="font-bold text-[#0054A6] uppercase tracking-wide">
                    {selectedAccount.throughputProfile.mode}
                  </span>
                </div>
                {selectedAccount.architecture === "ru-based" ? (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelProvisionedRu", { fallback: "Capacidad Asignada" })}:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedAccount.throughputProfile.mode === "serverless"
                          ? "Serverless (On-Demand)"
                          : `${(selectedAccount.throughputProfile.totalProvisionedRu || 0).toLocaleString()} RU/s`}
                      </span>
                    </div>
                    {selectedAccount.throughputProfile.mode === "autoscale" && (
                      <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-slate-500">{t("labelMaxAutoscale", { fallback: "Max Autoscale" })}:</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {(selectedAccount.throughputProfile.maxAutoscaleRu || 0).toLocaleString()} RU/s (10% - 100%)
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelVcores", { fallback: "Cómputo vCore" })}:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedAccount.throughputProfile.vCores} vCores · {selectedAccount.throughputProfile.ramGb} GiB RAM
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelHaMode", { fallback: "Alta Disponibilidad (HA)" })}:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedAccount.throughputProfile.highAvailability || "Disabled"}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelRegionsCount", { fallback: "Regiones Activas" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedAccount.throughputProfile.regionsCount} ({selectedAccount.throughputProfile.isMultiRegionWrite ? "Multi-Write" : "Single-Write"})
                  </span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-500 block mb-1">{t("labelRegionsList", { fallback: "Topología de Regiones" })}:</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedAccount.throughputProfile.regionsList.map((reg) => (
                      <span
                        key={reg.name}
                        className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-300"
                      >
                        {reg.name} {reg.isWriteRegion ? "✍️ (Escritura)" : "📖 (Lectura)"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Columna 3: Métricas, FinOps & Storage */}
            <div className="space-y-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-4">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-200/60 dark:border-slate-700 pb-2">
                <Coins className="w-4 h-4 text-emerald-600" />
                {t("colFinopsStorage", { fallback: "Telemetría & Desglose de Costo" })}
              </h4>
              <div className="space-y-2 text-xs">
                {selectedAccount.architecture === "ru-based" ? (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelAvgNormalizedRu", { fallback: "RU Consumo Normalizado (Avg / P95)" })}:</span>
                      <span className={`font-semibold ${selectedAccount.metrics.avgNormalizedRuPct < 20 ? "text-amber-600 font-bold" : "text-slate-800 dark:text-slate-200"}`}>
                        {selectedAccount.metrics.avgNormalizedRuPct.toFixed(1)}% / {selectedAccount.metrics.p95NormalizedRuPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">{t("labelThrottling", { fallback: "Tasa Throttling (HTTP 429)" })}:</span>
                      <span className={`font-semibold ${selectedAccount.metrics.throttling429Rate > 0.01 ? "text-rose-600 font-bold" : "text-emerald-600"}`}>
                        {(selectedAccount.metrics.throttling429Rate * 100).toFixed(2)}% ({selectedAccount.metrics.throttledRequests} reqs)
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">{t("labelVcoreMetrics", { fallback: "CPU / Memoria / Disco" })}:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedAccount.metrics.cpuPercent?.toFixed(1)}% CPU · {selectedAccount.metrics.memoryPercent?.toFixed(1)}% RAM
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelStorageUsage", { fallback: "Datos / Índices Storage" })}:</span>
                  <span className={`font-semibold ${selectedAccount.storage.indexRatio > 0.5 ? "text-amber-600" : "text-slate-800 dark:text-slate-200"}`}>
                    {selectedAccount.storage.dataUsageGb} GB / {selectedAccount.storage.indexUsageGb} GB (Ratio: {(selectedAccount.storage.indexRatio * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelCostThroughput", { fallback: "Costo Throughput / Storage" })}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {format(selectedAccount.cost.throughputMonthlyUsd)} / {format(selectedAccount.cost.storageMonthlyUsd)}
                  </span>
                </div>
                <div className="flex justify-between py-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="font-bold text-[#1B2A41] dark:text-white">{t("labelTotalCost", { fallback: "Costo Mensual Total" })}:</span>
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
                <Sparkles className="w-4 h-4 text-[#0054A6]" />
                {t("recommendationsForResource", { fallback: "Oportunidades de Optimización Detectadas para este Recurso" })}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedAccount.recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex flex-col justify-between rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/20 p-4 shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h5 className="text-xs font-bold text-[#1B2A41] dark:text-white flex items-center gap-1.5">
                          <span>{rec.title}</span>
                        </h5>
                        <span className="inline-flex items-center rounded-md bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:text-emerald-400">
                          +{format(rec.savingsMonthlyUsd)}/mes
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
                        {rec.description}
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-blue-100 dark:border-blue-900/40">
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
                        <Terminal className="w-3.5 h-3.5" />
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
              <Database className="w-5 h-5 text-[#0054A6]" />
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
                          <Orbit className="w-3.5 h-3.5 text-[#0054A6] shrink-0" />
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
                            if (acc.recommendations.length > 0) {
                              setActiveRemediation({
                                action: acc.recommendations[0],
                                resourceName: acc.name,
                              });
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 px-2 py-1 text-[11px] font-bold text-[#0054A6] hover:bg-blue-50 dark:hover:bg-blue-950 transition-all"
                        >
                          <Sparkles className="w-3 h-3" />
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

      {/* Modal / Portal de Remediación Interactiva (Azure CLI & Bicep) */}
      {activeRemediation &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950 text-[#0054A6]">
                    <Terminal className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                      <span>{activeRemediation.action.title}</span>
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
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-xl bg-blue-50/50 dark:bg-blue-950/20 p-3.5 border border-blue-100 dark:border-blue-900/40 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <p>{activeRemediation.action.description}</p>
                <div className="mt-2 flex items-center gap-4 text-xs font-bold">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    💰 {t("estimatedSaving", { fallback: "Ahorro Estimado" })}: +{format(activeRemediation.action.savingsMonthlyUsd)}/mes
                  </span>
                  <span className="text-slate-500">
                    🛡️ {t("risk", { fallback: "Riesgo" })}: {activeRemediation.action.risk}
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
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
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
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
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
                    ? activeRemediation.action.cliCommand || "# No hay comando CLI disponible"
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
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? t("copied", { fallback: "Copiado" }) : t("copy", { fallback: "Copiar" })}
                </button>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
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

"use client";

import React, { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconBuildingFactory2,
  IconRepeat,
  IconCpu,
  IconRotateClockwise,
  IconDownload,
  IconSparkles,
  IconCheck,
  IconAlertTriangle,
  IconLoader2,
  IconSearch,
  IconCopy,
  IconX,
  IconBrandPowershell,
  IconTerminal2,
  IconTopologyStarRing3,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { useCurrency } from "@/components/CurrencyProvider";
import { buildAdfRemediationCommand } from "@/lib/aiRemediations";
import { forecastMonthEnd } from "@/lib/costAccrual";
import type {
  AdfResourceItem,
  AdfRemediationAction,
  AdfPayload,
} from "@/types/azureDataFactory.types";

// ─── Fetcher con autenticación Entra ID y prevención 401 ───
function buildFetcher(
  instance: any,
  accounts: any[],
  inProgress: string,
  isDemo: boolean
) {
  return async (url: string) => {
    const headers: Record<string, string> = {};

    if (!isDemo) {
      if (!accounts || accounts.length === 0 || !accounts[0]) {
        throw new Error("No hay sesión activa de Microsoft Entra ID. Inicie sesión para consultar telemetría real.");
      }
      try {
        const token = await getFreshIdToken(instance, accounts[0]);
        if (token && token !== "demo") {
          headers["Authorization"] = `Bearer ${token}`;
        }
      } catch (tokenErr) {
        console.warn("[adf-fetcher] Token acquisition failed:", tokenErr);
      }
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("No autorizado.");
      }
      throw new Error(`Error ${res.status}: ${res.statusText}`);
    }

    return res.json();
  };
}

// ─── Resizable Table Header ───
function ResizableTh({
  children,
  minWidth = 100,
  className = "",
}: {
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
}) {
  const [width, setWidth] = useState(minWidth);
  const startXRef = useRef(0);
  const startWidthRef = useRef(minWidth);

  const onMouseDown = (e: React.MouseEvent) => {
    startXRef.current = e.clientX;
    startWidthRef.current = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startXRef.current;
      setWidth(Math.max(minWidth, startWidthRef.current + delta));
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <th
      style={{ width: `${width}px`, minWidth: `${minWidth}px` }}
      className={`relative p-[10px_14px] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 select-none bg-slate-50/80 dark:bg-slate-900/80 ${className}`}
    >
      {children}
      <div
        onMouseDown={onMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50 transition-colors"
      />
    </th>
  );
}

// ─── KPI Card Corporativa con Iconos Tabler Azules sin Fondo ───
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string; stroke?: number }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-4 flex items-center gap-3">
      <Icon className="w-6 h-6 text-[#0078D4] shrink-0" stroke={1.5} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 truncate">
          {label}
        </p>
        <p className="text-xl font-extrabold text-[#1B2A41] dark:text-slate-100 truncate">
          {value}
        </p>
        <p className="text-[11px] text-slate-400 truncate">{sub}</p>
      </div>
    </div>
  );
}

// ─── Modal de Remediación y Simulación en Capa Z-50 ───
function RemediationModal({
  action,
  onClose,
}: {
  action: AdfRemediationAction;
  onClose: () => void;
}) {
  const { format } = useCurrency();
  const [activeTab, setActiveTab] = useState<"CLI" | "POWERSHELL">("CLI");
  const [copied, setCopied] = useState(false);

  const commands = buildAdfRemediationCommand(action);
  const currentCode = activeTab === "CLI" ? commands.cli : commands.powershell;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden z-50 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="font-bold text-base text-[#1B2A41] dark:text-slate-100">
              Simulador de Optimización Data Factory
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 mb-1">
              {action.title}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {action.description}
            </p>
          </div>

          {/* Comparador de Cómputo / IR */}
          {action.category === "IR_DOWNGRADE" && (
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-blue-900 dark:text-blue-300">
                  Simulación de Rightsizing en Integration Runtime
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro estimado: ~{format(action.estimatedSavingsUSD)}/mes
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Capacidad Actual</p>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                    {action.currentCores || 16} Cores / Sin TTL
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Cómputo ocioso continuo</p>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-300 dark:border-emerald-800">
                  <p className="text-[10px] text-emerald-600 font-bold uppercase">Capacidad Óptima</p>
                  <p className="text-sm font-extrabold text-emerald-600 mt-0.5">
                    {action.recommendedCores || 8} Cores + TTL 10 min
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Escalado bajo demanda</p>
                </div>
              </div>
            </div>
          )}

          {action.category === "DATA_FLOW_CACHE_ENABLE" && (
            <div className="bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-sky-900 dark:text-sky-300">
                  Quick Reuse & Reutilización de Clusters Spark
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro estimado: ~{format(action.estimatedSavingsUSD)}/mes
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Al activar el TTL de 15 minutos en el Managed IR, los Data Flows consecutivos reutilizan el cluster Spark precalentado, eliminando 4-5 minutos de tiempo de inicio por pipeline.
              </p>
            </div>
          )}

          {action.category === "ORPHAN_PURGE" && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 font-bold">
                <IconAlertTriangle className="w-4 h-4 text-amber-600" />
                Higiene de Factorías & Desmantelamiento de Pipelines Inactivos
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                La eliminación de factorías y runtimes sin ejecuciones en 30 días remueve endpoints privados, storage accounts de staging y reduce la superficie de ataque.
              </p>
            </div>
          )}

          {/* Selector CLI / PowerShell */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Script de Ejecución Automatizada:
              </span>
              <div className="flex rounded-lg p-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setActiveTab("CLI")}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${
                    activeTab === "CLI"
                      ? "bg-white dark:bg-slate-900 text-[#0054A6] shadow-xs"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <IconTerminal2 className="w-3.5 h-3.5" />
                  Azure CLI
                </button>
                <button
                  onClick={() => setActiveTab("POWERSHELL")}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${
                    activeTab === "POWERSHELL"
                      ? "bg-white dark:bg-slate-900 text-[#0054A6] shadow-xs"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <IconBrandPowershell className="w-3.5 h-3.5" />
                  PowerShell
                </button>
              </div>
            </div>

            <div className="relative group">
              <pre className="p-3.5 bg-slate-950 text-slate-200 rounded-xl text-xs font-mono overflow-x-auto whitespace-pre-wrap border border-slate-800">
                {currentCode}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer Modal */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cerrar
          </button>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <IconCheck className="w-4 h-4 text-emerald-600" />
                Copiado
              </>
            ) : (
              <>
                <IconCopy className="w-4 h-4" />
                Copiar y Ejecutar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal AdfFinopsDashboard ───
export default function AdfFinopsDashboard() {
  const { selectedTenant } = useTenant();
  const { instance, accounts, inProgress } = useMsal();
  const { format } = useCurrency();
  const searchParams = useSearchParams();

  const isMockQuery = searchParams?.get("mock") === "true";
  const tenantId = selectedTenant?.id;
  const isDemo = Boolean((tenantId && isMockTenant(tenantId)) || isMockQuery);
  const canFetch = !!tenantId && tenantId !== "default" && inProgress === "none" && (accounts.length > 0 || isDemo);

  const [filterResource, setFilterResource] = useState("ALL");
  const [filterRegion, setFilterRegion] = useState("ALL");
  const [filterResourceGroup, setFilterResourceGroup] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof AdfResourceItem>("costMtdUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [activeModalAction, setActiveModalAction] = useState<AdfRemediationAction | null>(null);

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, inProgress, isDemo),
    [instance, accounts, inProgress, isDemo]
  );

  const apiUrl = canFetch
    ? `/api/intelligence/integration-services/adf?tenantId=${encodeURIComponent(tenantId!)}${isDemo ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<AdfPayload>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false }
  );

  const isRefreshing = isLoading;

  if (!selectedTenant || selectedTenant.id === "default") return null;

  if (!data && !error) {
    return (
      <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-24 flex flex-col items-center justify-center">
        <IconLoader2 className="w-8 h-8 animate-spin text-[#0078D4] mb-4" stroke={1.5} />
        <p className="text-slate-500">Cargando telemetría de Azure Data Factory...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <IconAlertTriangle className="w-6 h-6 shrink-0 mt-0.5 text-amber-500" stroke={1.5} />
            <div>
              <h3 className="font-bold text-base text-[#1B2A41] dark:text-slate-100">
                Estado de Conexión a Azure Data Factory
              </h3>
              <p className="text-sm mt-1 text-slate-600 dark:text-slate-400">
                {error.message === "No autorizado."
                  ? "Sesión no autorizada o token de Entra ID expirado. Si utiliza una cuenta de demostración, active el modo demo."
                  : error.message}
              </p>
              <p className="text-xs text-slate-400 mt-2">
                Tenant: {tenantId} {isDemo ? "(Modo Demo)" : "(Tenant Conectado)"}
              </p>
            </div>
          </div>
          <button
            onClick={() => mutate()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer shrink-0"
          >
            <IconRotateClockwise className="w-4 h-4" />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const items = data?.items || [];
  const summary = data?.summary || {
    costMtdUSD: 0,
    totalDataFactories: 0,
    totalPipelineRunsMTD: 0,
    totalIntegrationRuntimes: 0,
    potentialSavingsUSD: 0,
  };
  const remediationActions = data?.remediationActions || [];
  const costDistribution = data?.costDistribution || [];
  const trendHistory = data?.trendHistory || [];

  // ─── Opciones de Filtros Inmediatos ───
  const resourceOptions = ["ALL", ...new Set(items.map((i) => i.name))];
  const regionOptions = ["ALL", ...new Set(items.map((i) => i.location))];
  const rgOptions = ["ALL", ...new Set(items.map((i) => i.resourceGroup))];

  // ─── Filtrado ───
  const filteredItems = items
    .filter((i) => filterResource === "ALL" || i.name === filterResource)
    .filter((i) => filterRegion === "ALL" || i.location === filterRegion)
    .filter((i) => filterResourceGroup === "ALL" || i.resourceGroup === filterResourceGroup)
    .filter((i) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        i.resourceGroup.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q)
      );
    });

  // ─── Ordenamiento ───
  const sortedItems = [...filteredItems].sort((a, b) => {
    const valA = a[sortKey];
    const valB = b[sortKey];
    if (typeof valA === "number" && typeof valB === "number") {
      return sortDir === "asc" ? valA - valB : valB - valA;
    }
    return sortDir === "asc"
      ? String(valA || "").localeCompare(String(valB || ""))
      : String(valB || "").localeCompare(String(valA || ""));
  });

  // ─── Paginación ───
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const paginatedItems = sortedItems.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  const handleSort = (key: keyof AdfResourceItem) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  // ─── Exportación ───
  const exportCSV = () => {
    const headers = [
      "Data Factory",
      "Región",
      "Grupo de Recursos",
      "Suscripción",
      "Costo MTD (USD)",
      "Costo Anterior (USD)",
      "Forecast (USD)",
      "Utilización IR (%)",
      "Total Pipelines (MTD)",
      "Duración Media (min)",
      "Integration Runtimes",
    ];
    const rows = sortedItems.map((i) => [
      i.name,
      i.location,
      i.resourceGroup,
      i.subscriptionName,
      i.costMtdUSD,
      i.costPreviousPeriodUSD,
      i.forecastEomUSD,
      `${i.avgIRUtilizationPercentage}%`,
      i.totalPipelineRuns,
      i.avgPipelineDurationMinutes,
      i.integrationRuntimesCount,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `adf-finops-${tenantId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* ─── Encabezado y Acciones Globales ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
            <IconBuildingFactory2 className="w-7 h-7 text-[#0078D4]" stroke={1.5} />
            Azure Data Factory (ADF) FinOps
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Gobernanza de pipelines ETL/ELT, dimensionamiento de Managed IR / Azure-SSIS, caché de Data Flows y detección de factorías huérfanas.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => mutate()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
          >
            <IconRotateClockwise className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg shadow-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <IconDownload className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* ─── Filtros Inmediatos Obligatorios ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50/50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Data Factory
          </label>
          <select
            value={filterResource}
            onChange={(e) => {
              setFilterResource(e.target.value);
              setPage(1);
            }}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {resourceOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt === "ALL" ? "Todas las Factorías" : opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Región
          </label>
          <select
            value={filterRegion}
            onChange={(e) => {
              setFilterRegion(e.target.value);
              setPage(1);
            }}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {regionOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt === "ALL" ? "Todas las Regiones" : opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Grupo de Recursos
          </label>
          <select
            value={filterResourceGroup}
            onChange={(e) => {
              setFilterResourceGroup(e.target.value);
              setPage(1);
            }}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {rgOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt === "ALL" ? "Todos los Grupos" : opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Header y KPI Cards Superiores (4 Tarjetas) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={IconCash}
          label="Costo ADF MTD"
          value={format(summary.costMtdUSD)}
          sub={`Proyección Fin de Mes: ${format(forecastMonthEnd(summary.costMtdUSD, new Date()))}`}
        />
        <KpiCard
          icon={IconBuildingFactory2}
          label="Data Factories Activas"
          value={String(summary.totalDataFactories)}
          sub="Instancias en suscripciones activas"
        />
        <KpiCard
          icon={IconRepeat}
          label="Total Pipelines Ejecutados"
          value={summary.totalPipelineRunsMTD.toLocaleString()}
          sub="Volumen acumulado MTD"
        />
        <KpiCard
          icon={IconCpu}
          label="Integration Runtimes"
          value={String(summary.totalIntegrationRuntimes)}
          sub={`Ahorro Identificado: ${format(summary.potentialSavingsUSD)}/mes`}
        />
      </div>

      {/* ─── Fila 1: Gráficas de Capacidad & Desglose de Costo ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel Izquierdo: Donut Chart Distribución de Costos por Tipo de Recurso */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              Distribución de Costos por Componente
            </h3>
            <span className="text-[11px] text-slate-400">Mensual</span>
          </div>

          <div className="h-64 w-full">
            {costDistribution.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Sin datos de distribución
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={costDistribution}
                    dataKey="costUSD"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                  >
                    {costDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: any) => [format(Number(value)), "Costo MTD"]}
                    contentStyle={{
                      backgroundColor: "#1B2A41",
                      border: "none",
                      borderRadius: "8px",
                      color: "#FFFFFF",
                      fontSize: "12px",
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    formatter={(val, entry: any) => (
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        {val} - {format(entry.payload.costUSD)}
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Panel Derecho: Evolución Temporal de Pipelines Ejecutados */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              Evolución Temporal de Pipelines Ejecutados
            </h3>
            <span className="text-[11px] text-slate-400">Últimos 30 días</span>
          </div>

          <div className="h-64 w-full">
            {trendHistory.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Sin telemetría histórica de ejecuciones
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="successAdfGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0078D4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="failedAdfGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#64748B" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#64748B" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94A3B8" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94A3B8" />
                  <RechartsTooltip
                    formatter={(val: any, name: any) => [
                      val.toLocaleString(),
                      name === "successfulRuns" ? "Runs Exitosos" : "Runs Fallidos",
                    ]}
                    contentStyle={{
                      backgroundColor: "#1B2A41",
                      border: "none",
                      borderRadius: "8px",
                      color: "#FFFFFF",
                      fontSize: "12px",
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    formatter={(val) => (
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        {val === "successfulRuns" ? "Ejecuciones Exitosas" : "Ejecuciones Fallidas"}
                      </span>
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="successfulRuns"
                    stroke="#0078D4"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#successAdfGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="failedRuns"
                    stroke="#64748B"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#failedAdfGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ─── Fila 2: Tabla CMP "Desglose por Data Factory" ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconTopologyStarRing3 className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              Desglose por Data Factory
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Inventario de factorías, utilización de Integration Runtimes, rendimiento y optimización en 1 clic.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <IconSearch className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar factoría, grupo..."
                className="pl-9 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 w-52"
              />
            </div>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs p-1.5 text-slate-800 dark:text-slate-200"
            >
              <option value={15}>15 por pág.</option>
              <option value={30}>30 por pág.</option>
              <option value={45}>45 por pág.</option>
              <option value={60}>60 por pág.</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <ResizableTh minWidth={220}>
                  <button
                    onClick={() => handleSort("name")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Data Factory
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    onClick={() => handleSort("location")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Región
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={140}>
                  <button
                    onClick={() => handleSort("resourceGroup")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Grupo de Recursos
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={140}>
                  <span className="font-bold text-slate-700 dark:text-slate-300">Suscripción</span>
                </ResizableTh>
                <ResizableTh minWidth={100}>
                  <button
                    onClick={() => handleSort("costMtdUSD")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Costo MTD
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={100}>
                  <button
                    onClick={() => handleSort("costPreviousPeriodUSD")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Costo Ant.
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={100}>
                  <button
                    onClick={() => handleSort("forecastEomUSD")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Forecast
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={120}>
                  <button
                    onClick={() => handleSort("avgIRUtilizationPercentage")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    % Utilización IR
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    onClick={() => handleSort("totalPipelineRuns")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Total Runs
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    onClick={() => handleSort("avgPipelineDurationMinutes")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Duración Media
                  </button>
                </ResizableTh>
                <th className="p-[10px_14px] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right bg-slate-50/80 dark:bg-slate-900/80 min-w-[110px]">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400 text-xs">
                    No se encontraron factorías de ADF con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item) => {
                  const hasAction = remediationActions.some(
                    (a) => a.resourceId === item.id || a.resourceName === item.name
                  );
                  const matchingAction = remediationActions.find(
                    (a) => a.resourceId === item.id || a.resourceName === item.name
                  );

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="p-3 font-medium text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          <IconTopologyStarRing3 className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className="truncate max-w-[170px]" title={item.name}>
                            {item.name}
                          </span>
                          {item.isOrphan ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Huérfana
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              Activa
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">{item.location}</td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        <span className="truncate max-w-[130px] block" title={item.resourceGroup}>
                          {item.resourceGroup}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        <span className="truncate max-w-[130px] block" title={item.subscriptionName}>
                          {item.subscriptionName}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-slate-900 dark:text-slate-100">
                        {format(item.costMtdUSD)}
                      </td>
                      <td className="p-3 text-slate-500">{format(item.costPreviousPeriodUSD)}</td>
                      <td className="p-3 text-slate-500">{format(item.forecastEomUSD)}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.avgIRUtilizationPercentage > 75
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : item.avgIRUtilizationPercentage < 25
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200"
                          }`}
                        >
                          {item.avgIRUtilizationPercentage.toFixed(1)}% ({item.integrationRuntimesCount} IRs)
                        </span>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        {item.totalPipelineRuns.toLocaleString()}
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        {item.avgPipelineDurationMinutes > 0
                          ? `${item.avgPipelineDurationMinutes.toFixed(1)} min`
                          : "-"}
                      </td>
                      <td className="p-3 text-right">
                        {hasAction && matchingAction ? (
                          <button
                            onClick={() => setActiveModalAction(matchingAction)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-md shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                          >
                            <IconSparkles className="w-3 h-3" />
                            Optimizar
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">Optimizado</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ─── Paginación ─── */}
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-slate-400">
            Mostrando {Math.min(filteredItems.length, (page - 1) * pageSize + 1)} -{" "}
            {Math.min(filteredItems.length, page * pageSize)} de {filteredItems.length} factorías
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
            >
              Anterior
            </button>
            <span className="text-xs px-2 text-slate-500">
              {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>

      {/* ─── Panel de Recomendaciones Priorizadas de ADF ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
              Oportunidades de Optimización de Cómputo e IR en ADF
            </h3>
          </div>
          <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
            Ahorro Total: ~{format(summary.potentialSavingsUSD)}/mes
          </span>
        </div>

        {remediationActions.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-50/50 dark:bg-slate-950/50 rounded-xl">
            Todas las factorías de ADF operan en el nivel óptimo de cómputo y TTL.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {remediationActions.map((action) => (
              <div
                key={action.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs flex flex-col justify-between hover:border-blue-300 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${
                        action.category === "IR_DOWNGRADE"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : action.category === "DATA_FLOW_CACHE_ENABLE"
                          ? "bg-sky-50 text-sky-700 border-sky-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {action.category.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs font-extrabold text-emerald-600">
                      +{format(action.estimatedSavingsUSD)}/mes
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-1">
                    {action.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-3">
                    {action.description}
                  </p>
                </div>

                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    Confianza: {action.confidence}
                  </span>
                  <button
                    onClick={() => setActiveModalAction(action)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                  >
                    <IconSparkles className="w-3.5 h-3.5" />
                    Simular & Aplicar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Modal Z-50 de Simulación ─── */}
      {activeModalAction && (
        <RemediationModal
          action={activeModalAction}
          onClose={() => setActiveModalAction(null)}
        />
      )}
    </div>
  );
}

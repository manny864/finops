"use client";

import React, { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconTopologyStarRing3,
  IconBroadcast,
  IconLayersLinked,
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
import { useCurrency } from "@/components/CurrencyProvider";
import { buildEventGridRemediationCommand } from "@/lib/aiRemediations";
import type {
  EventGridResourceItem,
  EventGridRemediationAction,
  EventGridPayload,
  EventGridSkuName,
} from "@/types/azureEventGrid.types";

const SKU_BADGE_CLASSES: Record<EventGridSkuName, string> = {
  Premium:
    "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  Basic:
    "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800",
};

// ─── Fetcher con autenticación Entra ID y prevención 401 ───
function buildFetcher(
  instance: any,
  accounts: any[],
  inProgress: string,
  isDemo: boolean
) {
  return async (url: string) => {
    const headers: Record<string, string> = {};

    if (!isDemo && accounts.length > 0 && inProgress === "none") {
      try {
        const tokenResponse = await instance.acquireTokenSilent({
          scopes: ["https://management.azure.com/.default"],
          account: accounts[0],
        });
        if (tokenResponse?.accessToken) {
          headers["Authorization"] = `Bearer ${tokenResponse.accessToken}`;
        }
      } catch (tokenErr) {
        console.warn("[event-grid-fetcher] Silent token acquisition failed:", tokenErr);
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
  action: EventGridRemediationAction;
  onClose: () => void;
}) {
  const { format } = useCurrency();
  const [activeTab, setActiveTab] = useState<"CLI" | "POWERSHELL">("CLI");
  const [copied, setCopied] = useState(false);

  const commands = buildEventGridRemediationCommand(action);
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
              Simulador de Optimización Event Grid
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

          {/* Comparador de SKUs */}
          {action.category === "SKU_DOWNGRADE" && (
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-blue-900 dark:text-blue-300">
                  Simulación de Arbitraje Premium a Basic
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro estimado: ~{format(action.estimatedSavingsUSD)}/mes
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">SKU Actual</p>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                    Premium
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Costo fijo + throughput</p>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-300 dark:border-emerald-800">
                  <p className="text-[10px] text-emerald-600 font-bold uppercase">SKU Recomendado</p>
                  <p className="text-sm font-extrabold text-emerald-600 mt-0.5">
                    Basic
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">$0.60 / 1M operaciones</p>
                </div>
              </div>
            </div>
          )}

          {action.category === "ORPHAN_PURGE" && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 font-bold">
                <IconAlertTriangle className="w-4 h-4 text-amber-600" />
                Higiene Pub/Sub & Eliminación de Temas Inactivos
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                La purga de temas huérfanos sin eventos publicados ni entregados en los últimos 30 días mantiene la arquitectura limpia y libre de recursos obsoletos.
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

// ─── Componente Principal EventGridFinopsDashboard ───
export default function EventGridFinopsDashboard() {
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
  const [filterSku, setFilterSku] = useState("ALL");
  const [filterResourceGroup, setFilterResourceGroup] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof EventGridResourceItem>("costMtdUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [activeModalAction, setActiveModalAction] = useState<EventGridRemediationAction | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, inProgress, isDemo),
    [instance, accounts, inProgress, isDemo]
  );

  const apiUrl = canFetch
    ? `/api/intelligence/integration-services/event-grid?tenantId=${encodeURIComponent(tenantId!)}${isDemo ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<EventGridPayload>(
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
        <p className="text-slate-500">Cargando telemetría de Azure Event Grid...</p>
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
                Estado de Conexión a Azure Event Grid
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
    totalDomains: 0,
    totalTopics: 0,
    totalEventsMTD: 0,
    potentialSavingsUSD: 0,
  };
  const remediationActions = data?.remediationActions || [];
  const skuDistribution = data?.skuDistribution || [];
  const trendHistory = data?.trendHistory || [];

  // ─── Opciones de Filtros Inmediatos ───
  const resourceOptions = ["ALL", ...new Set(items.map((i) => i.name))];
  const regionOptions = ["ALL", ...new Set(items.map((i) => i.location))];
  const skuOptions = ["ALL", "Basic", "Premium"];
  const rgOptions = ["ALL", ...new Set(items.map((i) => i.resourceGroup))];

  // ─── Filtrado ───
  const filteredItems = items
    .filter((i) => filterResource === "ALL" || i.name === filterResource)
    .filter((i) => filterRegion === "ALL" || i.location === filterRegion)
    .filter((i) => filterSku === "ALL" || i.skuName === filterSku)
    .filter((i) => filterResourceGroup === "ALL" || i.resourceGroup === filterResourceGroup)
    .filter((i) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        i.resourceGroup.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q) ||
        i.skuName.toLowerCase().includes(q)
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
  const paginatedItems = sortedItems.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (key: keyof EventGridResourceItem) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const exportCsv = () => {
    const headers = [
      "Recurso",
      "Tipo",
      "SKU",
      "Región",
      "Grupo de Recursos",
      "Suscripción",
      "Costo MTD (USD)",
      "Costo Anterior (USD)",
      "Forecast EOM (USD)",
      "Eventos Publicados",
      "Eventos Entregados",
      "Throughput (ops/s)",
      "Huérfano",
    ];
    const rows = sortedItems.map((i) => [
      i.name,
      i.resourceType,
      i.skuName,
      i.location,
      i.resourceGroup,
      i.subscriptionName,
      i.costMtdUSD,
      i.costPreviousPeriodUSD,
      i.forecastEomUSD,
      i.publishedEvents,
      i.deliveredEvents,
      i.throughputOpsSec ?? 0,
      i.isOrphan ? "Sí" : "No",
    ]);

    const csvContent = [headers, ...rows].map((e) => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `azure-eventgrid-finops-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in duration-200">
      {/* ─── Header de Sub-Pestaña Event Grid ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100">
              Azure Event Grid
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Monitoreo Activo
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Gobernanza de arquitectura de eventos, arbitraje de SKUs Premium, purga de temas huérfanos y métricas de throughput.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => mutate()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer disabled:opacity-50"
          >
            <IconRotateClockwise className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
          >
            <IconDownload className="w-4 h-4" />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* ─── 4 Top KPI Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={IconCash}
          label="Costo Event Grid MTD"
          value={format(summary.costMtdUSD)}
          sub={`Ahorro potencial: ${format(summary.potentialSavingsUSD)}`}
        />
        <KpiCard
          icon={IconTopologyStarRing3}
          label="Dominios Event Grid Activos"
          value={`${summary.totalDomains} Dominios`}
          sub="Instancias de arquitectura por dominios"
        />
        <KpiCard
          icon={IconBroadcast}
          label="Total Eventos MTD"
          value={
            summary.totalEventsMTD >= 1_000_000_000
              ? `${(summary.totalEventsMTD / 1_000_000_000).toFixed(2)}B eventos`
              : `${(summary.totalEventsMTD / 1_000_000).toFixed(1)}M eventos`
          }
          sub="Volumen consolidado procesado"
        />
        <KpiCard
          icon={IconLayersLinked}
          label="Temas Detectados"
          value={`${summary.totalTopics} Temas`}
          sub="Temas de dominios y temas estándar"
        />
      </div>

      {/* ─── Fila 1: Gráficas de Capacidad & Throughput (Tonos de Azul) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart: Distribución por SKU */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">
                Distribución de Costos por SKU de Event Grid
              </h3>
              <p className="text-[11px] text-slate-400">
                Gasto consolidado por nivel de servicio (Premium vs Basic)
              </p>
            </div>
            <span className="text-xs font-bold text-[#0054A6]">
              {skuDistribution.length} Niveles
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={skuDistribution}
                  dataKey="costUSD"
                  nameKey="sku"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={4}
                >
                  {skuDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value: any) => [format(Number(value)), "Costo MTD"]}
                  contentStyle={{
                    backgroundColor: "#1B2A41",
                    borderRadius: "8px",
                    border: "none",
                    color: "#FFFFFF",
                    fontSize: "12px",
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  formatter={(value) => (
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {value}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Area Chart: Evolución de Eventos Publicados y Entregados */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">
                Evolución Temporal de Eventos Publicados y Entregados
              </h3>
              <p className="text-[11px] text-slate-400">
                Volumen diario de eventos procesados (30 días)
              </p>
            </div>
            <span className="text-xs font-bold text-emerald-600">
              Escala de Azules
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendHistory}>
                <defs>
                  <linearGradient id="egPubGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="egDelivGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284C7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0284C7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.5} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  tickFormatter={(val) => val.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  tickFormatter={(val) => `${(val / 1_000_000).toFixed(0)}M`}
                />
                <RechartsTooltip
                  formatter={(value: any, name: any) => [
                    `${(Number(value) / 1_000_000).toFixed(2)}M eventos`,
                    name === "publishedEvents" ? "Publicados" : "Entregados",
                  ]}
                  contentStyle={{
                    backgroundColor: "#1B2A41",
                    borderRadius: "8px",
                    border: "none",
                    color: "#FFFFFF",
                    fontSize: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="publishedEvents"
                  stroke="#0078D4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#egPubGradient)"
                  name="publishedEvents"
                />
                <Area
                  type="monotone"
                  dataKey="deliveredEvents"
                  stroke="#0284C7"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#egDelivGradient)"
                  name="deliveredEvents"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── Fila 2: Filtros Inmediatos y Tabla CMP (Ancho 100%) ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {/* Barra de Filtros Inmediatos */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por recurso, grupo de recursos o región..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-[#0054A6]"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={filterSku}
              onChange={(e) => {
                setFilterSku(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-[#0054A6] text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">Todos los SKUs</option>
              <option value="Premium">Premium</option>
              <option value="Basic">Basic</option>
            </select>

            <select
              value={filterRegion}
              onChange={(e) => {
                setFilterRegion(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-[#0054A6] text-slate-700 dark:text-slate-300"
            >
              {regionOptions.map((r) => (
                <option key={r} value={r}>
                  {r === "ALL" ? "Todas las Regiones" : r}
                </option>
              ))}
            </select>

            <select
              value={filterResourceGroup}
              onChange={(e) => {
                setFilterResourceGroup(e.target.value);
                setPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-[#0054A6] text-slate-700 dark:text-slate-300"
            >
              {rgOptions.map((rg) => (
                <option key={rg} value={rg}>
                  {rg === "ALL" ? "Todos los Resource Groups" : rg}
                </option>
              ))}
            </select>

            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-[#0054A6] text-slate-700 dark:text-slate-300"
            >
              <option value={15}>15 por pág.</option>
              <option value={30}>30 por pág.</option>
              <option value={45}>45 por pág.</option>
              <option value={60}>60 por pág.</option>
            </select>
          </div>
        </div>

        {/* Tabla Responsive Full-Width */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <ResizableTh minWidth={220}>
                  <button
                    onClick={() => handleSort("name")}
                    className="flex items-center gap-1 hover:text-[#0054A6]"
                  >
                    Recurso Event Grid
                    {sortKey === "name" && (
                      <span>{sortDir === "asc" ? "▲" : "▼"}</span>
                    )}
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    onClick={() => handleSort("skuName")}
                    className="flex items-center gap-1 hover:text-[#0054A6]"
                  >
                    SKU / Tipo
                    {sortKey === "skuName" && (
                      <span>{sortDir === "asc" ? "▲" : "▼"}</span>
                    )}
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={130}>Región</ResizableTh>
                <ResizableTh minWidth={150}>Grupo de Recursos</ResizableTh>
                <ResizableTh minWidth={160}>Suscripción</ResizableTh>
                <ResizableTh minWidth={120}>
                  <button
                    onClick={() => handleSort("costMtdUSD")}
                    className="flex items-center gap-1 hover:text-[#0054A6]"
                  >
                    Costo MTD
                    {sortKey === "costMtdUSD" && (
                      <span>{sortDir === "asc" ? "▲" : "▼"}</span>
                    )}
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>Costo Anterior</ResizableTh>
                <ResizableTh minWidth={110}>Forecast</ResizableTh>
                <ResizableTh minWidth={120}>Total Eventos</ResizableTh>
                <ResizableTh minWidth={110}>Throughput (ops/s)</ResizableTh>
                <ResizableTh minWidth={120} className="text-center">
                  Acciones
                </ResizableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    No se encontraron recursos de Event Grid con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item) => {
                  const matchingAction = remediationActions.find(
                    (r) => r.resourceId === item.id
                  );

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-blue-50/30 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="p-[10px_14px] font-semibold text-[#1B2A41] dark:text-slate-200">
                        <div className="flex items-center gap-2">
                          <IconBroadcast className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className="truncate max-w-[200px]" title={item.name}>
                            {item.name}
                          </span>
                        </div>
                      </td>
                      <td className="p-[10px_14px]">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${
                            SKU_BADGE_CLASSES[item.skuName]
                          }`}
                        >
                          {item.skuName} ({item.resourceType})
                        </span>
                      </td>
                      <td className="p-[10px_14px] text-slate-600 dark:text-slate-400">
                        {item.location}
                      </td>
                      <td className="p-[10px_14px] text-slate-600 dark:text-slate-400">
                        {item.resourceGroup}
                      </td>
                      <td className="p-[10px_14px] text-slate-600 dark:text-slate-400">
                        {item.subscriptionName}
                      </td>
                      <td className="p-[10px_14px] font-bold text-slate-900 dark:text-slate-100">
                        {format(item.costMtdUSD)}
                      </td>
                      <td className="p-[10px_14px] text-slate-500">
                        {format(item.costPreviousPeriodUSD)}
                      </td>
                      <td className="p-[10px_14px] text-slate-500">
                        {format(item.forecastEomUSD)}
                      </td>
                      <td className="p-[10px_14px] text-slate-700 dark:text-slate-300">
                        {item.publishedEvents >= 1_000_000
                          ? `${(item.publishedEvents / 1_000_000).toFixed(1)}M`
                          : item.publishedEvents.toLocaleString()}
                      </td>
                      <td className="p-[10px_14px] text-slate-500">
                        {item.throughputOpsSec ? `${item.throughputOpsSec} ops/s` : "—"}
                      </td>
                      <td className="p-[10px_14px] text-center">
                        {matchingAction ? (
                          <button
                            onClick={() => setActiveModalAction(matchingAction)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                          >
                            <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" />
                            Optimizar ✨
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[11px] font-medium">—</span>
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
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 flex items-center justify-between text-xs text-slate-500">
          <span>
            Mostrando {paginatedItems.length} de {sortedItems.length} recursos
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <span className="font-bold text-slate-700 dark:text-slate-300">
              {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>

      {/* ─── Panel de Recomendaciones Priorizadas de Event Grid ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">
              Oportunidades de Ahorro y Arbitraje FinOps ({remediationActions.length})
            </h3>
          </div>
          <span className="text-xs font-extrabold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
            Ahorro Proyectado: ~{format(summary.potentialSavingsUSD)}/mes
          </span>
        </div>

        {remediationActions.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            Todos los dominios y temas de Event Grid se encuentran optimizados y sin recursos huérfanos detectados.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {remediationActions.map((rec) => {
              const isExpanded = expandedAction === rec.id;

              return (
                <div
                  key={rec.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs hover:border-blue-300 dark:hover:border-blue-800 transition-colors flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-[#0054A6] bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
                        {rec.category}
                      </span>
                      {rec.estimatedSavingsUSD > 0 && (
                        <span className="text-xs font-extrabold text-emerald-600">
                          +{format(rec.estimatedSavingsUSD)}/m
                        </span>
                      )}
                    </div>
                    <h4 className="font-bold text-xs text-[#1B2A41] dark:text-slate-100 leading-snug">
                      {rec.title}
                    </h4>
                    <p className={`text-[11px] text-slate-500 leading-relaxed ${isExpanded ? "" : "line-clamp-2"}`}>
                      {rec.description}
                    </p>
                    {rec.description.length > 100 && (
                      <button
                        onClick={() => setExpandedAction(isExpanded ? null : rec.id)}
                        className="text-[10px] font-bold text-[#0054A6] hover:underline cursor-pointer"
                      >
                        {isExpanded ? "Ver menos" : "Ver más detalles"}
                      </button>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-medium">
                      Confianza {rec.confidence}
                    </span>
                    <button
                      onClick={() => setActiveModalAction(rec)}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                    >
                      <IconSparkles className="w-3.5 h-3.5" />
                      Optimizar ✨
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Z-50 */}
      {activeModalAction && (
        <RemediationModal
          action={activeModalAction}
          onClose={() => setActiveModalAction(null)}
        />
      )}
    </div>
  );
}

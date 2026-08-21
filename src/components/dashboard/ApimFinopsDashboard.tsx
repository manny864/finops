"use client";

import React, { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconCpu,
  IconActivity,
  IconTopologyStarRing3,
  IconBuildingSkyscraper,
  IconRotateClockwise,
  IconDownload,
  IconSparkles,
  IconCheck,
  IconAlertTriangle,
  IconLoader2,
  IconSearch,
  IconCopy,
  IconX,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import type {
  ApimPayload,
  ApimResourceItem,
  ApimRemediationAction,
  ApimSkuName,
} from "@/types/azureApim.types";
import { buildApimRemediationCommand } from "@/lib/aiRemediations";

const CATEGORY_COLORS: Record<string, string> = {
  DEV_SKU_DOWNGRADE: "#0078D4",
  UNITS_RIGHTSIZING: "#2563EB",
  CACHE_ENABLE: "#0284C7",
};

const CATEGORY_LABELS: Record<string, string> = {
  DEV_SKU_DOWNGRADE: "Arbitraje a SKU Developer en Dev/Test",
  UNITS_RIGHTSIZING: "Rightsizing de Unidades Premium",
  CACHE_ENABLE: "Habilitar Caché de Respuesta Interna",
};

const SKU_BADGE_CLASSES: Record<ApimSkuName, string> = {
  Premium: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  Standard: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border-sky-200 dark:border-sky-800",
  Basic: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
  Developer: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
};

// ─── Fetcher con autenticación OAuth y guard MSAL ───
function buildFetcher(instance: any, accounts: any[], inProgress: string, isDemo: boolean) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isDemo) {
      if (!accounts || accounts.length === 0 || !accounts[0]) {
        throw new Error("No hay sesión activa de Microsoft Entra ID. Inicie sesión para consultar telemetría real.");
      }
      const token = await getFreshIdToken(instance, accounts[0]);
      if (!token || token === "demo") {
        throw new Error("No se pudo obtener un token de autenticación válido de Microsoft Entra ID.");
      }
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return res.json();
  };
}

// ─── Columna Redimensionable CMP ───
export function ResizableTh({
  children,
  minWidth = 100,
  className = "",
}: {
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
}) {
  const thRef = useRef<HTMLTableCellElement>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const th = thRef.current;
    if (!th) return;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;

    const onMove = (ev: MouseEvent) => {
      th.style.width = `${Math.max(minWidth, startWidth + (ev.clientX - startX))}px`;
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <th
      ref={thRef}
      style={{ minWidth }}
      className={`sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/80 relative text-left text-[11px] tracking-[0.5px] uppercase text-slate-600 dark:text-slate-300 font-bold p-[10px_14px] border-b border-slate-200 dark:border-slate-700 whitespace-nowrap select-none ${className}`}
    >
      {children}
      <span
        onMouseDown={onMouseDown}
        title="Arrastrar para ajustar ancho"
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500"
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

// ─── Modal de Acción y Remediación (z-50) ───
function RemediationModal({
  action,
  item,
  onClose,
}: {
  action: ApimRemediationAction | null;
  item?: ApimResourceItem | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [cmdTab, setCmdTab] = useState<"cli" | "powershell">("cli");
  const { format } = useCurrency();

  if (!action) return null;

  const commands = buildApimRemediationCommand(action);
  const commandText = cmdTab === "cli" ? commands.cli : commands.powershell;

  const handleCopy = () => {
    navigator.clipboard.writeText(commandText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/30">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#0078D4]">
              <IconSparkles className="w-4 h-4" stroke={1.5} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">
                Optimización y Arbitraje de APIM
              </h3>
              <p className="text-[11px] text-slate-400">
                {CATEGORY_LABELS[action.category]}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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

          {/* Comparador de SKU / Unidades */}
          {action.category === "DEV_SKU_DOWNGRADE" && (
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-blue-900 dark:text-blue-300">
                  Simulación de Arbitraje Dev/Test
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro: ~{format(action.estimatedSavingsUSD)}/mes
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">SKU Actual</p>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                    {action.currentSku || "Premium"}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Costo: {action.currentSku === "Premium" ? "$2,800/mes" : "$700/mes"}
                  </p>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-300 dark:border-emerald-800">
                  <p className="text-[10px] text-emerald-600 font-bold uppercase">SKU Recomendado</p>
                  <p className="text-sm font-extrabold text-emerald-600 mt-0.5">
                    Developer
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Costo: $50/mes (Idénticas features Dev)
                  </p>
                </div>
              </div>
            </div>
          )}

          {action.category === "UNITS_RIGHTSIZING" && (
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-blue-900 dark:text-blue-300">
                  Rightsizing de Capacidad de Gateway
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro: {format(action.estimatedSavingsUSD)}/mes
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Unidades Actuales</p>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                    {action.currentCapacity || 4} Unidades
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Gasto: {format((action.currentCapacity || 4) * 2800)}/mes
                  </p>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-300 dark:border-emerald-800">
                  <p className="text-[10px] text-emerald-600 font-bold uppercase">Unidades Optimizadas</p>
                  <p className="text-sm font-extrabold text-emerald-600 mt-0.5">
                    {action.recommendedCapacity || 2} Unidades
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Gasto: {format((action.recommendedCapacity || 2) * 2800)}/mes
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Selector de Comandos CLI / PowerShell */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                Script de Automatización
              </span>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs">
                <button
                  onClick={() => setCmdTab("cli")}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                    cmdTab === "cli"
                      ? "bg-white dark:bg-slate-700 text-[#0054A6] shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Azure CLI
                </button>
                <button
                  onClick={() => setCmdTab("powershell")}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                    cmdTab === "powershell"
                      ? "bg-white dark:bg-slate-700 text-[#0054A6] shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  PowerShell
                </button>
              </div>
            </div>
            <pre className="p-3.5 bg-slate-950 text-slate-100 font-mono text-xs rounded-xl overflow-x-auto border border-slate-800">
              <code>{commandText}</code>
            </pre>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
          >
            Cerrar
          </button>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg cursor-pointer shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors"
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

// ─── Componente Principal ApimFinopsDashboard ───
export default function ApimFinopsDashboard() {
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
  const [sortKey, setSortKey] = useState<keyof ApimResourceItem>("costMtdUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [activeModalAction, setActiveModalAction] = useState<ApimRemediationAction | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, inProgress, isDemo),
    [instance, accounts, inProgress, isDemo]
  );

  const apiUrl = canFetch
    ? `/api/intelligence/integration-services/apim?tenantId=${encodeURIComponent(tenantId!)}${isDemo ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<ApimPayload>(
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
        <p className="text-slate-500">Cargando telemetría de Azure API Management (APIM)...</p>
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
                Estado de Conexión a Azure API Management
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
    totalUnits: 0,
    totalRequestsMTD: 0,
    nonProdSpendPercentage: 0,
    potentialSavingsUSD: 0,
  };
  const remediationActions = data?.remediationActions || [];
  const skuDistribution = data?.skuDistribution || [];
  const trendHistory = data?.trendHistory || [];

  // ─── Opciones de Filtros Inmediatos ───
  const resourceOptions = ["ALL", ...new Set(items.map((i) => i.name))];
  const regionOptions = ["ALL", ...new Set(items.map((i) => i.location))];
  const skuOptions = ["ALL", "Developer", "Basic", "Standard", "Premium"];
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

  const handleSort = (key: keyof ApimResourceItem) => {
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
      "Instancia",
      "SKU",
      "Unidades",
      "Región",
      "Grupo de Recursos",
      "Suscripción",
      "Costo MTD (USD)",
      "Costo Anterior (USD)",
      "Forecast EOM (USD)",
      "% Capacidad",
      "Total Llamadas",
      "Latencia Promedio (ms)",
      "Entorno Dev/Test",
    ];
    const rows = sortedItems.map((i) => [
      i.name,
      i.skuName,
      i.skuCapacity,
      i.location,
      i.resourceGroup,
      i.subscriptionName,
      i.costMtdUSD,
      i.costPreviousPeriodUSD,
      i.forecastEomUSD,
      `${i.avgCapacityPercentage}%`,
      i.totalRequests,
      `${i.avgLatencyMs}ms`,
      i.isDevOrTest ? "Sí" : "No",
    ]);

    const csvContent = [headers, ...rows].map((e) => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `azure-apim-finops-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in duration-200">
      {/* ─── Header de Sub-Pestaña APIM ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100">
              Azure API Management (APIM)
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Monitoreo Activo
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Gobernanza de APIs, arbitraje de SKUs de desarrollo, rightsizing de unidades Premium y optimización de caché.
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
          label="Costo APIM MTD"
          value={format(summary.costMtdUSD)}
          sub={`Ahorro potencial: ${format(summary.potentialSavingsUSD)}`}
        />
        <KpiCard
          icon={IconCpu}
          label="Unidades APIM Activas"
          value={`${summary.totalUnits} Unidades`}
          sub={`${items.length} instancias configuradas`}
        />
        <KpiCard
          icon={IconActivity}
          label="Total Llamadas API (MTD)"
          value={
            summary.totalRequestsMTD >= 1_000_000_000
              ? `${(summary.totalRequestsMTD / 1_000_000_000).toFixed(2)}B llamadas`
              : `${(summary.totalRequestsMTD / 1_000_000).toFixed(1)}M llamadas`
          }
          sub="Throughput consolidado de gateways"
        />
        <KpiCard
          icon={IconBuildingSkyscraper}
          label="Gasto No Prod (Dev Tier)"
          value={`${summary.nonProdSpendPercentage}%`}
          sub="Ratio de gasto en instancias de Dev/QA"
        />
      </div>

      {/* ─── Fila 1: Gráficas de Capacidad & Throughput (Tonos de Azul) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart: Distribución por SKU */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">
                Distribución de Costos por SKU de APIM
              </h3>
              <p className="text-[11px] text-slate-400">
                Gasto consolidado desglosado por nivel de servicio
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

        {/* Area Chart: Evolución de Llamadas y Latencia */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">
                Evolución Temporal de Llamadas y Rendimiento
              </h3>
              <p className="text-[11px] text-slate-400">
                Volumen diario de requests y latencia promedio de gateways (30 días)
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
                  <linearGradient id="apimGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
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
                    name === "requests"
                      ? `${(Number(value) / 1_000_000).toFixed(1)}M llamadas`
                      : `${value} ms`,
                    name === "requests" ? "Volumen" : "Latencia",
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
                  dataKey="requests"
                  stroke="#0078D4"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#apimGradient)"
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
              placeholder="Buscar por instancia, grupo de recursos o región..."
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
              <option value="Standard">Standard</option>
              <option value="Basic">Basic</option>
              <option value="Developer">Developer</option>
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
                    Instancia APIM
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
                    SKU & Unidades
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
                <ResizableTh minWidth={120}>
                  <button
                    onClick={() => handleSort("avgCapacityPercentage")}
                    className="flex items-center gap-1 hover:text-[#0054A6]"
                  >
                    % Capacidad
                    {sortKey === "avgCapacityPercentage" && (
                      <span>{sortDir === "asc" ? "▲" : "▼"}</span>
                    )}
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={120}>Total Llamadas</ResizableTh>
                <ResizableTh minWidth={110}>Latencia Prom.</ResizableTh>
                <ResizableTh minWidth={120} className="text-center">
                  Acciones
                </ResizableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    No se encontraron instancias de API Management con los filtros seleccionados.
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
                          <IconTopologyStarRing3 className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
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
                          {item.skuName} ({item.skuCapacity}u)
                        </span>
                      </td>
                      <td className="p-[10px_14px] text-slate-600 dark:text-slate-300">
                        {item.location}
                      </td>
                      <td className="p-[10px_14px] text-slate-600 dark:text-slate-300 truncate max-w-[140px]">
                        {item.resourceGroup}
                      </td>
                      <td className="p-[10px_14px] text-slate-600 dark:text-slate-300 truncate max-w-[150px]">
                        {item.subscriptionName}
                      </td>
                      <td className="p-[10px_14px] font-extrabold text-[#1B2A41] dark:text-slate-100">
                        {format(item.costMtdUSD)}
                      </td>
                      <td className="p-[10px_14px] text-slate-500">
                        {format(item.costPreviousPeriodUSD)}
                      </td>
                      <td className="p-[10px_14px] text-slate-500">
                        {format(item.forecastEomUSD)}
                      </td>
                      <td className="p-[10px_14px]">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                item.avgCapacityPercentage > 80
                                  ? "bg-rose-500"
                                  : item.avgCapacityPercentage < 30
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                              }`}
                              style={{ width: `${Math.min(100, item.avgCapacityPercentage)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                            {item.avgCapacityPercentage}%
                          </span>
                        </div>
                      </td>
                      <td className="p-[10px_14px] text-slate-600 dark:text-slate-300">
                        {item.totalRequests >= 1_000_000
                          ? `${(item.totalRequests / 1_000_000).toFixed(1)}M`
                          : item.totalRequests.toLocaleString()}
                      </td>
                      <td className="p-[10px_14px] text-slate-600 dark:text-slate-300">
                        {item.avgLatencyMs} ms
                      </td>
                      <td className="p-[10px_14px] text-center">
                        {matchingAction ? (
                          <button
                            onClick={() => setActiveModalAction(matchingAction)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                          >
                            <IconSparkles className="w-3.5 h-3.5" />
                            Optimizar ✨
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-semibold">
                            Óptimo ✓
                          </span>
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
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span>
              Mostrando {Math.min(sortedItems.length, (page - 1) * pageSize + 1)} -{" "}
              {Math.min(sortedItems.length, page * pageSize)} de {sortedItems.length} instancias
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Anterior
              </button>
              <span className="px-2 font-bold text-slate-700 dark:text-slate-300">
                Pág. {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Panel de Recomendaciones Priorizadas de APIM ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="font-bold text-sm text-[#1B2A41] dark:text-slate-100">
              Oportunidades de Arbitraje y Ahorro en API Management
            </h3>
          </div>
          <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
            Ahorro Total Proyectado: {format(summary.potentialSavingsUSD)}/mes
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {remediationActions.map((action) => (
            <div
              key={action.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 flex flex-col justify-between gap-3 hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 bg-blue-100/60 dark:bg-blue-950/60 px-2 py-0.5 rounded-md">
                    {CATEGORY_LABELS[action.category]}
                  </span>
                  <span className="text-xs font-extrabold text-emerald-600">
                    +{format(action.estimatedSavingsUSD)}/mes
                  </span>
                </div>
                <h4 className="font-bold text-xs text-[#1B2A41] dark:text-slate-100 mb-1">
                  {action.title}
                </h4>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {action.description}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-400">
                  Confianza: {action.confidence === "HIGH" ? "Alta" : "Media"}
                </span>
                <button
                  onClick={() => setActiveModalAction(action)}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                >
                  <IconSparkles className="w-3.5 h-3.5" />
                  Simular y Resolver ✨
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Modal de Remediación (z-50) ─── */}
      <RemediationModal
        action={activeModalAction}
        onClose={() => setActiveModalAction(null)}
      />
    </div>
  );
}

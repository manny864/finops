"use client";
import { useTranslations } from "next-intl";

import React, { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconDatabaseExport,
  IconShieldExclamation,
  IconSparkles,
  IconRotateClockwise,
  IconDownload,
  IconCheck,
  IconAlertTriangle,
  IconLoader2,
  IconSearch,
  IconCopy,
  IconX,
  IconBrandPowershell,
  IconTerminal2,
  IconActivity,
  IconAdjustmentsHorizontal,
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
import { buildAppInsightsRemediationCommand } from "@/lib/aiRemediations";
import type {
  AppInsightsResourceItem,
  AppInsightsRemediationAction,
  AppInsightsPayload,
} from "@/types/azureAppInsights.types";

// ─── Fetcher con autenticación Entra ID y prevención 401 ───
// `t` entra por parametro: buildFetcher no es un componente ni un hook y no
// puede llamar a useTranslations.
function buildFetcher(
  instance: any,
  accounts: any[],
  inProgress: string,
  isDemo: boolean
, t: (k: string) => string) {
  return async (url: string) => {
    const headers: Record<string, string> = {};

    if (!isDemo) {
      if (!accounts || accounts.length === 0 || !accounts[0]) {
        throw new Error(t("noSession"));
      }
      try {
        const token = await getFreshIdToken(instance, accounts[0]);
        if (token && token !== "demo") {
          headers["Authorization"] = `Bearer ${token}`;
        }
      } catch (tokenErr) {
        console.warn("[app-insights-fetcher] Token acquisition failed:", tokenErr);
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
  const t = useTranslations("AppInsightsFinops");
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
  alertBadge,
}: {
  icon: React.ComponentType<{ className?: string; stroke?: number }>;
  label: string;
  value: string;
  sub: string;
  alertBadge?: boolean;
}) {
  const t = useTranslations("AppInsightsFinops");
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-4 flex items-center gap-3">
      <Icon className="w-6 h-6 text-[#0078D4] shrink-0" stroke={1.5} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 truncate">
            {label}
          </p>
          {alertBadge && (
            <span className="px-1.5 py-0.2 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded text-[9px] font-extrabold">
              {t("attention")}
            </span>
          )}
        </div>
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
  action: AppInsightsRemediationAction;
  onClose: () => void;
}) {
  const t = useTranslations("AppInsightsFinops");
  const { format } = useCurrency();
  const [activeTab, setActiveTab] = useState<"CLI" | "POWERSHELL">("CLI");
  const [copied, setCopied] = useState(false);

  const commands = buildAppInsightsRemediationCommand(action);
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
              {t("simTitle")}
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

          {/* Comparador de Configuración */}
          {action.category === "SET_DAILY_CAP" && (
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-blue-900 dark:text-blue-300">
                  {t("dailyCapTitle")}
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  {t("loopProtection", { amount: format(action.estimatedSavingsUSD) })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">{t("currentState")}</p>
                  <p className="text-sm font-extrabold text-rose-600 mt-0.5">
                    {t("noDailyCap")}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">{t("unexpectedBillingRisk")}</p>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-300 dark:border-emerald-800">
                  <p className="text-[10px] text-emerald-600 font-bold uppercase">Tope Recomendado</p>
                  <p className="text-sm font-extrabold text-emerald-600 mt-0.5">
                    {action.recommendedDailyCap || 5} GB / día
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">{t("cutsIngestion")}</p>
                </div>
              </div>
            </div>
          )}

          {action.category === "REDUCE_SAMPLING" && (
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-blue-900 dark:text-blue-300">
                  {t("samplingRateTitle")}
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  {t("estSavings", { amount: format(action.estimatedSavingsUSD) })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Muestreo Actual</p>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                    {action.currentSampling || 100}% de telemetría
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">{t("allTracesProcessed")}</p>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-emerald-300 dark:border-emerald-800">
                  <p className="text-[10px] text-emerald-600 font-bold uppercase">{t("optimalSampling")}</p>
                  <p className="text-sm font-extrabold text-emerald-600 mt-0.5">
                    {action.recommendedSampling || 50}% Adaptive Sampling
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">{t("sameValidity")}</p>
                </div>
              </div>
            </div>
          )}

          {action.category === "FILTER_LOGS" && (
            <div className="bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-sky-900 dark:text-sky-300">
                  {t("verboseLogFilterTitle")}
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  {t("estSavings", { amount: format(action.estimatedSavingsUSD) })}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t("logLevelDesc")}
              </p>
            </div>
          )}

          {action.category === "PURGE_ORPHAN" && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 font-bold">
                <IconAlertTriangle className="w-4 h-4 text-amber-600" />
                {t("hygieneTitle")}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {t("purgeDesc")}
              </p>
            </div>
          )}

          {/* Selector CLI / PowerShell */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {t("autoScript")}
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
            {t("close")}
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
                {t("copyAndRun")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal AppInsightsDashboard ───
export default function AppInsightsDashboard() {
  const t = useTranslations("AppInsightsFinops");
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
  const [filterSampling, setFilterSampling] = useState("ALL");
  const [filterResourceGroup, setFilterResourceGroup] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof AppInsightsResourceItem>("estimatedCostMtdUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [activeModalAction, setActiveModalAction] = useState<AppInsightsRemediationAction | null>(null);

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, inProgress, isDemo, t),
    [instance, accounts, inProgress, isDemo]
  );

  const apiUrl = canFetch
    ? `/api/intelligence/app-insights?tenantId=${encodeURIComponent(tenantId!)}${isDemo ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<AppInsightsPayload>(
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
        <p className="text-slate-500">{t("loading")}</p>
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
                {t("connStatus")}
              </h3>
              <p className="text-sm mt-1 text-slate-600 dark:text-slate-400">
                {error.message === "No autorizado."
                  ? "Sesión no autorizada o token de Entra ID expirado. Si utiliza una cuenta de demostración, active el modo demo."
                  : error.message}
              </p>
              <p className="text-xs text-slate-400 mt-2">
                {t("tenantLine", { id: tenantId, mode: isDemo ? t("demoMode") : t("connectedTenant") })}
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
    totalCostMtdUSD: 0,
    totalIngestedGB: 0,
    instancesCount: 0,
    unlimitedCapCount: 0,
    potentialSavingsUSD: 0,
    breakdownByTelemetryType: [],
  };
  const remediationActions = data?.remediationActions || [];
  const breakdownByTelemetryType = summary?.breakdownByTelemetryType || [];
  const dailyIngestionTrend = data?.dailyIngestionTrend || [];

  // ─── Opciones de Filtros Inmediatos ───
  const resourceOptions = ["ALL", ...new Set(items.map((i) => i.name))];
  const regionOptions = ["ALL", ...new Set(items.map((i) => i.location))];
  const rgOptions = ["ALL", ...new Set(items.map((i) => i.resourceGroup))];

  // ─── Filtrado ───
  const filteredItems = items
    .filter((i) => filterResource === "ALL" || i.name === filterResource)
    .filter((i) => filterRegion === "ALL" || i.location === filterRegion)
    .filter((i) => {
      if (filterSampling === "100") return i.samplingPercentage === 100;
      if (filterSampling === "LESS_100") return i.samplingPercentage < 100;
      return true;
    })
    .filter((i) => filterResourceGroup === "ALL" || i.resourceGroup === filterResourceGroup)
    .filter((i) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        i.resourceGroup.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q) ||
        i.linkedWorkspaceName.toLowerCase().includes(q)
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

  const handleSort = (key: keyof AppInsightsResourceItem) => {
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
      "Componente App Insights",
      "Región",
      "Grupo de Recursos",
      "Suscripción",
      "Log Analytics Workspace",
      "Muestreo (%)",
      "Daily Cap (GB)",
      "Ingesta Total MTD (GB)",
      "AppTraces (GB)",
      "Dependencies (GB)",
      "Requests (GB)",
      "Exceptions (GB)",
      "Costo Ingesta MTD (USD)",
      "Forecast (USD)",
    ];
    const rows = sortedItems.map((i) => [
      i.name,
      i.location,
      i.resourceGroup,
      i.subscriptionName,
      i.linkedWorkspaceName,
      `${i.samplingPercentage}%`,
      i.isDailyCapUnlimited ? "Sin Límite" : `${i.dailyCapGB} GB/día`,
      i.ingestedTotalGB,
      i.tracesGB,
      i.dependenciesGB,
      i.requestsGB,
      i.exceptionsGB,
      i.estimatedCostMtdUSD,
      i.forecastCostUSD,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `app-insights-finops-${tenantId}.csv`);
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
            <IconActivity className="w-7 h-7 text-[#0078D4]" stroke={1.5} />
            Application Insights FinOps & Observabilidad
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => mutate()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
          >
            <IconRotateClockwise className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {t("refreshTelemetry")}
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

      {/* ─── Header y KPI Cards Superiores (4 Tarjetas) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={IconCash}
          label={t("kpiIngestionCost")}
          value={format(summary.totalCostMtdUSD)}
          sub={`Proyección: ${format(summary.totalCostMtdUSD * 1.05)}`}
        />
        <KpiCard
          icon={IconDatabaseExport}
          label="Volumen Total Ingerido"
          value={`${summary.totalIngestedGB.toFixed(1)} GB`}
          sub="Tarifa base: $2.30 USD/GB"
        />
        <KpiCard
          icon={IconShieldExclamation}
          label={t("kpiNoCap")}
          value={String(summary.unlimitedCapCount)}
          sub={`${summary.instancesCount} instancias monitoreadas`}
          alertBadge={summary.unlimitedCapCount > 0}
        />
        <KpiCard
          icon={IconSparkles}
          label={t("kpiSamplingSavings")}
          value={format(summary.potentialSavingsUSD)}
          sub={`${remediationActions.length} oportunidades activas`}
        />
      </div>

      {/* ─── Fila 1: Gráficas de Telemetría & Distribución ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel Izquierdo: Donut Chart Desglose por Tipo de Telemetría */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              {t("ingestionBreakdown")}
            </h3>
            <span className="text-[11px] text-slate-400">Mensual</span>
          </div>

          <div className="h-64 w-full">
            {breakdownByTelemetryType.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                {t("noBreakdown")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdownByTelemetryType}
                    dataKey="costUSD"
                    nameKey="typeName"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                  >
                    {breakdownByTelemetryType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: any, name: any, item: any) => [
                      `${format(Number(value))} (${item.payload.gbCount} GB)`,
                      item.payload.typeName,
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
                    verticalAlign="bottom"
                    iconType="circle"
                    formatter={(val, entry: any) => (
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        {val} ({entry.payload.percentage}%) - {format(entry.payload.costUSD)}
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Panel Derecho: Evolución Diaria de Ingesta */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              {t("dailyIngestion")}
            </h3>
            <span className="text-[11px] text-slate-400">{t("last30Days")}</span>
          </div>

          <div className="h-64 w-full">
            {dailyIngestionTrend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                {t("noHistory")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyIngestionTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tracesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0078D4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="depsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563EB" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94A3B8" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94A3B8" tickFormatter={(v) => `${v} GB`} />
                  <RechartsTooltip
                    formatter={(val: any, name: any) => [
                      `${Number(val).toFixed(2)} GB`,
                      name === "tracesGB" ? "AppTraces" : "Dependencies",
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
                        {val === "tracesGB" ? "AppTraces (Logs)" : "Dependencies (HTTP/SQL)"}
                      </span>
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="tracesGB"
                    stroke="#0078D4"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#tracesGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="dependenciesGB"
                    stroke="#2563EB"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#depsGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ─── Fila 2: Barra de Filtros y Búsqueda ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50/50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {t("resource")}
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
                {opt === "ALL" ? "Todos los Recursos" : opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {t("region")}
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
            Muestreo (Sampling)
          </label>
          <select
            value={filterSampling}
            onChange={(e) => {
              setFilterSampling(e.target.value);
              setPage(1);
            }}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">{t("allSampling")}</option>
            <option value="100">{t("fullIngestion")}</option>
            <option value="LESS_100">{t("sampled")}</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {t("resourceGroup")}
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

      {/* ─── Fila 3: Tabla CMP "Detalle por Recurso App Insights" ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconActivity className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              {t("tableTitle")}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("tableSub")}
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
                placeholder={t("search")}
                className="pl-9 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
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
              <option value={15}>{t("perPage15")}</option>
              <option value={30}>{t("perPage30")}</option>
              <option value={45}>{t("perPage45")}</option>
              <option value={60}>{t("perPage60")}</option>
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
                    {t("resource")}
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={100}>
                  <button
                    onClick={() => handleSort("location")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    {t("region")}
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={140}>
                  <span className="font-bold text-slate-700 dark:text-slate-300">{t("subscription")}</span>
                </ResizableTh>
                <ResizableTh minWidth={160}>
                  <span className="font-bold text-slate-700 dark:text-slate-300">Workspace Vinculado</span>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    onClick={() => handleSort("samplingPercentage")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Muestreo
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <span className="font-bold text-slate-700 dark:text-slate-300">{t("dailyCap")}</span>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    onClick={() => handleSort("ingestedTotalGB")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    Ingesta MTD
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    onClick={() => handleSort("estimatedCostMtdUSD")}
                    className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600"
                  >
                    {t("ingestionCost")}
                  </button>
                </ResizableTh>
                <th className="p-[10px_14px] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right bg-slate-50/80 dark:bg-slate-900/80 min-w-[130px]">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400 text-xs">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item) => {
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
                          <IconActivity className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className="truncate max-w-[170px]" title={item.name}>
                            {item.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {item.applicationType || "web"}
                          </span>
                          {item.isOrphan && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              {t("orphan")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">{item.location}</td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        <span className="truncate max-w-[130px] block" title={item.subscriptionName}>
                          {item.subscriptionName}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        <span className="truncate max-w-[150px] block" title={item.linkedWorkspaceName}>
                          {item.linkedWorkspaceName}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.samplingPercentage === 100
                              ? item.isDevOrTest
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          }`}
                        >
                          {item.samplingPercentage}%
                        </span>
                      </td>
                      <td className="p-3">
                        {item.isDailyCapUnlimited ? (
                          <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                            {t("noCap")}
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {t("gbPerDay", { gb: item.dailyCapGB ?? 0 })}
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-medium text-slate-800 dark:text-slate-200">
                        {item.ingestedTotalGB.toFixed(2)} GB
                      </td>
                      <td className="p-3 font-bold text-slate-900 dark:text-slate-100">
                        {format(item.estimatedCostMtdUSD)}
                      </td>
                      <td className="p-3 text-right">
                        {matchingAction ? (
                          <button
                            onClick={() => setActiveModalAction(matchingAction)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-md shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                          >
                            <IconSparkles className="w-3 h-3" />
                            {matchingAction.category === "SET_DAILY_CAP" ? "Fijar Daily Cap" : "Ajustar Sampling"}
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
            {t("showingRange", { from: Math.min(filteredItems.length, (page - 1) * pageSize + 1), to: Math.min(filteredItems.length, page * pageSize), total: filteredItems.length })}
            
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
            >
              {t("prev")}
            </button>
            <span className="text-xs px-2 text-slate-500">
              {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
            >
              {t("next")}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Panel de Recomendaciones Priorizadas de Application Insights ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
              {t("opportunities")}
            </h3>
          </div>
          <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
            {t("totalSavings", { amount: format(summary.potentialSavingsUSD) })}
          </span>
        </div>

        {remediationActions.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-50/50 dark:bg-slate-950/50 rounded-xl">
            {t("allOptimal")}
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
                        action.category === "SET_DAILY_CAP"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : action.category === "REDUCE_SAMPLING"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-sky-50 text-sky-700 border-sky-200"
                      }`}
                    >
                      {action.category.replace(/_/g, " ")}
                    </span>
                    {action.estimatedSavingsUSD > 0 && (
                      <span className="text-xs font-extrabold text-emerald-600">
                        +{format(action.estimatedSavingsUSD)}/mes
                      </span>
                    )}
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
                    <IconAdjustmentsHorizontal className="w-3.5 h-3.5" />
                    {t("simulateApply")}
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

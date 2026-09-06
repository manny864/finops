"use client";
import { useTranslations } from "next-intl";

import React, { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconHistory,
  IconTrendingUp,
  IconLayersLinked,
  IconTopologyStarRing3,
  IconRotateClockwise,
  IconDownload,
  IconSparkles,
  IconCheck,
  IconAlertTriangle,
  IconLoader2,
  IconInfoCircle,
  IconChevronDown,
  IconChevronUp,
  IconFilter,
  IconSearch,
  IconCopy,
  IconX,
  IconBrandPowershell,
  IconTerminal2,
  IconPlugConnected,
  IconAlertCircle,
  IconArrowsExchange,
} from "@tabler/icons-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import type {
  LogicAppsPayload,
  LogicAppResourceItem,
  LogicAppRemediationAction,
} from "@/types/azureLogicApps.types";
import { buildLogicAppsRemediationCommand } from "@/lib/aiRemediations";

const CATEGORY_COLORS: Record<string, string> = {
  MIGRATE_TO_STANDARD: "#0078D4",
  DOWNGRADE_TO_CONSUMPTION: "#2563EB",
  FIX_RETRY_LOOP: "#EF4444",
  DISABLE_IDLE: "#94A3B8",
};

const CATEGORY_LABELS: Record<string, string> = {
  MIGRATE_TO_STANDARD: "Arbitraje a Logic Apps Standard (WS1)",
  DOWNGRADE_TO_CONSUMPTION: "Downgrade a Consumption",
  FIX_RETRY_LOOP: "Mitigación de Bucle de Reintento",
  DISABLE_IDLE: "Limpieza de Flujo Inactivo",
};

// ─── Fetcher con autenticación OAuth ───
// `t` entra por parametro: buildFetcher no es un componente ni un hook y no
// puede llamar a useTranslations.
function buildFetcher(instance: any, accounts: any[], inProgress: string, isDemo: boolean, t: (k: string) => string) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isDemo) {
      if (!accounts || accounts.length === 0 || !accounts[0]) {
        throw new Error(t("noSession"));
      }
      const token = await getFreshIdToken(instance, accounts[0]);
      if (!token || token === "demo") {
        throw new Error(t("noToken"));
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
  const t = useTranslations("IpaasFinops");
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
        title={t("resizeHint")}
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
  const t = useTranslations("IpaasFinops");
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
  action: LogicAppRemediationAction | null;
  item?: LogicAppResourceItem | null;
  onClose: () => void;
}) {
  const t = useTranslations("IpaasFinops");
  const [copied, setCopied] = useState(false);
  const [cmdTab, setCmdTab] = useState<"cli" | "powershell">("cli");
  const { format } = useCurrency();

  if (!action) return null;

  const commands = buildLogicAppsRemediationCommand(action);
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
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                {action.title}
              </h3>
              <p className="text-[11px] text-slate-500">
                {t("la_optimizationSavings")}{" "}
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {format(action.estimatedSavingsUSD)}/mes
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {action.description}
          </div>

          {/* Comparador de Arbitraje si aplica */}
          {item && action.category === "MIGRATE_TO_STANDARD" && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-blue-50/50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 rounded-xl text-xs">
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400">Escenario Actual (Consumption)</p>
                <p className="text-base font-extrabold text-red-600 mt-0.5">{format(item.costMtdUSD)}/mes</p>
                <p className="text-[10px] text-slate-500">{item.totalBillableExecutions.toLocaleString()} acciones + {item.enterpriseExecutions.toLocaleString()} llamadas Enterprise</p>
              </div>
              <div className="border-l border-blue-200 dark:border-blue-800 pl-3">
                <p className="text-[10px] uppercase font-bold text-emerald-600">Escenario Proyectado (Standard WS1)</p>
                <p className="text-base font-extrabold text-emerald-600 mt-0.5">$175.00/mes</p>
                <p className="text-[10px] text-slate-500">{t("la_flatRate")}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCmdTab("cli")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    cmdTab === "cli"
                      ? "bg-[#0078D4] text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                  }`}
                >
                  <IconTerminal2 className="w-3.5 h-3.5" />
                  Azure CLI
                </button>
                <button
                  onClick={() => setCmdTab("powershell")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    cmdTab === "powershell"
                      ? "bg-[#0078D4] text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                  }`}
                >
                  <IconBrandPowershell className="w-3.5 h-3.5" />
                  PowerShell
                </button>
              </div>

              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:underline cursor-pointer"
              >
                {copied ? <IconCheck className="w-3.5 h-3.5 text-emerald-500" /> : <IconCopy className="w-3.5 h-3.5 text-[#0078D4]" />}
                {copied ? t("copied") : t("copyCommand")}
              </button>
            </div>

            <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl text-xs font-mono overflow-x-auto border border-slate-800 whitespace-pre-wrap">
              {commandText}
            </pre>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-950/30">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
          >
            {t("close")}
          </button>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0054A6] hover:bg-[#004080] rounded-lg cursor-pointer shadow-xs transition-colors"
          >
            <IconCopy className="w-4 h-4" />
            {t("copyAndRun")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal LogicAppsFinopsDashboard ───
export default function LogicAppsFinopsDashboard() {
  const t = useTranslations("IpaasFinops");
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
  const [filterType, setFilterType] = useState("ALL");
  const [filterResourceGroup, setFilterResourceGroup] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof LogicAppResourceItem>("costMtdUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [activeModalAction, setActiveModalAction] = useState<LogicAppRemediationAction | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, inProgress, isDemo, t),
    [instance, accounts, inProgress, isDemo]
  );

  const apiUrl = canFetch
    ? `/api/intelligence/integration-services/logic-apps?tenantId=${encodeURIComponent(tenantId!)}${isDemo ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<LogicAppsPayload>(
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
        <p className="text-slate-500">{t("la_loading")}</p>
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
                {t("la_connStatus")}
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
    costMtdUSD: 0,
    costPreviousPeriodUSD: 0,
    forecastEomUSD: 0,
    totalResourcesCount: 0,
    totalEnterpriseCalls: 0,
    totalEnterpriseCostUSD: 0,
    enterpriseCostPercentage: 0,
    potentialSavingsUSD: 0,
  };
  const remediationActions = data?.remediationActions || [];

  // ─── Opciones de Filtros Inmediatos ───
  const resourceOptions = ["ALL", ...new Set(items.map((i) => i.name))];
  const regionOptions = ["ALL", ...new Set(items.map((i) => i.location))];
  const typeOptions = ["ALL", "Consumption", "Standard_WS1", "Standard_WS2", "Standard_WS3"];
  const rgOptions = ["ALL", ...new Set(items.map((i) => i.resourceGroup))];

  // ─── Filtrado ───
  const filteredItems = items
    .filter((i) => filterResource === "ALL" || i.name === filterResource)
    .filter((i) => filterRegion === "ALL" || i.location === filterRegion)
    .filter((i) => filterType === "ALL" || i.planType === filterType)
    .filter((i) => filterResourceGroup === "ALL" || i.resourceGroup === filterResourceGroup)
    .filter((i) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        i.resourceGroup.toLowerCase().includes(q) ||
        i.subscriptionName.toLowerCase().includes(q) ||
        (i.connectors || []).some((c) => c.toLowerCase().includes(q))
      );
    });

  // ─── Ordenamiento ───
  const sortedItems = [...filteredItems].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    }
    const aStr = String(aVal ?? "");
    const bStr = String(bVal ?? "");
    return sortDir === "desc" ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
  });

  // ─── Paginación ───
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const paginatedItems = sortedItems.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (key: keyof LogicAppResourceItem) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const SortIcon = ({ column }: { column: keyof LogicAppResourceItem }) => {
    if (sortKey !== column) return null;
    return sortDir === "desc" ? (
      <IconChevronDown className="w-3 h-3 inline ml-1" />
    ) : (
      <IconChevronUp className="w-3 h-3 inline ml-1" />
    );
  };

  // Exportar CSV
  const handleExportCsv = () => {
    const headers = [
      "Recurso",
      "Plan",
      "Región",
      "Grupo de Recursos",
      "Suscripción",
      "Costo MTD USD",
      "Costo Anterior USD",
      "Forecast USD",
      "Runs Iniciados",
      "Runs Fallidos",
      "Llamadas Enterprise",
      "Costo Enterprise USD",
    ];
    const rows = filteredItems.map((i) => [
      i.name,
      i.planType,
      i.location,
      i.resourceGroup,
      i.subscriptionName,
      i.costMtdUSD,
      i.costPreviousMonthUSD,
      i.forecastEomUSD,
      i.runsStartedCount,
      i.runsFailedCount,
      i.enterpriseExecutions,
      i.enterpriseCostUSD,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `logic_apps_finops_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const costDiff = summary.costMtdUSD - summary.costPreviousPeriodUSD;
  const costDiffPct =
    summary.costPreviousPeriodUSD > 0
      ? ((costDiff / summary.costPreviousPeriodUSD) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6 pb-12">
      {/* ─── Header de Estado & Acciones ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-900/50 px-2.5 py-1 rounded-full">
            <IconCheck className="w-3 h-3" />
            Monitoreo activo
          </span>
          {data?.source === "mock" && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/80 px-2 py-0.5 rounded-full">
              <IconInfoCircle className="w-3 h-3" />
              Demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => mutate()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            <IconRotateClockwise className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} stroke={2} />
            {t("refreshTelemetry")}
          </button>
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <IconDownload className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* ─── 1. Header y KPI Cards Superiores (4 Tarjetas) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={IconCash}
          label={t("costMtd")}
          value={format(summary.costMtdUSD)}
          sub={`Proyección Cierre: ${format(summary.forecastEomUSD)}`}
        />
        <KpiCard
          icon={IconHistory}
          label={t("la_kpiPrev")}
          value={format(summary.costPreviousPeriodUSD)}
          sub={`${costDiff >= 0 ? "+" : ""}${costDiffPct}% vs mes anterior`}
        />
        <KpiCard
          icon={IconTrendingUp}
          label={t("la_kpiForecast")}
          value={format(summary.forecastEomUSD)}
          sub="Proyección ML Run-rate de flujos"
        />
        <KpiCard
          icon={IconLayersLinked}
          label={t("la_kpiResources")}
          value={`${summary.totalResourcesCount} Workflows`}
          sub="Logic Apps Consumption + Standard"
        />
      </div>

      {/* ─── 2. Panel de Conectores Enterprise (Ancho 100%) ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <IconPlugConnected className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Conectores Enterprise & B2B (SAP, IBM MQ, AS2, EDIFACT)
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-slate-400">
            Tarifa: ~$0.001 / llamada Enterprise en Consumption
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-lg p-3">
            <p className="text-[10px] font-bold uppercase text-slate-400">Llamadas Enterprise MTD</p>
            <p className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100 mt-0.5">
              {summary.totalEnterpriseCalls.toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-400">{t("la_backendTraffic")}</p>
          </div>
          <div className="bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-lg p-3">
            <p className="text-[10px] font-bold uppercase text-slate-400">{t("la_enterpriseCost")}</p>
            <p className="text-lg font-extrabold text-[#0078D4] mt-0.5">
              {format(summary.totalEnterpriseCostUSD)}
            </p>
            <p className="text-[10px] text-slate-400">{t("la_premiumConnectors")}</p>
          </div>
          <div className="bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 rounded-lg p-3">
            <p className="text-[10px] font-bold uppercase text-slate-400">{t("la_enterprisePct")}</p>
            <p className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100 mt-0.5">
              {summary.enterpriseCostPercentage}%
            </p>
            <p className="text-[10px] text-slate-400">{t("la_overTotal")}</p>
          </div>
        </div>
      </div>

      {/* ─── 3. Barra de Filtros y Búsqueda (Ancho 100%) ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs flex items-center gap-3 flex-wrap">
        <IconFilter className="w-4 h-4 text-slate-400" stroke={1.5} />

        <div className="relative">
          <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            placeholder={t("la_search")}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-2.5 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 w-52"
          />
        </div>

        <select
          value={filterResource}
          onChange={(e) => {
            setFilterResource(e.target.value);
            setPage(1);
          }}
          className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
        >
          {resourceOptions.map((r) => (
            <option key={r} value={r}>
              {r === "ALL" ? "Todos los Flujos" : r}
            </option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => {
            setFilterType(e.target.value);
            setPage(1);
          }}
          className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
        >
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {t === "ALL" ? "Todos los Planes (Consumption/Standard)" : t}
            </option>
          ))}
        </select>

        <select
          value={filterRegion}
          onChange={(e) => {
            setFilterRegion(e.target.value);
            setPage(1);
          }}
          className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
        >
          {regionOptions.map((reg) => (
            <option key={reg} value={reg}>
              {reg === "ALL" ? "Todas las Regiones" : reg}
            </option>
          ))}
        </select>

        <select
          value={filterResourceGroup}
          onChange={(e) => {
            setFilterResourceGroup(e.target.value);
            setPage(1);
          }}
          className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
        >
          {rgOptions.map((rg) => (
            <option key={rg} value={rg}>
              {rg === "ALL" ? "Todos los Resource Groups" : rg}
            </option>
          ))}
        </select>

        <span className="text-[11px] text-slate-400 ml-auto">
          {filteredItems.length} {t("resourcesFound")}
        </span>
      </div>

      {/* ─── 4. Tabla CMP "Desglose por Logic App y Workflows" (Ancho 100%) ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconTopologyStarRing3 className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t("la_tableTitle")}
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
              <tr>
                <ResizableTh minWidth={220}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("name")}
                  >
                    {t("la_colResource")}
                    <SortIcon column="name" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("location")}
                  >
                    {t("region")}
                    <SortIcon column="location" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={140}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("planType")}
                  >
                    {t("la_colTypePlan")}
                    <SortIcon column="planType" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={140}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("resourceGroup")}
                  >
                    {t("resourceGroup")}
                    <SortIcon column="resourceGroup" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={150}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("subscriptionName")}
                  >
                    {t("subscription")}
                    <SortIcon column="subscriptionName" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("costMtdUSD")}
                  >
                    {t("costMtd")}
                    <SortIcon column="costMtdUSD" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("costPreviousMonthUSD")}
                  >
                    {t("costPrev")}
                    <SortIcon column="costPreviousMonthUSD" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("forecastEomUSD")}
                  >
                    Forecast
                    <SortIcon column="forecastEomUSD" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <span>Salud</span>
                </ResizableTh>
                <ResizableTh minWidth={120}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("runsStartedCount")}
                  >
                    Runs Iniciados
                    <SortIcon column="runsStartedCount" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("runsFailedCount")}
                  >
                    Runs Fallidos
                    <SortIcon column="runsFailedCount" />
                  </button>
                </ResizableTh>
                <th className="px-4 py-3 text-left font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((item) => {
                const isStandard = item.planType.startsWith("Standard");
                const matchingAction = remediationActions.find(
                  (a) => a.resourceId === item.id
                );

                return (
                  <tr
                    key={item.id}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-950/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <IconTopologyStarRing3 className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                        <div>
                          <p className="font-semibold text-[#1B2A41] dark:text-slate-200 truncate max-w-[190px]">
                            {item.name}
                          </p>
                          {item.connectors && item.connectors.length > 0 && (
                            <span className="text-[10px] text-slate-400 truncate max-w-[180px] block">
                              {item.connectors.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {item.location}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isStandard
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200/60"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {item.planType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-[140px] truncate">
                      {item.resourceGroup}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-[140px] truncate">
                      {item.subscriptionName}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200">
                      {format(item.costMtdUSD)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {format(item.costPreviousMonthUSD)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {format(item.forecastEomUSD)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          item.healthStatus === "Available"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : item.healthStatus === "Degraded"
                            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                        }`}
                      >
                        {item.healthStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">
                      {item.runsStartedCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {item.runsFailedCount > 0 ? (
                        <span className="text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded flex items-center gap-1 w-fit">
                          <IconAlertCircle className="w-3 h-3" />
                          {item.runsFailedCount.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {matchingAction ? (
                        <button
                          onClick={() => setActiveModalAction(matchingAction)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer shadow-2xs"
                        >
                          <IconSparkles className="w-3.5 h-3.5" stroke={2} />
                          Optimizar
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">Óptimo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Paginación CMP */}
        <div className="px-5 py-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">{t("rowsPerPage")}</span>
            {[15, 30, 45, 60].map((size) => (
              <button
                key={size}
                onClick={() => {
                  setPageSize(size);
                  setPage(1);
                }}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                  pageSize === size
                    ? "bg-[#0078D4] text-white font-bold"
                    : "text-slate-500 hover:text-[#0078D4]"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-0.5 text-[11px] text-slate-500 hover:text-[#0078D4] disabled:opacity-30 cursor-pointer"
            >
              ←
            </button>
            <span className="text-[11px] text-slate-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2 py-0.5 text-[11px] text-slate-500 hover:text-[#0078D4] disabled:opacity-30 cursor-pointer"
            >
              →
            </button>
          </div>
        </div>
      </div>

      {/* ─── 5. Panel de Recomendaciones Priorizadas de Logic Apps ─── */}
      {remediationActions.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <IconSparkles className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t("la_opportunities")}
              </h3>
            </div>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200/60">
              {t("projectedSavingsPlus", { amount: format(summary.potentialSavingsUSD) })}
            </span>
          </div>

          <div className="space-y-3">
            {remediationActions.map((action) => (
              <div
                key={action.id}
                className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 hover:border-[#0078D4]/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${CATEGORY_COLORS[action.category] || "#0078D4"}15`,
                      }}
                    >
                      <IconArrowsExchange
                        className="w-4 h-4"
                        style={{ color: CATEGORY_COLORS[action.category] || "#0078D4" }}
                        stroke={1.5}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-200">
                          {action.title}
                        </p>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            action.confidence === "HIGH"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}
                        >
                          {action.confidence === "HIGH" ? "Alta confianza" : "Media confianza"}
                        </span>
                        <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                          {CATEGORY_LABELS[action.category] || action.category}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {expandedAction === action.id
                          ? action.description
                          : action.description.slice(0, 130) + "…"}
                      </p>
                      {action.description.length > 130 && (
                        <button
                          onClick={() =>
                            setExpandedAction(
                              expandedAction === action.id ? null : action.id
                            )
                          }
                          className="text-[10px] text-[#0078D4] hover:underline mt-1 cursor-pointer"
                        >
                          {expandedAction === action.id ? "Mostrar menos" : "Leer más"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-extrabold text-[#0078D4]">
                      +{format(action.estimatedSavingsUSD)}
                    </p>
                    <p className="text-[10px] text-slate-400">/mes ahorro</p>
                    <button
                      onClick={() => setActiveModalAction(action)}
                      className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer"
                    >
                      <IconSparkles className="w-3 h-3" stroke={2} />
                      Optimizar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Modal de Remediación a z-50 ─── */}
      <RemediationModal
        action={activeModalAction}
        item={items.find((i) => i.id === activeModalAction?.resourceId)}
        onClose={() => setActiveModalAction(null)}
      />
    </div>
  );
}

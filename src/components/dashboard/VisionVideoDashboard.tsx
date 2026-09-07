"use client";

import React, { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconEye,
  IconVideo,
  IconScan,
  IconRotateClockwise,
  IconExternalLink,
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
  IconTerminal2,
  IconBrandPowershell,
} from "@tabler/icons-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useCurrency } from "@/components/CurrencyProvider";
import type {
  VisionVideoPayload,
  VisionVideoResource,
  VisionVideoRemediationAction,
} from "@/types/azureVisionVideo.types";
import { buildVisionRemediationCommand } from "@/lib/aiRemediations";

// ─── Paleta de colores en tonos de azul ───
const CATEGORY_COLORS: Record<string, string> = {
  DEV_F0_DOWNGRADE: "#0078D4",
  VIDEO_PRESET_OPTIMIZE: "#2563EB",
  BATCH_PROCESSING: "#0284C7",
  ORPHAN_ACCOUNT: "#EF4444",
};

const CATEGORY_LABELS: Record<string, string> = {
  DEV_F0_DOWNGRADE: "Downgrade a Free Tier F0",
  VIDEO_PRESET_OPTIMIZE: "Optimización de Preset",
  BATCH_PROCESSING: "Procesamiento por Lotes",
  ORPHAN_ACCOUNT: "Cuenta Huérfana",
};

// ─── Fetcher con autenticación OAuth ───
function buildFetcher(instance: any, accounts: any[], isDemo: boolean) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isDemo && accounts[0]) {
      headers.Authorization = `Bearer ${await getFreshIdToken(instance, accounts[0])}`;
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
  const t = useTranslations("AzureAI");

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
        title={t("resize_hint")}
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500"
      />
    </th>
  );
}

// ─── KPI Card Corporativa ───
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

// ─── Empty State para Tenants Vivos ───
function EmptyState({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) {
  const t = useTranslations("AzureAI");
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-heading">
              Azure AI Vision & Video Indexer
            </h3>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-900/50 px-2 py-0.5 rounded-full">
              <IconCheck className="w-3 h-3" />
              {t("status_ready") || "Monitoreo activo"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            {t("vv_subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] dark:text-blue-400 hover:bg-[#0078D4] hover:text-white rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            <IconRotateClockwise className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} stroke={2} />
            {t("btn_sync") || "Actualizar telemetría"}
          </button>
          <a
            href="https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0054A6] hover:bg-[#004080] rounded-lg transition-colors shadow-xs"
          >
            <IconExternalLink className="w-3.5 h-3.5" />
            Azure Portal
          </a>
        </div>
      </div>

      <div className="bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-900/80 dark:to-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-8 text-center shadow-xs">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#0054A6] mb-4">
          <IconSparkles className="w-7 h-7" />
        </div>
        <h4 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 mb-1.5">
          {t("empty_title") || "Sin telemetría de consumo registrada"}
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
          {t("empty_description") ||
            "No se detectaron cuentas de Computer Vision, Face API o Video Indexer con actividad en este ciclo."}
        </p>
        <div className="mt-6 pt-6 border-t border-slate-200/70 dark:border-slate-800 text-left">
          <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-4 text-center">
            {t("quick_guide_title") || "Pasos para comenzar a monitorear este servicio"}
          </h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: "1. Despliegue en Azure",
                desc: "Aprovisiona un recurso de Computer Vision o Video Indexer en Azure Portal.",
              },
              {
                title: "2. Permisos del Tenant",
                desc: "Verifica permisos de Reader y Cost Management Reader en el Service Principal.",
              },
              {
                title: "3. Ingesta Automática",
                desc: "Las métricas de llamadas OCR e indexación se reflejarán automáticamente.",
              },
            ].map((step, idx) => (
              <div
                key={idx}
                className="bg-white dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950/50 text-[#0054A6] flex items-center justify-center text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                    {step.title}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Acción y Remediación (z-50) ───
function RemediationModal({
  action,
  onClose,
}: {
  action: VisionVideoRemediationAction | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [cmdTab, setCmdTab] = useState<"cli" | "powershell">("cli");
  const t = useTranslations("AzureAI");
  const { format } = useCurrency();

  if (!action) return null;

  const commands = buildVisionRemediationCommand(action);
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
                {t("cs_action_savings")}{" "}
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {format(action.estimatedSavingsUSD)}/mes
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {action.description}
          </div>

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
                {copied ? <IconCheck className="w-3.5 h-3.5 text-emerald-500" /> : <IconCopy className="w-3.5 h-3.5" />}
                {copied ? t("copied") : t("copy_command")}
              </button>
            </div>

            <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl text-xs font-mono overflow-x-auto border border-slate-800">
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
            {t("copy_and_run")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function VisionVideoDashboard() {
  const t = useTranslations("AzureAI");
  const tc = useTranslations("Common");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const { format } = useCurrency();

  const tenantId = selectedTenant?.id;
  const isDemo = Boolean(tenantId && isMockTenant(tenantId));
  const canFetch = !!tenantId && tenantId !== "default" && (accounts.length > 0 || isDemo);

  const [timeRange, setTimeRange] = useState<"MTD" | "30D" | "90D">("MTD");
  const [filterService, setFilterService] = useState("ALL");
  const [filterResourceGroup, setFilterResourceGroup] = useState("ALL");
  const [filterSubscription, setFilterSubscription] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof VisionVideoResource>("totalCostUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [activeModalAction, setActiveModalAction] = useState<VisionVideoRemediationAction | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, isDemo),
    [instance, accounts, isDemo]
  );

  const apiUrl = canFetch
    ? `/api/intelligence/azure-ai/vision-video?tenantId=${encodeURIComponent(tenantId!)}&timeRange=${timeRange}${isDemo ? "&mock=true" : ""}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<VisionVideoPayload>(
    apiUrl,
    fetcher,
    { revalidateOnFocus: false }
  );

  const isRefreshing = isLoading;

  if (!selectedTenant || selectedTenant.id === "default") return null;

  if (isLoading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <IconLoader2 className="w-8 h-8 animate-spin text-[#0078D4] mb-4" stroke={1.5} />
        <p className="text-slate-500">{t("vv_loading")}</p>
      </div>
    );
  }

  if (!isDemo && (!data || data.resources.length === 0) && !isLoading) {
    return <EmptyState onRefresh={() => mutate()} isRefreshing={isRefreshing} />;
  }

  if (error && !data) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
        <h3 className="font-bold flex items-center gap-2">
          <IconAlertTriangle className="w-4 h-4" /> Error
        </h3>
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  const { summary, resources, dailyTrend, remediationActions } = data;

  // ─── Opciones para Filtros ───
  const serviceOptions = ["ALL", ...new Set(resources.map((r) => r.kind))];
  const rgOptions = ["ALL", ...new Set(resources.map((r) => r.resourceGroup))];
  const subOptions = ["ALL", ...new Set(resources.map((r) => r.subscriptionName))];

  // ─── Filtrado ───
  const filteredResources = resources
    .filter((r) => filterService === "ALL" || r.kind === filterService)
    .filter((r) => filterResourceGroup === "ALL" || r.resourceGroup === filterResourceGroup)
    .filter((r) => filterSubscription === "ALL" || r.subscriptionName === filterSubscription)
    .filter((r) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.name.toLowerCase().includes(q) ||
        r.resourceGroup.toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q)
      );
    });

  // ─── Ordenamiento ───
  const sortedResources = [...filteredResources].sort((a, b) => {
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
  const totalPages = Math.max(1, Math.ceil(sortedResources.length / pageSize));
  const paginatedResources = sortedResources.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (key: keyof VisionVideoResource) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const SortIcon = ({ column }: { column: keyof VisionVideoResource }) => {
    if (sortKey !== column) return null;
    return sortDir === "desc" ? (
      <IconChevronDown className="w-3 h-3 inline ml-1" />
    ) : (
      <IconChevronUp className="w-3 h-3 inline ml-1" />
    );
  };

  // ─── Datos para Donut ───
  const donutData = summary.breakdownByService.map((s) => ({
    name: s.serviceName,
    value: s.costUSD,
    color: s.color,
  }));

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-900/50 px-2.5 py-1 rounded-full">
            <IconCheck className="w-3 h-3" />
            Monitoreo activo
          </span>
          {data.source === "mock" && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/80 px-2 py-0.5 rounded-full">
              <IconInfoCircle className="w-3 h-3" />
              Demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as "MTD" | "30D" | "90D")}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
          >
            <option value="MTD">{t("time_mtd")}</option>
            <option value="30D">{t("time_30d")}</option>
            <option value="90D">{t("time_90d")}</option>
          </select>
          <button
            onClick={() => mutate()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] dark:text-blue-400 hover:bg-[#0078D4] hover:text-white rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            <IconRotateClockwise className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} stroke={2} />
            {t("btn_sync")}
          </button>
          <a
            href="https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0054A6] hover:bg-[#004080] rounded-lg transition-colors shadow-xs"
          >
            <IconExternalLink className="w-3.5 h-3.5" />
            Azure Portal
          </a>
        </div>
      </div>

      {/* ─── KPI Cards Superiores ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={IconCash}
          label={t("kpi_cost_mtd")}
          value={format(summary.totalCostUSD)}
          sub={`Ahorro potencial: ${format(summary.potentialSavingsUSD)}/m`}
        />
        <KpiCard
          icon={IconEye}
          label={t("vv_kpi_images")}
          value={`${(summary.totalImages / 1000).toFixed(1)}K`}
          sub="Transacciones de imagen acumuladas"
        />
        <KpiCard
          icon={IconVideo}
          label={t("vv_indexedMinutes")}
          value={`${summary.totalVideoMinutes.toLocaleString()} min`}
          sub="Procesamiento en Video Indexer"
        />
        <KpiCard
          icon={IconScan}
          label="Transacciones Face & Custom"
          value={`${(summary.totalFaceCalls / 1000).toFixed(1)}K`}
          sub="Biometría facial y modelos custom"
        />
      </div>

      {/* ─── Fila 1: Gráficas de Capacidad & Evolución ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut: Distribución de Gasto */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">
            {t("vv_spend_by_service")}
          </h3>
          <div className="flex items-center gap-4">
            <div className="w-48 h-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {donutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => format(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 flex-1 min-w-0">
              {donutData.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-xs text-slate-600 dark:text-slate-400 truncate flex-1">
                    {s.name}
                  </span>
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                    {format(s.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Área: Evolución Diaria */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">
            {t("vv_daily_evolution")}
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyTrend}>
              <defs>
                <linearGradient id="imagesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0078D4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#0078D4" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="videoGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563EB" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="imagesK"
                stroke="#0078D4"
                strokeWidth={2}
                fill="url(#imagesGrad)"
                name={t("vv_series_images")}
              />
              <Area
                type="monotone"
                dataKey="videoMinutes"
                stroke="#2563EB"
                strokeWidth={2}
                fill="url(#videoGrad)"
                name="Video (min)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── Fila 2: Tabla Desglose CMP ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t("vv_table_title")}
          </h3>
        </div>

        {/* Filtros Inmediatos */}
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
          <IconFilter className="w-4 h-4 text-slate-400" stroke={1.5} />
          
          <div className="relative">
            <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder={t("search_resource")}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-2.5 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 w-44"
            />
          </div>

          <select
            value={filterService}
            onChange={(e) => {
              setFilterService(e.target.value);
              setPage(1);
            }}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
          >
            {serviceOptions.map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "Todos los Servicios" : s}
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

          <select
            value={filterSubscription}
            onChange={(e) => {
              setFilterSubscription(e.target.value);
              setPage(1);
            }}
            className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
          >
            {subOptions.map((sub) => (
              <option key={sub} value={sub}>
                {sub === "ALL" ? "Todas las Suscripciones" : sub}
              </option>
            ))}
          </select>

          <span className="text-[11px] text-slate-400 ml-auto">
            {t("vv_resources_found", { n: filteredResources.length })}
          </span>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
              <tr>
                <ResizableTh minWidth={200}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("name")}
                  >
                    {t("col_resource_name")}
                    <SortIcon column="name" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={140}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("kind")}
                  >
                    Capacidad / Servicio
                    <SortIcon column="kind" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={130}>
                  <span>Volumen Procesado</span>
                </ResizableTh>
                <ResizableTh minWidth={130}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("resourceGroup")}
                  >
                    {t("col_resource_group")}
                    <SortIcon column="resourceGroup" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={140}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("subscriptionName")}
                  >
                    {t("col_subscription")}
                    <SortIcon column="subscriptionName" />
                  </button>
                </ResizableTh>
                <ResizableTh minWidth={110}>
                  <button
                    className="flex items-center gap-1 cursor-pointer hover:text-[#0078D4]"
                    onClick={() => handleSort("totalCostUSD")}
                  >
                    {t("col_cost_mtd")}
                    <SortIcon column="totalCostUSD" />
                  </button>
                </ResizableTh>
                <th className="px-4 py-3 text-left font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedResources.map((resource) => {
                const isVideo = resource.kind === "VideoIndexer";
                const isFace = resource.kind === "Face";
                const Icon = isVideo ? IconVideo : isFace ? IconScan : IconEye;

                let volumeLabel = `${(resource.imagesAnalyzed / 1000).toFixed(1)}K img`;
                if (isVideo) {
                  volumeLabel = `${resource.videoMinutesProcessed.toLocaleString()} min`;
                } else if (isFace) {
                  volumeLabel = `${(resource.faceCallsCount / 1000).toFixed(1)}K calls`;
                } else if (resource.kind.startsWith("CustomVision")) {
                  volumeLabel = `${resource.trainingHours.toFixed(1)}h training`;
                }

                // Matching action
                const matchingAction = remediationActions.find(
                  (a) => a.resourceId === resource.id
                );

                return (
                  <tr
                    key={resource.id}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-950/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                        <div>
                          <p className="font-semibold text-[#1B2A41] dark:text-slate-200 truncate max-w-[180px]">
                            {resource.name}
                          </p>
                          <span className="text-[10px] text-slate-400">{resource.location}</span>
                        </div>
                        <span
                          className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            resource.skuName === "F0"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-blue-50 text-[#0078D4] dark:bg-blue-950/40"
                          }`}
                        >
                          {resource.skuName}
                        </span>
                        {resource.isDevOrTest && (
                          <span className="text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1 py-0.2 rounded">
                            DEV
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-medium">
                      {resource.kind === "ComputerVision"
                        ? "Computer Vision (OCR)"
                        : resource.kind === "VideoIndexer"
                        ? "Video Indexer"
                        : resource.kind === "Face"
                        ? "Face API"
                        : resource.kind}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">
                      {volumeLabel}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {resource.resourceGroup}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-[140px] truncate">
                      {resource.subscriptionName}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#1B2A41] dark:text-slate-200">
                      {format(resource.totalCostUSD)}
                    </td>
                    <td className="px-4 py-3">
                      {matchingAction ? (
                        <button
                          onClick={() => setActiveModalAction(matchingAction)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] dark:text-blue-400 hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer shadow-2xs"
                        >
                          <IconSparkles className="w-3.5 h-3.5" stroke={2} />
                          Optimizar
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">{tc("optimal")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        <div className="px-5 py-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">{t("rows_per_page")}</span>
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

      {/* ─── Fila 3: Recomendaciones Resolutivas ─── */}
      {remediationActions.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <IconSparkles className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t("opportunities_finops")}
              </h3>
            </div>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200/60">
              {t("aml_total_savings", { amount: format(summary.potentialSavingsUSD) })}
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
                      <IconSparkles
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
                          : action.description.slice(0, 120) + "…"}
                      </p>
                      {action.description.length > 120 && (
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
                      className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-slate-900 border border-[#0078D4] text-[#0078D4] dark:text-blue-400 hover:bg-[#0078D4] hover:text-white transition-all cursor-pointer"
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
        onClose={() => setActiveModalAction(null)}
      />
    </div>
  );
}

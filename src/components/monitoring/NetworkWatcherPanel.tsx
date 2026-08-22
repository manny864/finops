"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconCash,
  IconWorld,
  IconRoute,
  IconActivity,
  IconRouter,
  IconRotateClockwise,
  IconSearch,
  IconDatabaseExport,
  IconTerminal2,
  IconX,
  IconCheck,
  IconCopy,
  IconAlertTriangle,
  IconChartAreaLine,
  IconDatabase,
  IconSparkles,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildNetworkWatcherRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import type {
  NetworkWatcherPayload,
  NetworkWatcherRemediationAction,
  NetworkWatcherResource,
} from "@/types/azureNetworkWatcher.types";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

function buildFetcher(instance: IPublicClientApplication, accounts: AccountInfo[], isMock: boolean) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isMock && accounts.length > 0) {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      } catch {
        // Se deja propagar el 401 del servidor; no hay mock de rescate.
      }
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Error al cargar Azure Network Watcher");
    }
    return res.json();
  };
}

/** Badge semaforico del intervalo de Traffic Analytics. */
function TrafficAnalyticsBadge({ watcher }: { watcher: NetworkWatcherResource }) {
  if (watcher.trafficAnalyticsActiveCount === 0) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900">
        Inactivo
      </span>
    );
  }
  const wasteful = watcher.isDevOrTest && watcher.trafficAnalytics10MinCount > 0;
  return (
    <div className="flex flex-wrap gap-1">
      {watcher.trafficAnalytics10MinCount > 0 && (
        <span
          title={
            wasteful
              ? "10 min en un scope no productivo: candidato directo a pasar a 60 min"
              : "10 min en produccion: puede estar justificado por deteccion temprana"
          }
          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 ${
            wasteful
              ? "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
              : "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300"
          }`}
        >
          {watcher.trafficAnalytics10MinCount} × 10 min
        </span>
      )}
      {watcher.trafficAnalytics60MinCount > 0 && (
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900">
          {watcher.trafficAnalytics60MinCount} × 60 min
        </span>
      )}
    </div>
  );
}

// ─── Drawer de Flow Logs y Monitores (z-50) ───
function WatcherDetailDrawer({
  watcher,
  initialTab,
  onClose,
}: {
  watcher: NetworkWatcherResource | null;
  initialTab: "flowlogs" | "monitors";
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"flowlogs" | "monitors">(initialTab);
  // El tab pedido cambia entre aperturas del mismo drawer; sincronizarlo aca
  // evita reabrir siempre en la pestaña de la vez anterior.
  const [lastWatcherId, setLastWatcherId] = useState<string | null>(null);
  if (watcher && watcher.id !== lastWatcherId) {
    setLastWatcherId(watcher.id);
    setTab(initialTab);
  }

  if (!watcher) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-5 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                <IconRouter className="w-5 h-5 text-[#0078D4] shrink-0" stroke={1.5} />
                <span className="truncate">{watcher.name}</span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                {watcher.location} · {watcher.resourceGroup} · {watcher.subscriptionName}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
              aria-label="Cerrar"
            >
              <IconX className="w-5 h-5" />
            </button>
          </div>
          <div className="flex gap-1 mt-3">
            {(
              [
                ["flowlogs", `Flow Logs (${watcher.flowLogsCount})`],
                ["monitors", `Connection Monitors (${watcher.connectionMonitorsCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition cursor-pointer ${
                  tab === key
                    ? "border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900"
                    : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {watcher.wasteReason && (
            <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 flex items-start gap-2">
              <IconAlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" stroke={1.5} />
              <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">{watcher.wasteReason}</p>
            </div>
          )}

          {tab === "flowlogs" ? (
            watcher.flowLogs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                Esta region no tiene Flow Logs configurados. El Network Watcher se aprovisiona solo al crear una
                VNet; sin flow logs no genera costo.
              </p>
            ) : (
              <div className="space-y-2.5">
                {watcher.flowLogs.map((fl) => (
                  <div key={fl.id} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 truncate block">
                          {fl.name}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {fl.targetKind} · {fl.targetResourceName}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 shrink-0 ${
                          fl.enabled
                            ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                            : "border-slate-300 dark:border-slate-700 text-slate-500"
                        }`}
                      >
                        {fl.enabled ? "Habilitado" : "Deshabilitado"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Traffic Analytics</div>
                        <div className="font-semibold text-[#1B2A41] dark:text-slate-200">
                          {fl.trafficAnalyticsEnabled ? `${fl.trafficAnalyticsInterval} min` : "Deshabilitado"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Retencion</div>
                        <div
                          className={`font-semibold ${
                            fl.retentionDays === 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-[#1B2A41] dark:text-slate-200"
                          }`}
                        >
                          {fl.retentionDays === 0 ? "Infinita" : `${fl.retentionDays} dias`}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Procesado</div>
                        <div className="font-semibold text-[#1B2A41] dark:text-slate-200">
                          {fl.processedGBPerMonth} GB/mes
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Almacenado</div>
                        <div className="font-semibold text-[#1B2A41] dark:text-slate-200">
                          {fl.storedGBPerMonth} GB/mes
                        </div>
                      </div>
                    </div>
                    {fl.storageAccountName && (
                      <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                        <IconDatabase className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                        {fl.storageAccountName}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : watcher.connectionMonitors.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
              No hay Connection Monitors en esta region.
            </p>
          ) : (
            <div className="space-y-2.5">
              {watcher.connectionMonitors.map((cm) => (
                <div key={cm.id} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 truncate">{cm.name}</span>
                    {cm.hasUnreachableEndpoint && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 bg-white dark:bg-slate-900 shrink-0">
                        Endpoint inalcanzable
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Pruebas</div>
                      <div className="font-semibold text-[#1B2A41] dark:text-slate-200">{cm.testsCount}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Frecuencia</div>
                      <div
                        className={`font-semibold ${
                          cm.minFrequencySeconds > 0 && cm.minFrequencySeconds <= 30
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-[#1B2A41] dark:text-slate-200"
                        }`}
                      >
                        {cm.minFrequencySeconds > 0 ? `${cm.minFrequencySeconds} s` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Endpoints</div>
                      <div className="font-semibold text-[#1B2A41] dark:text-slate-200">{cm.endpointsCount}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Costo/mes</div>
                      <div className="font-semibold text-[#1B2A41] dark:text-slate-200">
                        {formatCurrency(cm.monthlyCostUSD)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Remediacion (z-50) ───
function NetworkRemediationModal({
  action,
  onClose,
}: {
  action: NetworkWatcherRemediationAction | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"cli" | "ps" | null>(null);
  if (!action) return null;

  const cmd = buildNetworkWatcherRemediationCommand(action);
  const copy = (text: string, which: "cli" | "ps") => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl p-6 relative z-50 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          aria-label="Cerrar"
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <IconTerminal2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div className="pr-8">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{action.title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{action.description}</p>
          </div>
        </div>

        {action.estimatedSavingsUSD > 0 && (
          <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
            <span className="text-xs text-slate-600 dark:text-slate-400">Ahorro mensual estimado: </span>
            <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(action.estimatedSavingsUSD)}
            </span>
          </div>
        )}

        {([
          ["Azure CLI", cmd.cli, "cli"],
          ["PowerShell", cmd.powershell, "ps"],
        ] as const).map(([label, text, key]) => (
          <div key={key} className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{label}</span>
              <button
                onClick={() => copy(text, key)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white dark:bg-slate-900 transition flex items-center gap-1 cursor-pointer ${
                  copied === key
                    ? "border-emerald-600 text-emerald-600"
                    : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                {copied === key ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
                {copied === key ? "Copiado" : "Copiar"}
              </button>
            </div>
            <pre className="p-3.5 bg-slate-950 text-slate-100 rounded-xl font-mono text-[11px] overflow-x-auto border border-slate-800 leading-relaxed whitespace-pre-wrap">
              {text}
            </pre>
          </div>
        ))}

        <p className="text-[10px] text-slate-400 mt-2">
          Los placeholders entre &lt;&gt; deben completarse con los nombres reales. La plataforma no ejecuta
          cambios en Azure.
        </p>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function NetworkWatcherPanel() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const isMock = useMemo(() => {
    return (
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    );
  }, [tenantId, searchParams]);

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock), [instance, accounts, isMock]);

  const apiUrl = `/api/intelligence/monitoring/network-watcher?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<NetworkWatcherPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("ALL");
  const [selectedTa, setSelectedTa] = useState("ALL");
  const [selectedSub, setSelectedSub] = useState("ALL");
  const [selectedRg, setSelectedRg] = useState("ALL");

  const [drawerWatcher, setDrawerWatcher] = useState<NetworkWatcherResource | null>(null);
  const [drawerTab, setDrawerTab] = useState<"flowlogs" | "monitors">("flowlogs");
  const [activeRemediation, setActiveRemediation] = useState<NetworkWatcherRemediationAction | null>(null);

  const watchersList = useMemo(() => data?.watchers || [], [data?.watchers]);

  const regions = useMemo(
    () => Array.from(new Set(watchersList.map((w) => w.location).filter(Boolean))).sort(),
    [watchersList]
  );
  const subscriptions = useMemo(() => {
    const map = new Map<string, string>();
    watchersList.forEach((w) => map.set(w.subscriptionId, w.subscriptionName || w.subscriptionId));
    return Array.from(map.entries());
  }, [watchersList]);
  const resourceGroups = useMemo(
    () => Array.from(new Set(watchersList.map((w) => w.resourceGroup).filter(Boolean))).sort(),
    [watchersList]
  );

  const filteredWatchers = useMemo(() => {
    return watchersList
      .filter((w) => {
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const hit =
            w.name.toLowerCase().includes(term) ||
            w.location.toLowerCase().includes(term) ||
            w.resourceGroup.toLowerCase().includes(term);
          if (!hit) return false;
        }
        if (selectedRegion !== "ALL" && w.location !== selectedRegion) return false;
        if (selectedSub !== "ALL" && w.subscriptionId !== selectedSub) return false;
        if (selectedRg !== "ALL" && w.resourceGroup !== selectedRg) return false;
        if (selectedTa === "TA_10" && w.trafficAnalytics10MinCount === 0) return false;
        if (selectedTa === "TA_60" && w.trafficAnalytics60MinCount === 0) return false;
        if (selectedTa === "TA_OFF" && w.trafficAnalyticsActiveCount > 0) return false;
        return true;
      })
      .sort((a, b) => b.totalEstimatedRealCostUSD - a.totalEstimatedRealCostUSD);
  }, [watchersList, searchTerm, selectedRegion, selectedTa, selectedSub, selectedRg]);

  const {
    paged: paginatedWatchers,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredWatchers, 15);

  const handleExportCSV = () => {
    if (filteredWatchers.length === 0) return;
    const headers = [
      "Network Watcher",
      "Region",
      "Resource Group",
      "Subscription",
      "Flow Logs",
      "TA 10min",
      "TA 60min",
      "Connection Monitors",
      "Storage Account",
      "Retention Days",
      "Traffic Analytics USD",
      "Connection Monitor USD",
      "Storage USD",
      "Total Real Cost USD",
    ];
    const rows = filteredWatchers.map((w) => [
      `"${w.name}"`,
      `"${w.location}"`,
      `"${w.resourceGroup}"`,
      `"${w.subscriptionName}"`,
      w.flowLogsCount,
      w.trafficAnalytics10MinCount,
      w.trafficAnalytics60MinCount,
      w.connectionMonitorsCount,
      `"${w.linkedStorageAccountName || ""}"`,
      w.storageRetentionDays === 0 ? `"Infinita"` : w.storageRetentionDays,
      w.estimatedTrafficAnalyticsCostUSD.toFixed(2),
      w.estimatedConnectionMonitorCostUSD.toFixed(2),
      w.estimatedStorageCostUSD.toFixed(2),
      w.totalEstimatedRealCostUSD.toFixed(2),
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `azure-network-watcher-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary || {
    totalRealCostUSD: 0,
    totalWatchersCount: 0,
    totalFlowLogsCount: 0,
    totalConnectionMonitorsCount: 0,
    trafficAnalytics10MinCount: 0,
    trafficAnalytics60MinCount: 0,
    totalProcessedGBPerMonth: 0,
    potentialSavingsUSD: 0,
    breakdownByService: [],
  };

  const ingestTrend = data?.ingestTrend || [];

  const openDrawer = (w: NetworkWatcherResource, tab: "flowlogs" | "monitors") => {
    setDrawerTab(tab);
    setDrawerWatcher(w);
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconRouter className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>Network Watcher — Diagnostico de Red y Costo Real</span>
              <InfoTooltip
                content="El recurso Network Watcher es gratuito, por eso Azure lo muestra en $0.00. El gasto real lo generan sus capacidades: Traffic Analytics (procesa los flow logs en Log Analytics), Connection Monitor (por prueba/mes) y el almacenamiento de los Flow Logs. Este tablero consolida los tres y los atribuye al watcher regional que los origina."
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Azure Resource Graph" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Flow Logs, Traffic Analytics, Connection Monitors y ciclo de vida del almacenamiento de diagnostico
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconDatabaseExport className="w-4 h-4 text-[#0078D4]" />
            Exportar CSV
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── 4 Tarjetas KPI ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Costo Total de Diagnostico</span>
              <InfoTooltip content="Suma consolidada MTD de Traffic Analytics, Connection Monitor, almacenamiento de Flow Logs y packet captures. El recurso Network Watcher en si no cuesta nada." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCurrency(summary.totalRealCostUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.totalProcessedGBPerMonth} GB procesados/mes
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Regiones con Watcher</span>
              <InfoTooltip content="Network Watchers regionales aprovisionados. Azure crea uno automaticamente en cada region donde se cree una VNet." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalWatchersCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {watchersList.filter((w) => w.flowLogsCount === 0).length} sin flow logs
            </div>
          </div>
          <IconWorld className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Flow Logs &amp; Traffic Analytics</span>
              <InfoTooltip content="Configuraciones de Flow Log activas y en que intervalo procesan. Azure solo admite 10 o 60 minutos; el de 10 procesa del orden del doble." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalFlowLogsCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-1.5">
              {summary.trafficAnalytics10MinCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  {summary.trafficAnalytics10MinCount} × 10 min
                </span>
              )}
              <span className="text-[#0054A6] dark:text-blue-300 font-semibold">
                {summary.trafficAnalytics60MinCount} × 60 min
              </span>
            </div>
          </div>
          <IconRoute className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Connection Monitors</span>
              <InfoTooltip content="Pruebas de conectividad en ejecucion. Se facturan por prueba y por mes, no por sondeo: bajar la frecuencia no reduce esta tarifa, reduce la telemetria asociada." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalConnectionMonitorsCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {formatCurrency(
                watchersList.reduce((a, w) => a + w.estimatedConnectionMonitorCostUSD, 0)
              )}
              /mes
            </div>
          </div>
          <IconActivity className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>
      </div>

      {/* ─── Fila 1: Distribucion de costos + Volumen ingerido ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            Distribucion de Costos de Diagnostico
            <InfoTooltip content="Reparto del gasto real entre las cuatro capacidades del Network Watcher. Traffic Analytics suele dominar porque paga procesamiento e ingesta en Log Analytics." />
          </h3>
          {summary.breakdownByService.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              Sin costo de diagnostico registrado
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <PieChart>
                <Pie
                  data={summary.breakdownByService}
                  dataKey="costUSD"
                  nameKey="serviceName"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                >
                  {summary.breakdownByService.map((entry) => (
                    <Cell key={entry.serviceName} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            <IconChartAreaLine className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            Volumen de Datos de Red Ingeridos (GB MTD)
            <InfoTooltip content="GB de flujos procesados por Traffic Analytics por dia. En tenants conectados se poblara con la telemetria real de Cost Management." />
          </h3>
          {ingestTrend.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              Sin serie historica disponible para este tenant
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <AreaChart data={ingestTrend}>
                <defs>
                  <linearGradient id="nwIngestGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
                <RechartsTooltip formatter={(v) => `${Number(v ?? 0).toFixed(2)} GB`} />
                <Area
                  type="monotone"
                  dataKey="processedGB"
                  stroke="#0078D4"
                  strokeWidth={2}
                  fill="url(#nwIngestGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── Fila 2: Filtros ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por watcher, region, grupo de recursos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            />
          </div>

          <select
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Todas las regiones</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <select
            value={selectedTa}
            onChange={(e) => setSelectedTa(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Traffic Analytics (Todos)</option>
            <option value="TA_10">Habilitado (10 min)</option>
            <option value="TA_60">Habilitado (60 min)</option>
            <option value="TA_OFF">Deshabilitado</option>
          </select>

          <select
            value={selectedSub}
            onChange={(e) => setSelectedSub(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Todas las suscripciones</option>
            {subscriptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={selectedRg}
            onChange={(e) => setSelectedRg(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Todos los RGs</option>
            {resourceGroups.map((rg) => (
              <option key={rg} value={rg}>
                {rg}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Fila 3: Tabla de Inventario ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
            Inventario y Diagnostico de Network Watcher
          </h3>
          <InfoTooltip content="Un watcher por region, con sus flow logs, monitores, storage vinculado y el costo real que originan sus capacidades." />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">{total} watchers</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <ResizableTh minWidth={220}>Network Watcher</ResizableTh>
                <ResizableTh minWidth={120}>Region</ResizableTh>
                <ResizableTh minWidth={170}>Suscripcion</ResizableTh>
                <ResizableTh minWidth={110}>Flow Logs</ResizableTh>
                <ResizableTh minWidth={150}>Traffic Analytics</ResizableTh>
                <ResizableTh minWidth={120}>Monitores</ResizableTh>
                <ResizableTh minWidth={190}>Storage Vinculado</ResizableTh>
                <ResizableTh minWidth={120}>Costo Real MTD</ResizableTh>
                <ResizableTh minWidth={230}>Acciones</ResizableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedWatchers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    <IconRouter className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
                    <p className="text-xs font-medium">
                      {watchersList.length === 0
                        ? "Azure no reporta Network Watchers en las suscripciones visibles."
                        : "Ningun watcher coincide con los filtros aplicados."}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedWatchers.map((w: NetworkWatcherResource) => (
                  <tr key={w.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => openDrawer(w, "flowlogs")}
                        className="flex items-start gap-2 text-left cursor-pointer group"
                      >
                        <IconRouter className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                        <span className="min-w-0">
                          <span className="block font-semibold text-[#1B2A41] dark:text-slate-100 group-hover:text-[#0054A6] truncate max-w-[220px]">
                            {w.name}
                          </span>
                          <span className="flex items-center gap-1 mt-0.5">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900">
                              {w.location}
                            </span>
                            {w.isDevOrTest && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900">
                                Dev/Test
                              </span>
                            )}
                            {w.isWasteful && (
                              <IconAlertTriangle
                                className="w-3.5 h-3.5 text-amber-500"
                                stroke={2}
                                title={w.wasteReason}
                              />
                            )}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{w.location}</td>
                    <td
                      className="px-3 py-2.5 text-slate-600 dark:text-slate-400 truncate max-w-[180px]"
                      title={w.subscriptionName}
                    >
                      {w.subscriptionName}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-[#1B2A41] dark:text-slate-100">{w.flowLogsCount}</span>
                      {w.flowLogsCount > 0 && (
                        <span className="block text-[10px] text-slate-400">
                          {w.flowLogs.filter((f) => f.targetKind === "NSG").length} NSG ·{" "}
                          {w.flowLogs.filter((f) => f.targetKind === "VNet").length} VNet
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <TrafficAnalyticsBadge watcher={w} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-[#1B2A41] dark:text-slate-100">
                        {w.connectionMonitorsCount}
                      </span>
                      {w.connectionMonitors.some((m) => m.hasUnreachableEndpoint) && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                          con huerfanos
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {w.linkedStorageAccountName ? (
                        <>
                          <span className="text-slate-700 dark:text-slate-300 truncate block max-w-[180px]">
                            {w.linkedStorageAccountName}
                          </span>
                          <span
                            className={`text-[10px] ${
                              w.storageRetentionDays === 0
                                ? "text-amber-600 dark:text-amber-400 font-semibold"
                                : "text-slate-400"
                            }`}
                          >
                            {w.storageRetentionDays === 0
                              ? "Retencion infinita"
                              : `${w.storageRetentionDays} dias de retencion`}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-[#1B2A41] dark:text-slate-100 whitespace-nowrap">
                      {formatCurrency(w.totalEstimatedRealCostUSD)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => openDrawer(w, "flowlogs")}
                          className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                        >
                          <IconSparkles size={13} stroke={1.5} className="text-[#0054A6]" />
                          Ver Flow Logs
                        </button>
                        <button
                          onClick={() => openDrawer(w, "monitors")}
                          className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer whitespace-nowrap"
                        >
                          Ver Monitores
                        </button>
                        {w.trafficAnalytics10MinCount > 0 && (
                          <button
                            onClick={() =>
                              setActiveRemediation({
                                id: `ta-manual-${w.id}`,
                                resourceId: w.id,
                                title: `Optimizar intervalo de Traffic Analytics en ${w.location}`,
                                description: `${w.trafficAnalytics10MinCount} configuracion(es) procesan cada 10 min. Azure solo admite 10 o 60; pasar a 60 recorta ~60% del volumen procesado.`,
                                category: "TRAFFIC_ANALYTICS_INTERVAL",
                                estimatedSavingsUSD: 0,
                                confidence: "MEDIUM",
                                actionType: "SET_TA_INTERVAL_60",
                              })
                            }
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] bg-white dark:bg-slate-900 text-[#00AEEF] hover:bg-sky-50/50 dark:hover:bg-sky-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                          >
                            <IconSparkles size={13} stroke={1.5} className="text-[#00AEEF]" />
                            Optimizar Intervalo
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            total={total}
            setPage={setPage}
            setPageSize={setPageSize}
            pageSizes={[15, 30, 45, 60]}
          />
        </div>
      </div>

      {/* ─── Recomendaciones ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            Recomendaciones Priorizadas de Red
            <InfoTooltip content="Acciones ordenadas por ahorro mensual. Las que no reducen tarifa directa (frecuencia de sondeo) figuran con $0.00 en vez de un ahorro inflado: su beneficio es menos telemetria ingerida." />
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Ahorro potencial total identificado:{" "}
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(summary.potentialSavingsUSD)}/mes
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {data?.remediations && data.remediations.length > 0 ? (
            data.remediations.map((action) => (
              <div
                key={action.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between space-y-3 hover:border-blue-300 dark:hover:border-blue-700 transition"
              >
                <div className="space-y-1.5">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900 uppercase">
                      {action.category}
                    </span>
                    {action.estimatedSavingsUSD > 0 && (
                      <span className="text-xs font-extrabold text-emerald-600">
                        +{formatCurrency(action.estimatedSavingsUSD)}/mes
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">{action.title}</h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-3 leading-relaxed">
                    {action.description}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-medium">Confianza: {action.confidence}</span>
                  <button
                    onClick={() => setActiveRemediation(action)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1 cursor-pointer"
                  >
                    <IconTerminal2 className="w-3.5 h-3.5" />
                    Remediar
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              No se detectaron intervalos agresivos, retenciones infinitas ni monitores huerfanos.
            </div>
          )}
        </div>
      </div>

      {/* ─── Capas superpuestas (z-50) ─── */}
      <WatcherDetailDrawer watcher={drawerWatcher} initialTab={drawerTab} onClose={() => setDrawerWatcher(null)} />
      <NetworkRemediationModal action={activeRemediation} onClose={() => setActiveRemediation(null)} />
    </div>
  );
}

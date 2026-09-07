"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconAlertCircle,
  IconReceipt2,
  IconCircleCheck,
  IconClockCheck,
  IconActivity,
  IconTrendingUp,
  IconAlertTriangle,
  IconCheck,
  IconHistory,
  IconRotateClockwise,
  IconSparkles,
  IconX,
  IconClock,
  IconAdjustments,
  IconBellRinging,
  IconDatabaseExport,
  IconTerminal2,
  IconCopy,
  IconChevronRight,
  IconSearch,
} from "@tabler/icons-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  type AnomalyPayload,
  type AnomalyState,
  type CostAnomalyItem,
} from "@/types/azureAnomalyDetection.types";
import { useTranslations } from "next-intl";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 " +
  "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full " +
  "[&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 " +
  "[&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

function formatHours(hours: number): string {
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function buildFetcher(
  instance: IPublicClientApplication,
  accounts: AccountInfo[],
  isMock: boolean,
  mensajeError: string
) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isMock && accounts.length > 0) {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      } catch {
        // Dejar propagar
      }
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || mensajeError);
    }
    return res.json();
  };
}

// ─── Drawer Lateral de Causa Raíz ───
interface RootCauseDrawerProps {
  anomaly: CostAnomalyItem | null;
  onClose: () => void;
}

function RootCauseDrawer({ anomaly, onClose }: RootCauseDrawerProps) {
  const t = useTranslations("AnomalyPanel");
  const [copied, setCopied] = useState(false);

  if (!anomaly) return null;

  const cliExample = `# ${t('cliComment')} ${anomaly.rootCauses[0]?.serviceName || t('cliService')}\n` +
    `az monitor metrics alert create --name "alert-anomaly-${anomaly.id}" \\\n` +
    `  --resource-group "${anomaly.rootCauses[0]?.resourceGroup || "cscs-finops-mgmt-eastus2-rg"}" \\\n` +
    `  --scopes "${anomaly.rootCauses[0]?.resourceId || "/subscriptions/sub-id/..."}" \\\n` +
    `  --condition "total ResponseLatency > 1000" --window-size 5m --evaluation-frequency 1m`;

  const handleCopy = () => {
    navigator.clipboard.writeText(cliExample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end backdrop-blur-xs animate-fadeIn">
      <div className="relative z-[100] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 w-full max-w-xl h-full p-6 shadow-2xl overflow-y-auto space-y-5 animate-slideInRight">
        {/* Header Drawer */}
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
                {t('drawerTitle')}
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('detectedOn')} {anomaly.detectionDate} · {t('deviation')}: <span className="font-bold text-rose-600">+{money(anomaly.deltaUSD)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer shadow-xs transition"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        {/* Resumen del Pico */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
            <span className="block text-[11px] font-medium text-slate-500">{t('actualDailySpend')}</span>
            <span className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">{money(anomaly.actualCostUSD)}</span>
          </div>
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
            <span className="block text-[11px] font-medium text-slate-500">{t('expectedBaseline')}</span>
            <span className="text-lg font-extrabold text-[#0054A6]">{money(anomaly.expectedCostUSD)}</span>
          </div>
        </div>

        {/* Lista de Contribuyentes Detallada */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('breakdownByService')}
          </h4>
          <div className="space-y-2.5">
            {anomaly.rootCauses.map((rc, idx) => (
              <div
                key={`${rc.serviceName}-${idx}`}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 shadow-xs"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 block">
                      {rc.serviceName}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {rc.resourceGroup}
                    </span>
                  </div>
                  <span className="text-xs font-extrabold text-rose-600 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-900/50">
                    +{money(rc.deltaSpendUSD)} ({rc.contributionPercentage}%)
                  </span>
                </div>

                {/* Barra de contribución */}
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[#0078D4] h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, rc.contributionPercentage)}%` }}
                  />
                </div>

                {rc.resourceId && (
                  <div className="pt-1 text-[10px] text-slate-400 font-mono truncate" title={rc.resourceId}>
                    ID: {rc.resourceId}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Telemetría y Cuotas */}
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-slate-800/40 space-y-2">
          <h4 className="text-xs font-bold text-[#0054A6] dark:text-blue-300 flex items-center gap-1.5">
            <IconAdjustments className="w-4 h-4 text-[#0078D4]" />
            {t('governanceActions')}
          </h4>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {t('governanceHint')}
          </p>
        </div>

        {/* Azure CLI Snippet */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#1B2A41] dark:text-slate-200 flex items-center gap-1.5">
              <IconTerminal2 className="w-4 h-4 text-[#0078D4]" />
              {t('cliLabel')}
            </span>
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition flex items-center gap-1 cursor-pointer shadow-xs"
            >
              {copied ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
              <span>{copied ? t('copied') : t('copy')}</span>
            </button>
          </div>
          <pre className="p-3 text-[11px] font-mono rounded-xl bg-slate-900 text-slate-100 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-slate-800">
            {cliExample}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer shadow-xs"
          >
            {t('closePanel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function AnomalyDetectionPanel() {
  const t = useTranslations("AnomalyPanel");
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const isMock = useMemo(
    () =>
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-"),
    [tenantId, searchParams]
  );

  const fetcher = useMemo(
    () => buildFetcher(instance, accounts, isMock, t("loadError")),
    [instance, accounts, isMock, t]
  );
  const apiUrl = `/api/analytics/anomalies?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<AnomalyPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [activeTab, setActiveTab] = useState<AnomalyState | "ALL">("OPEN");
  const [selectedAnomalyForDrawer, setSelectedAnomalyForDrawer] = useState<CostAnomalyItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const summary = data?.summary;
  const rawAnomalies = useMemo(() => summary?.anomalies || [], [summary]);

  const [localOverrides, setLocalOverrides] = useState<Record<string, { state: AnomalyState; notes?: string }>>({});

  const anomalies = useMemo(() => {
    return rawAnomalies.map((a) => {
      const override = localOverrides[a.id];
      if (override) {
        return { ...a, state: override.state, resolutionNotes: override.notes || a.resolutionNotes };
      }
      return a;
    });
  }, [rawAnomalies, localOverrides]);

  const counts = useMemo(() => {
    const res: Record<AnomalyState, number> = { OPEN: 0, SNOOZED: 0, DISMISSED: 0, RESOLVED: 0 };
    anomalies.forEach((a) => {
      if (res[a.state] !== undefined) res[a.state]++;
    });
    return res;
  }, [anomalies]);

  const filtered = useMemo(() => {
    return anomalies.filter((a) => {
      if (activeTab !== "ALL" && a.state !== activeTab) return false;
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchesTitle = a.title.toLowerCase().includes(query);
        const matchesService = a.rootCauses.some((rc) => rc.serviceName.toLowerCase().includes(query));
        if (!matchesTitle && !matchesService) return false;
      }
      return true;
    });
  }, [anomalies, activeTab, searchTerm]);

  const { paged, page, totalPages, pageSize, setPage, setPageSize, total } = usePagination(filtered, 15);

  const handleStateUpdate = async (anomalyId: string, action: "RESOLVE" | "SNOOZE" | "DISMISS" | "REOPEN") => {
    const nextState: AnomalyState =
      action === "RESOLVE" ? "RESOLVED" : action === "SNOOZE" ? "SNOOZED" : action === "DISMISS" ? "DISMISSED" : "OPEN";

    setLocalOverrides((prev) => ({ ...prev, [anomalyId]: { state: nextState } }));

    if (!isMock) {
      try {
        await fetch("/api/analytics/anomalies", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId, anomalyId, action }),
        });
      } catch (e) {
        console.warn("[AnomalyDetectionPanel] PATCH failed:", e);
      }
    }
  };

  const handleExportCSV = () => {
    if (anomalies.length === 0) return;
    const headers = ["ID", t('csvDate'), t('csvActual'), t('csvExpected'), t('csvDelta'), "Z-Score", t('csvSeverity'), t('csvState'), t('csvTopService')];
    const rows = anomalies.map((a) => [
      a.id,
      a.detectionDate,
      a.actualCostUSD.toFixed(2),
      a.expectedCostUSD.toFixed(2),
      a.deltaUSD.toFixed(2),
      a.zScore.toFixed(2),
      a.severity,
      a.state,
      `"${a.rootCauses[0]?.serviceName || "N/A"}"`,
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `finops-anomalies-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const confidenceTrend = summary?.confidenceTrend || [];
  const mean = summary?.baselineMovingAvgUSD || 0;
  const upperLimit = summary?.alertThresholdUSD || 0;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      return (
        <div className="bg-[#1B2A41] text-white p-3 rounded-xl shadow-2xl border border-slate-700 text-xs space-y-1 z-[9999]">
          <p className="font-bold text-slate-200">{label}</p>
          <p className="font-mono text-emerald-400">{t('ttActual')}: {money(dataPoint.actualCostUSD)}</p>
          <p className="font-mono text-sky-300">{t('ttExpected')}: {money(dataPoint.expectedCostUSD)}</p>
          <p className="font-mono text-rose-400">{t('ttLimit')}: {money(dataPoint.upperLimit3SigmaUSD)}</p>
          {dataPoint.isAnomaly && (
            <p className="font-bold text-amber-400 pt-1 border-t border-slate-700">
              ⚠️ {t('ttAnomaly')} (Z: {dataPoint.zScore})
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconAlertCircle className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t('title')}</span>
              <InfoTooltip
                content={t('titleTip')}
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Cost Management" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconDatabaseExport className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            <span>{t('exportCsv')}</span>
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
            <span>{t('refresh')}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── 4 KPI Cards Superiores ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: t('kpiOpenLabel'),
            tip: t('kpiOpenTip'),
            value: String(counts.OPEN),
            sub: `${counts.OPEN > 0 ? t('kpiOpenSubWarn') : t('kpiOpenSubOk')}`,
            Icon: IconAlertCircle,
            warn: counts.OPEN > 0,
          },
          {
            label: t('kpiImpactLabel'),
            tip: t('kpiImpactTip'),
            value: money(summary?.unresolvedImpactUSD || 0),
            sub: t('kpiImpactSub'),
            Icon: IconReceipt2,
            warn: (summary?.unresolvedImpactUSD || 0) > 0,
          },
          {
            label: t('kpiResolvedLabel'),
            tip: t('kpiResolvedTip'),
            value: String(counts.RESOLVED),
            sub: t('kpiResolvedSub'),
            Icon: IconCircleCheck,
          },
          {
            label: t('kpiMttrLabel'),
            tip: t('kpiMttrTip'),
            value: summary?.meanTimeToResolutionHours !== undefined ? formatHours(summary.meanTimeToResolutionHours) : "18.0h",
            sub: t('kpiMttrSub'),
            Icon: IconClockCheck,
          },
        ].map((c) => (
          <div
            key={c.label}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between"
          >
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span>{c.label}</span>
                <InfoTooltip content={c.tip} />
              </div>
              <div
                className={`text-2xl font-extrabold truncate ${
                  c.warn ? "text-amber-600 dark:text-amber-400" : "text-[#1B2A41] dark:text-slate-100"
                }`}
                title={c.value}
              >
                {c.value}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{c.sub}</div>
            </div>
            <c.Icon className="w-8 h-8 text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Fila 1: Parámetros Estadísticos & Gráfica Banda de Confianza ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda (3 Tarjetas) */}
        <div className="col-span-1 space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center gap-2 mb-1">
              <IconActivity className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('baselineLabel')}</h3>
            </div>
            <p className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">{money(mean)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{t('baselineSub')}</p>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center gap-2 mb-1">
              <IconTrendingUp className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('toleranceLabel')}</h3>
            </div>
            <p className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">±{money(summary?.zScoreToleranceUSD || 0)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{t('alertThreshold')}: <span className="font-bold text-[#0054A6]">{money(upperLimit)}</span></p>
          </div>

          {counts.OPEN > 0 ? (
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-900/60 shadow-xs">
              <div className="flex items-center gap-2 mb-1">
                <IconAlertTriangle className="w-5 h-5 text-rose-600" stroke={1.5} />
                <h3 className="text-xs font-bold text-rose-700 dark:text-rose-400">{t('activeAnomaly')}</h3>
              </div>
              <p className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">
                {money(anomalies.find((a) => a.state === "OPEN")?.actualCostUSD || 113.61)}
              </p>
              <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 font-medium">
                Z-Score: {(anomalies.find((a) => a.state === "OPEN")?.zScore || 3.32).toFixed(2)} ({t('criticalDeviation')})
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-900/60 shadow-xs">
              <div className="flex items-center gap-2 mb-1">
                <IconCheck className="w-5 h-5 text-emerald-600" stroke={1.5} />
                <h3 className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{t('normalBehavior')}</h3>
              </div>
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                {t('noActiveSpikes')}
              </p>
            </div>
          )}
        </div>

        {/* Columna Derecha (Gráfica Banda de Confianza) */}
        <div className="col-span-1 lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              <span>{t('chartTitle')}</span>
              <InfoTooltip content={t('chartTip')} />
            </h3>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1 text-slate-500">
                <span className="w-3 h-0.5 bg-[#0078D4] inline-block" /> {t('legendActual')}
              </span>
              <span className="flex items-center gap-1 text-slate-500">
                <span className="w-3 h-0.5 bg-[#2563EB] border-b border-dashed border-[#2563EB] inline-block" /> {t('legendLimit')}
              </span>
            </div>
          </div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={confidenceTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94A3B8" opacity={0.2} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#64748B" }}
                  tickFormatter={(val) => val.split("-").slice(1).join("/")}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748B" }}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip content={<CustomTooltip />} />

                {/* Banda de Confianza */}
                <ReferenceArea
                  y1={Math.max(0, mean - (summary?.zScoreToleranceUSD || 0))}
                  y2={upperLimit}
                  fill="#0054A6"
                  fillOpacity={0.05}
                />
                <ReferenceLine
                  y={upperLimit}
                  stroke="#2563EB"
                  strokeDasharray="3 3"
                  label={{ position: "top", value: `3σ: ${money(upperLimit)}`, fill: "#2563EB", fontSize: 10 }}
                />

                <Line
                  type="monotone"
                  dataKey="actualCostUSD"
                  stroke="#0078D4"
                  strokeWidth={2.5}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    if (payload.isAnomaly) {
                      return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={6} fill="#0078D4" stroke="#ffffff" strokeWidth={2} />;
                    }
                    return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={0} />;
                  }}
                  activeDot={{ r: 6, fill: "#0078D4", stroke: "#ffffff", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── Fila 2: Filtros & Pestañas de Gestión ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        {/* Pestañas de Estado */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "OPEN", label: t('tabOpen'), count: counts.OPEN },
            { key: "SNOOZED", label: t('tabSnoozed'), count: counts.SNOOZED },
            { key: "DISMISSED", label: t('tabDismissed'), count: counts.DISMISSED },
            { key: "RESOLVED", label: t('tabResolved'), count: counts.RESOLVED },
            { key: "ALL", label: t('tabAll'), count: anomalies.length },
          ].map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                  isActive
                    ? "border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-300 ring-1 ring-[#0054A6]"
                    : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-md font-bold ${
                    isActive ? "bg-blue-50 text-[#0054A6]" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Buscador */}
        <div className="relative min-w-[220px]">
          <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          />
        </div>
      </div>

      {/* ─── Fila 3: Tarjetas de Anomalías ─── */}
      <div className={`space-y-4 ${VISIBLE_SCROLLBAR}`}>
        {paged.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
            <IconCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" stroke={1.5} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('emptyState')}
            </p>
          </div>
        ) : (
          paged.map((anomaly: CostAnomalyItem) => (
            <div
              key={anomaly.id}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4"
            >
              {/* Header de la tarjeta */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-lg uppercase tracking-wider border ${
                      anomaly.state === "OPEN"
                        ? "border-rose-300 dark:border-rose-800 text-rose-600 bg-rose-50/50 dark:bg-rose-950/30"
                        : anomaly.state === "SNOOZED"
                          ? "border-amber-300 dark:border-amber-800 text-amber-600 bg-amber-50/50 dark:bg-amber-950/30"
                          : anomaly.state === "DISMISSED"
                            ? "border-slate-300 dark:border-slate-700 text-slate-500 bg-slate-50"
                            : "border-emerald-300 dark:border-emerald-800 text-emerald-600 bg-emerald-50/50"
                    }`}
                  >
                    {t(`state.${anomaly.state}`)}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    {t('csvDate')}: <span className="font-mono text-[#1B2A41] dark:text-slate-200">{anomaly.detectionDate}</span>
                  </span>
                  <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">
                    {anomaly.title}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">Z-Score:</span>
                  <span className="text-xs font-extrabold text-[#0054A6] bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-900">
                    {anomaly.zScore.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Grid Central: Desglose Causal vs Impacto */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
                {/* Desglose causal (2 columnas) */}
                <div className="lg:col-span-2 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {t('whatCaused')}
                  </p>
                  <div className="space-y-1.5">
                    {anomaly.rootCauses.map((rc, idx) => (
                      <div
                        key={`${rc.serviceName}-${idx}`}
                        className="flex items-center justify-between text-xs p-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`font-bold px-1.5 py-0.5 rounded-md text-[10px] ${
                              idx === 0
                                ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400"
                                : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            {rc.contributionPercentage}%
                          </span>
                          <span className="text-slate-700 dark:text-slate-300 truncate font-semibold">
                            {rc.serviceName}
                          </span>
                          <span className="text-slate-400 font-mono text-[10px] truncate">
                            {t('inGroup')} {rc.resourceGroup}
                          </span>
                        </div>
                        <span className="font-extrabold text-rose-600 dark:text-rose-400 shrink-0 ml-2">
                          +{money(rc.deltaSpendUSD)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Panel Derecho: Costo vs Esperado */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-right">
                  <div>
                    <span className="text-[11px] text-slate-400 block">{t('actualDailySpend')}:</span>
                    <span className="text-xl font-extrabold text-rose-600 dark:text-rose-400">
                      {money(anomaly.actualCostUSD)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">{t('expectedBase')}</span>
                    <span className="text-sm font-semibold text-[#0054A6]">
                      {money(anomaly.expectedCostUSD)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-bold text-rose-600 block">
                      {t('netDeviation')}: +{money(anomaly.deltaUSD)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Botones de Acción Corporativos */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => setSelectedAnomalyForDrawer(anomaly)}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                  <span>{t('viewRootCause')}</span>
                </button>

                <div className="flex items-center gap-2 flex-wrap">
                  {anomaly.state === "OPEN" && (
                    <>
                      <button
                        onClick={() => handleStateUpdate(anomaly.id, "SNOOZE")}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-400 text-amber-700 dark:text-amber-400 bg-white dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <IconClock className="w-3.5 h-3.5" />
                        <span>{t('snooze')}</span>
                      </button>
                      <button
                        onClick={() => handleStateUpdate(anomaly.id, "DISMISS")}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                      >
                        {t('dismiss')}
                      </button>
                      <button
                        onClick={() => handleStateUpdate(anomaly.id, "RESOLVE")}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <IconCheck className="w-3.5 h-3.5 text-[#0078D4]" />
                        <span>{t('markResolved')}</span>
                      </button>
                    </>
                  )}

                  {anomaly.state === "SNOOZED" && (
                    <>
                      <button
                        onClick={() => handleStateUpdate(anomaly.id, "REOPEN")}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                      >
                        {t('reopen')}
                      </button>
                      <button
                        onClick={() => handleStateUpdate(anomaly.id, "RESOLVE")}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <IconCheck className="w-3.5 h-3.5 text-[#0078D4]" />
                        <span>{t('markResolved')}</span>
                      </button>
                    </>
                  )}

                  {(anomaly.state === "RESOLVED" || anomaly.state === "DISMISSED") && (
                    <button
                      onClick={() => handleStateUpdate(anomaly.id, "REOPEN")}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                    >
                      {t('reopenAnomaly')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Paginación */}
      <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <Pagination page={page} totalPages={totalPages} pageSize={pageSize} total={total} setPage={setPage} setPageSize={setPageSize} pageSizes={[15, 30, 45, 60]} />
      </div>

      {/* Drawer Lateral de Causa Raíz */}
      <RootCauseDrawer
        anomaly={selectedAnomalyForDrawer}
        onClose={() => setSelectedAnomalyForDrawer(null)}
      />
    </div>
  );
}

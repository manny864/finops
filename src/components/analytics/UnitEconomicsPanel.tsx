"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconChartDots,
  IconScale,
  IconCash,
  IconUsersGroup,
  IconTrendingDown,
  IconTrendingUp,
  IconRotateClockwise,
  IconSettings,
  IconDatabaseExport,
  IconTerminal2,
  IconX,
  IconCheck,
  IconCopy,
  IconAlertTriangle,
  IconInfoCircle,
  IconServer,
  IconDatabase,
  IconBox,
  IconNetwork,
  IconSparkles,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  UNIT_METRIC_CATALOG,
  UE_COLORS,
  type ServiceUnitCostItem,
  type UnitEconomicsPayload,
  type UnitEconomicsRemediationAction,
  type UnitMetricType,
} from "@/types/azureUnitEconomics.types";

/** Scrollbar horizontal siempre visible: en macOS los overlay desaparecen. */
const VISIBLE_SCROLLBAR =
  "overflow-x-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.slate.300)_theme(colors.slate.100)] " +
  "dark:[scrollbar-color:theme(colors.slate.600)_theme(colors.slate.800)] " +
  "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full " +
  "[&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 " +
  "[&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string; stroke?: number }>> = {
  "Cómputo": IconServer,
  "Base de Datos": IconDatabase,
  "Almacenamiento": IconBox,
  "Redes": IconNetwork,
  "IA": IconSparkles,
  "Otros": IconBox,
};

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

/**
 * Formatea un costo unitario. Puede ser del orden de 0.00001 USD (por token o
 * por llamada API), así que la escala decimal se adapta al valor en vez de
 * redondear a dos decimales y mostrar $0.00.
 */
const unitMoney = (v: number) => {
  if (v === 0) return "$0.00";
  const digits = v < 0.001 ? 8 : v < 0.01 ? 6 : v < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
};

const compact = (v: number) => new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(v);

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
      throw new Error(err.error || "Error");
    }
    return res.json();
  };
}

// ─── Drawer de Configuración (z-50) ───
function MetricConfigDrawer({
  open,
  payload,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  payload: UnitEconomicsPayload | undefined;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const t = useTranslations("UnitEconomics");
  const cfg = payload?.config;
  const [metric, setMetric] = useState<UnitMetricType>(cfg?.primaryMetric || "DAU");
  const [target, setTarget] = useState(String(cfg?.targetCostPerUnitUSD ?? 0));
  const [threshold, setThreshold] = useState(String(cfg?.alertThresholdPercentage ?? 15));
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualUnits, setManualUnits] = useState("");
  const [lastCfg, setLastCfg] = useState<string | null>(null);

  // Sincroniza el formulario cuando llega o cambia la configuración del backend,
  // sin pisar lo que el usuario esté tipeando en esta sesión del drawer.
  const cfgKey = cfg ? `${cfg.primaryMetric}|${cfg.targetCostPerUnitUSD}|${cfg.alertThresholdPercentage}` : null;
  if (cfgKey && cfgKey !== lastCfg) {
    setLastCfg(cfgKey);
    setMetric(cfg!.primaryMetric);
    setTarget(String(cfg!.targetCostPerUnitUSD));
    setThreshold(String(cfg!.alertThresholdPercentage));
  }

  if (!open) return null;

  const curlExample = `curl -X POST "${typeof window !== "undefined" ? window.location.origin : ""}/api/unit-metrics/ingest" \\
  -H "x-api-key: pak_<tu-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '[{"metricDate":"${manualDate}","metricType":"${metric}","unitCount":1234}]'`;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-5 flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
            <IconSettings className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            {t("config_title")}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
            aria-label={t("cancel")}
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-1.5">
              {t("config_metric_label")}
            </label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as UnitMetricType)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              {(Object.keys(UNIT_METRIC_CATALOG) as UnitMetricType[]).map((m) => (
                <option key={m} value={m}>
                  {UNIT_METRIC_CATALOG[m].displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-1.5">
                {t("config_target_label")}
              </label>
              <input
                type="number"
                step="0.000001"
                min="0"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                {t("config_target_hint", { unit: UNIT_METRIC_CATALOG[metric].unitSingular })}
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-1.5">
                {t("config_threshold_label")}
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="1000"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
              <p className="text-[10px] text-slate-400 mt-1">{t("config_threshold_hint")}</p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
              {t("config_manual_title")}
              <InfoTooltip content={t("config_manual_tooltip")} />
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
              <input
                type="number"
                min="0"
                placeholder={t("config_units_placeholder")}
                value={manualUnits}
                onChange={(e) => setManualUnits(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
              {t("config_webhook_title")}
              <InfoTooltip content={t("config_webhook_tooltip")} />
            </h3>
            <pre className="p-3 bg-slate-950 text-slate-100 rounded-xl font-mono text-[10px] overflow-x-auto border border-slate-800 leading-relaxed whitespace-pre-wrap">
              {curlExample}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(curlExample)}
              className="mt-2 px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 transition flex items-center gap-1 cursor-pointer"
            >
              <IconCopy className="w-3.5 h-3.5" />
              {t("copy")}
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              disabled={saving}
              onClick={() =>
                onSave({
                  primaryMetric: metric,
                  targetCostPerUnitUSD: Number(target) || 0,
                  alertThresholdPercentage: Number(threshold) || 15,
                  ...(manualUnits !== "" ? { metricDate: manualDate, unitCount: Number(manualUnits) } : {}),
                })
              }
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer disabled:opacity-60"
            >
              {saving ? t("saving") : t("save")}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 transition cursor-pointer"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Remediación (z-[100]) ───
function UeRemediationModal({
  action,
  onClose,
}: {
  action: UnitEconomicsRemediationAction | null;
  onClose: () => void;
}) {
  const t = useTranslations("UnitEconomics");
  const [copied, setCopied] = useState(false);
  if (!action) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 relative z-[100] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          aria-label={t("cancel")}
        >
          <IconX className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-4">
          <IconTerminal2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 pr-8">{action.title}</h2>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">{action.description}</p>
        {action.estimatedSavingsUSD > 0 && (
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
            <span className="text-xs text-slate-600 dark:text-slate-400">{t("estimated_saving")}: </span>
            <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
              {money(action.estimatedSavingsUSD)}
            </span>
          </div>
        )}
        {action.commandPayload && (
          <div className="mt-3">
            <button
              onClick={() => {
                navigator.clipboard.writeText(action.commandPayload!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="mb-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              {copied ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
              {copied ? t("copied") : t("copy")}
            </button>
            <pre className="p-3.5 bg-slate-950 text-slate-100 rounded-xl font-mono text-[11px] overflow-x-auto border border-slate-800 whitespace-pre-wrap">
              {action.commandPayload}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function UnitEconomicsPanel() {
  const t = useTranslations("UnitEconomics");
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

  const [windowDays, setWindowDays] = useState(30);
  const [configOpen, setConfigOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeRemediation, setActiveRemediation] = useState<UnitEconomicsRemediationAction | null>(null);

  const apiUrl = `/api/intelligence/unit-economics?tenantId=${encodeURIComponent(tenantId)}&windowDays=${windowDays}`;
  const { data, error, isValidating, mutate } = useSWR<UnitEconomicsPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const summary = data?.summary;
  const services: ServiceUnitCostItem[] = useMemo(() => summary?.servicesBreakdown || [], [summary]);

  const {
    paged: pagedServices,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(services, 15);

  const handleSave = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!isMock && accounts.length > 0) {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      }
      const res = await fetch(`/api/intelligence/unit-economics?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers,
        body: JSON.stringify(patch),
      });
      // fetch no lanza ante 401/403/500: hay que comprobar res.ok o el drawer
      // se cerraría como si el guardado hubiera funcionado.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfigOpen(false);
      await mutate();
    } catch {
      // Se deja el drawer abierto con los valores tipeados para reintentar.
    } finally {
      setSaving(false);
    }
  };

  const handleExportCSV = () => {
    if (!data || !data.series) return;
    const headers = ["Date", "Cloud Cost USD", "Business Units", "Unit Cost USD", "Target Unit Cost USD"];
    const rows = data.series.map((p) => [
      p.date,
      p.cloudCostUSD.toFixed(2),
      p.businessUnitsCount,
      p.unitCostUSD === null ? "" : p.unitCostUSD.toFixed(8),
      p.targetUnitCostUSD?.toFixed(8) ?? "",
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `unit-economics-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const unitLabel = summary?.unitLabel || t("unit_generic");
  const scaleFavorable = summary?.scaleEfficiencyStatus === "Optimal";
  const scaleBad = summary?.scaleEfficiencyStatus === "Critical" || summary?.scaleEfficiencyStatus === "Degrading";

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado, selector de métrica y ventana ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconChartDots className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t("panel_title")}</span>
              <InfoTooltip content={t("panel_tooltip")} position="bottom" align="left" />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? t("badge_live") : t("badge_demo")}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("panel_subtitle")}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-2 text-xs font-semibold rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
            {summary?.metricDisplayName || UNIT_METRIC_CATALOG.DAU.displayName}
          </span>

          <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
            {[30, 90, 365].map((w) => (
              <button
                key={w}
                onClick={() => setWindowDays(w)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  windowDays === w
                    ? "bg-white dark:bg-slate-900 text-[#0054A6] shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {w === 365 ? t("window_12m") : t("window_days", { days: w })}
              </button>
            ))}
          </div>

          <button
            onClick={() => setConfigOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconSettings className="w-4 h-4" />
            {t("configure_cta")}
          </button>
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconDatabaseExport className="w-4 h-4 text-[#0078D4]" />
            {t("export_csv")}
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} />
            {t("refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* Sin denominador de negocio no hay economía unitaria que mostrar. */}
      {data && summary && !summary.hasBusinessData && (
        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 flex items-start gap-2.5">
          <IconInfoCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" stroke={1.5} />
          <div>
            <p className="text-xs font-bold text-[#1B2A41] dark:text-slate-100">{t("no_units_title")}</p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              {t("no_units_desc")}
            </p>
            <button
              onClick={() => setConfigOpen(true)}
              className="mt-2 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] transition cursor-pointer"
            >
              {t("configure_cta")}
            </button>
          </div>
        </div>
      )}

      {/* ─── 4 KPI Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpi_unit_cost")}</span>
              <InfoTooltip content={t("kpi_unit_cost_tooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary?.hasBusinessData ? unitMoney(summary.avgUnitCostUSD) : "—"}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary?.hasBusinessData ? (
                <>
                  {t("per_unit", { unit: unitLabel })}
                  {(summary.targetUnitCostUSD ?? 0) > 0 && (
                    <span
                      className={`block font-semibold ${
                        (summary.unitCostDeltaPercentage ?? 0) > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {(summary.unitCostDeltaPercentage ?? 0) > 0 ? "+" : ""}
                      {(summary.unitCostDeltaPercentage ?? 0).toFixed(1)}% {t("vs_target")}
                    </span>
                  )}
                </>
              ) : (
                t("awaiting_units")
              )}
            </div>
          </div>
          <IconScale className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpi_cloud_spend")}</span>
              <InfoTooltip content={t("kpi_cloud_spend_tooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {money(summary?.totalCloudSpendUSD || 0)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("window_label", { days: windowDays })}
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpi_volume")}</span>
              <InfoTooltip content={t("kpi_volume_tooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {compact(summary?.totalBusinessUnits || 0)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary?.metricDisplayName}
              {summary && summary.daysMissingBusinessData > 0 && (
                <span className="block text-amber-600 dark:text-amber-400 font-semibold">
                  {t("days_missing", { days: summary.daysMissingBusinessData })}
                </span>
              )}
            </div>
          </div>
          <IconUsersGroup className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpi_scale")}</span>
              <InfoTooltip content={t("kpi_scale_tooltip")} />
            </div>
            <div
              className={`text-lg font-extrabold ${
                scaleFavorable
                  ? "text-emerald-600 dark:text-emerald-400"
                  : scaleBad
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-[#1B2A41] dark:text-slate-100"
              }`}
            >
              {summary ? t(`scale_${summary.scaleEfficiencyStatus.toLowerCase()}`) : "—"}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary && summary.scaleEfficiencyStatus !== "Unknown"
                ? t("scale_detail", {
                    unitCost: (summary.unitCostChangePercentage ?? 0).toFixed(1),
                    volume: (summary.volumeChangePercentage ?? 0).toFixed(1),
                  })
                : t("scale_insufficient")}
            </div>
          </div>
          {scaleFavorable ? (
            <IconTrendingDown className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
          ) : (
            <IconTrendingUp className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
          )}
        </div>
      </div>

      {/* ─── Fila 1: Gráfica de doble eje ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-1 flex items-center gap-1.5">
          {t("chart_dual_title")}
          <InfoTooltip content={t("chart_dual_tooltip")} />
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
          {t("chart_dual_desc", { unit: unitLabel })}
        </p>
        {!data?.series || data.series.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center text-xs text-slate-400">{t("no_data")}</div>
        ) : (
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.series} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => v.slice(5).replace("-", "/")}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                {/* Eje izquierdo: gasto nube diario en USD. */}
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => `$${compact(v)}`}
                />
                {/* Eje derecho: costo unitario en USD.
                    El tablero anterior formateaba este eje con "¢" mientras
                    graficaba un valor en dólares — un error de factor 100 que
                    mostraba $0.23 como "0.23¢". Ambos van en USD. */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(v: number) => unitMoney(Number(v))}
                />
                <RechartsTooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0", fontSize: 12 }}
                  labelFormatter={(label) => String(label)}
                  formatter={(value, name) => {
                    if (value === null || value === undefined) return [t("no_units_short"), String(name)];
                    if (name === t("series_unit_cost", { unit: unitLabel })) {
                      return [unitMoney(Number(value)), String(name)];
                    }
                    return [money(Number(value)), String(name)];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                <Bar
                  yAxisId="left"
                  dataKey="cloudCostUSD"
                  name={t("series_cloud_cost")}
                  fill={UE_COLORS.cloudSpendBars}
                  radius={[4, 4, 0, 0]}
                />
                {summary && summary.targetUnitCostUSD > 0 && (
                  <ReferenceLine
                    yAxisId="right"
                    y={summary.targetUnitCostUSD}
                    stroke={UE_COLORS.targetLine}
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    label={{
                      value: t("target_label", { value: unitMoney(summary.targetUnitCostUSD) }),
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: UE_COLORS.targetLine,
                    }}
                  />
                )}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="unitCostUSD"
                  name={t("series_unit_cost", { unit: unitLabel })}
                  stroke={UE_COLORS.unitCostLine}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: UE_COLORS.unitCostLine, strokeWidth: 2, stroke: "#fff" }}
                  activeDot={{ r: 6 }}
                  /* Los días sin volumen quedan como hueco en la línea, no como
                     cero: un cero se leería como eficiencia perfecta. */
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ─── Fila 2: Desglose por servicio ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{t("table_title")}</h3>
          <InfoTooltip content={t("table_tooltip")} />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">
            {t("services_count", { count: total })}
          </span>
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-semibold min-w-[200px]">{t("col_service")}</th>
                <th className="px-3 py-2 font-semibold min-w-[140px]">{t("col_category")}</th>
                <th className="px-3 py-2 font-semibold min-w-[130px]">{t("col_spend")}</th>
                <th className="px-3 py-2 font-semibold min-w-[130px]">{t("col_share")}</th>
                <th className="px-3 py-2 font-semibold min-w-[160px]">{t("col_unit_contribution")}</th>
                <th className="px-3 py-2 font-semibold min-w-[160px]">{t("col_elasticity")}</th>
                <th className="px-3 py-2 font-semibold min-w-[180px]">{t("col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pagedServices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    <IconChartDots className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
                    <p className="text-xs font-medium">{t("no_services")}</p>
                  </td>
                </tr>
              ) : (
                pagedServices.map((s: ServiceUnitCostItem) => {
                  const Icon = CATEGORY_ICONS[s.serviceCategory] || IconBox;
                  return (
                    <tr key={s.serviceName} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <Icon className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                          <span
                            className="font-semibold text-[#1B2A41] dark:text-slate-100 min-w-[120px] max-w-[240px] truncate block"
                            title={s.serviceName}
                          >
                            {s.serviceName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{s.serviceCategory}</td>
                      <td className="px-3 py-2.5 font-bold text-[#1B2A41] dark:text-slate-100 whitespace-nowrap">
                        {money(s.monthlySpendUSD)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#0078D4]"
                              style={{ width: `${Math.min(100, s.spendPercentage)}%` }}
                            />
                          </div>
                          <span className="text-slate-600 dark:text-slate-400">{s.spendPercentage}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {summary?.hasBusinessData ? (
                          <>
                            {unitMoney(s.unitCostContributionUSD)}
                            <span className="block text-[10px] text-slate-400">
                              {t("per_unit", { unit: unitLabel })}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${
                            s.elasticityModel === "Elastic"
                              ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                              : s.elasticityModel === "Semi-Elastic"
                                ? "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300"
                                : "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                          }`}
                        >
                          {t(`elasticity_${s.elasticityModel.toLowerCase().replace("-", "_")}`)}
                        </span>
                        {s.volumeCorrelation !== 0 && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {t("correlation", { value: s.volumeCorrelation.toFixed(2) })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {s.elasticityModel === "Fixed" ? (
                          <button
                            onClick={() =>
                              setActiveRemediation({
                                id: `manual-elastic-${s.serviceName}`,
                                targetId: s.serviceName,
                                targetName: s.serviceName,
                                title: t("action_optimize_title", { service: s.serviceName }),
                                description: t("action_optimize_desc", {
                                  correlation: s.volumeCorrelation.toFixed(2),
                                  unit: unitLabel,
                                }),
                                category: "CONVERT_FIXED_TO_ELASTIC",
                                estimatedSavingsUSD: 0,
                                confidence: "MEDIUM",
                                actionType: "MIGRATE_TO_ELASTIC",
                              })
                            }
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] bg-white dark:bg-slate-900 text-[#00AEEF] hover:bg-sky-50/50 dark:hover:bg-sky-950/40 transition cursor-pointer whitespace-nowrap"
                          >
                            {t("action_optimize")}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">{t("no_action_needed")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
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
        <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
          {t("recommendations_title")}
          <InfoTooltip content={t("recommendations_tooltip")} />
        </h3>
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
                        +{money(action.estimatedSavingsUSD)}/{t("month_short")}
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">
                    {action.title}
                  </h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-4 leading-relaxed">
                    {action.description}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-medium">
                    {t("confidence")}: {action.confidence}
                  </span>
                  <button
                    onClick={() =>
                      action.category === "SET_TARGET_COST" ? setConfigOpen(true) : setActiveRemediation(action)
                    }
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1 cursor-pointer"
                  >
                    <IconTerminal2 className="w-3.5 h-3.5" />
                    {action.category === "SET_TARGET_COST" ? t("configure_cta") : t("view_detail")}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              {t("no_recommendations")}
            </div>
          )}
        </div>
      </div>

      {/* ─── Capas superpuestas ─── */}
      <MetricConfigDrawer
        open={configOpen}
        payload={data}
        onClose={() => setConfigOpen(false)}
        onSave={handleSave}
        saving={saving}
      />
      <UeRemediationModal action={activeRemediation} onClose={() => setActiveRemediation(null)} />
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconBolt,
  IconCheck,
  IconCircleCheck,
  IconClockHour4,
  IconCloud,
  IconCoin,
  IconCopy,
  IconCpu,
  IconDatabase,
  IconGauge,
  IconLayersLinked,
  IconRefresh,
  IconServer,
  IconShieldCheck,
  IconShieldExclamation,
  IconSparkles,
  IconTarget,
  IconTerminal2,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
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
  MongoDbResourceDetail,
  MongoDbFinopsSummaryResponse,
} from "@/types/azureMongoDb";
import { toast } from "sonner";

const FILTER_ALL = "__all__";
type SortMode = "cost-desc" | "cost-asc" | "name-asc" | "name-desc";

// ─── Badges ──────────────────────────────────────────────────────────────────
function ArchitectureBadge({ arch }: { arch: string }) {
  if (arch === "vCore") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
        <IconServer size={11} stroke={2} />
        MongoDB vCore
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400">
      <IconLayersLinked size={11} stroke={2} />
      Cosmos DB RU/s
    </span>
  );
}

function StateBadge({ state }: { state: string }) {
  if (state === "Ready" || state === "healthy") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400">
        <IconCircleCheck size={11} stroke={2} />
        Saludable
      </span>
    );
  }
  if (state === "warning" || state === "Updating") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400">
        <IconAlertTriangle size={11} stroke={2} />
        {state === "Updating" ? "Actualizando" : "Advertencia"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400">
      <IconShieldExclamation size={11} stroke={2} />
      Crítico
    </span>
  );
}

// ─── KPI Card (Fondo blanco puro según directiva) ───────────────────────────
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  iconColorClass = "text-[#0054A6]",
  tooltip,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  iconColorClass?: string;
  tooltip?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-sm flex flex-col justify-between transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate max-w-[85%]">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <Icon size={18} stroke={1.5} className={iconColorClass} />
          {tooltip && <InfoTooltip content={tooltip} />}
        </div>
      </div>
      <div className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-[Montserrat,sans-serif] leading-tight">
        {value}
      </div>
      {sub && (
        <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate">
          {sub}
        </span>
      )}
    </div>
  );
}

// ─── Modal Interactivo de Remediación y Optimización ─────────────────────────
function OptimizationModal({
  server,
  onClose,
  format,
}: {
  server: MongoDbResourceDetail;
  onClose: () => void;
  format: (v: number) => string;
}) {
  const [activeRecIdx, setActiveRecIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<"cli" | "bicep">("cli");
  const [copied, setCopied] = useState(false);

  const hasRecs = server.recommendations && server.recommendations.length > 0;
  const currentRec = hasRecs ? server.recommendations[activeRecIdx] || server.recommendations[0] : null;

  const fallbackCli = server.architecture === "vCore"
    ? `# Diagnóstico y configuración recomendada para MongoDB vCore: ${server.name}
az cosmosdb mongocluster update \\
  --cluster-name "${server.name}" \\
  --resource-group "${server.resourceGroup}"`
    : `# Diagnóstico y configuración recomendada para Cosmos DB MongoDB RU: ${server.name}
az cosmosdb mongodb database throughput show \\
  --account-name "${server.name}" \\
  --resource-group "${server.resourceGroup}" \\
  --name "maindb"`;

  const fallbackBicep = `// Template Bicep de referencia para ${server.name}
resource mongoResource 'Microsoft.DocumentDB/${server.architecture === "vCore" ? "mongoClusters" : "databaseAccounts"}@2024-03-01-preview' = {
  name: '${server.name}'
  location: '${server.region}'
}`;

  const code = currentRec
    ? activeTab === "cli" ? currentRec.cliCommand : currentRec.bicepSnippet
    : activeTab === "cli" ? fallbackCli : fallbackBicep;

  async function handleCopy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Código copiado al portapapeles");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  }

  const riskColor: Record<string, string> = {
    low: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400",
    medium: "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400",
    high: "text-red-700 bg-red-50 border-red-200 dark:bg-red-950/30 dark:text-red-400",
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40">
              <IconSparkles size={22} stroke={1.5} className="text-[#0054A6]" />
            </div>
            <div>
              <h3 className="font-bold text-[#1B2A41] dark:text-slate-100 text-base font-[Montserrat,sans-serif]">
                Optimización y Remediación para MongoDB en Azure
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Recurso: <span className="font-semibold text-slate-800 dark:text-slate-200">{server.name}</span> ({server.architecture === "vCore" ? `vCore ${server.vcoreProfile?.skuName}` : `RU-based (${server.ruProfile?.throughputMode})`})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <IconX size={16} stroke={2} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {hasRecs ? (
            <>
              {server.recommendations.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1 border-b border-slate-100 dark:border-slate-800">
                  {server.recommendations.map((r, idx) => (
                    <button
                      key={r.id}
                      onClick={() => { setActiveRecIdx(idx); setCopied(false); }}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shrink-0 ${
                        activeRecIdx === idx
                          ? "bg-white dark:bg-slate-900 border-2 border-[#0054A6] text-[#0054A6] shadow-sm"
                          : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {r.title}
                    </button>
                  ))}
                </div>
              )}

              {currentRec && (
                <div className="p-4 bg-blue-50/40 dark:bg-slate-800/40 rounded-xl border border-blue-100 dark:border-slate-700 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                      <IconBolt size={18} stroke={1.5} className="text-[#0054A6]" />
                      {currentRec.title}
                    </h4>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {currentRec.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
                    {currentRec.savingsMonthlyUsd > 0 && (
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 px-2.5 py-1 rounded-lg">
                        <IconCoin size={14} stroke={1.5} />
                        Ahorro Estimado: +{format(currentRec.savingsMonthlyUsd)}/mes
                      </span>
                    )}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${riskColor[currentRec.risk] || ""}`}>
                      Riesgo: {currentRec.risk === "low" ? "Bajo" : currentRec.risk === "medium" ? "Medio" : "Alto"}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                      Confianza: {currentRec.confidence === "high" ? "Alta" : currentRec.confidence === "medium" ? "Media" : "Baja"}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-4 bg-emerald-50/40 dark:bg-slate-800/40 rounded-xl border border-emerald-100 dark:border-slate-700 space-y-3">
              <div className="flex items-center gap-2">
                <IconShieldCheck size={20} stroke={1.5} className="text-emerald-600 dark:text-emerald-400" />
                <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white">
                  Instancia Óptimamente Configurada
                </h4>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                El recurso <strong className="text-slate-800 dark:text-slate-100">{server.name}</strong> opera con una utilización equilibrada de recursos, sin incidencias de throttling 429 ni redundancia innecesaria.
              </p>
            </div>
          )}

          {/* Script Execution Tabs */}
          <div>
            <div className="flex border-b border-slate-200 dark:border-slate-700 mb-3">
              <button
                onClick={() => setActiveTab("cli")}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-colors border-b-2 -mb-px ${
                  activeTab === "cli"
                    ? "border-[#0054A6] text-[#0054A6]"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                <IconTerminal2 size={14} stroke={2} />
                Azure CLI
              </button>
              <button
                onClick={() => setActiveTab("bicep")}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-colors border-b-2 -mb-px ${
                  activeTab === "bicep"
                    ? "border-[#0054A6] text-[#0054A6]"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                <IconCloud size={14} stroke={2} />
                Bicep / IaC
              </button>
            </div>
            {code && (
              <div className="relative">
                <pre className="bg-slate-950 text-slate-200 rounded-xl p-4 text-xs font-mono overflow-x-auto max-h-60 leading-relaxed whitespace-pre-wrap">
                  {code}
                </pre>
                <button
                  onClick={handleCopy}
                  className={`absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
                    copied
                      ? "border-emerald-500 text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                      : "border-slate-700 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-500"
                  }`}
                >
                  {copied ? <IconCheck size={13} stroke={2} /> : <IconCopy size={13} stroke={2} />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function AzureMongoDbFinopsBoard() {
  const t = useTranslations("AzureMongoDB");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MongoDbFinopsSummaryResponse | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  // Filters
  const [resourceFilter, setResourceFilter] = useState(FILTER_ALL);
  const [regionFilter, setRegionFilter] = useState(FILTER_ALL);
  const [archFilter, setArchFilter] = useState(FILTER_ALL);
  const [resourceGroupFilter, setResourceGroupFilter] = useState(FILTER_ALL);
  const [sortMode, setSortMode] = useState<SortMode>("cost-desc");

  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [modalServer, setModalServer] = useState<MongoDbResourceDetail | null>(null);

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
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`/api/intelligence/databases/mongo-metrics?${params}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: MongoDbFinopsSummaryResponse = await res.json();
        setData(json);
        setLastUpdatedAt(new Date());
        if (json.instances?.length) {
          setSelectedServerId((prev) => prev || json.instances[0].id);
        }
        if (isManualRefresh) toast.success("Datos de MongoDB actualizados");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error desconocido";
        setError(msg);
        if (isManualRefresh) toast.error("Error al actualizar los datos de MongoDB");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedTenant, instance, accounts]
  );

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id]);

  // ── Deduplicate & filter ──────────────────────────────────────────────────
  const items = useMemo<MongoDbResourceDetail[]>(() => {
    if (!data?.instances) return [];
    const seen = new Map<string, MongoDbResourceDetail>();
    for (const s of data.instances) {
      const k = String(s.id || s.name).toLowerCase();
      if (!seen.has(k)) seen.set(k, s);
    }
    return Array.from(seen.values());
  }, [data]);

  const resourceOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...Array.from(new Set(items.map((s) => s.name))).map((n) => ({ value: n, label: n })),
  ], [items, t]);

  const regionOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...Array.from(new Set(items.map((s) => s.region))).map((r) => ({ value: r, label: r })),
  ], [items, t]);

  const archOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    { value: "vCore", label: "MongoDB vCore (Clúster)" },
    { value: "RequestUnits", label: "Cosmos DB RU/s (Throughput)" },
  ], [t]);

  const rgOptions = useMemo<FinopsTableOption[]>(() => [
    { value: FILTER_ALL, label: t("allOption") },
    ...Array.from(new Set(items.map((s) => s.resourceGroup))).map((r) => ({ value: r, label: r })),
  ], [items, t]);

  const sortOptions = useMemo<FinopsTableOption[]>(() => [
    { value: "cost-desc", label: t("sortCostDesc") },
    { value: "cost-asc", label: t("sortCostAsc") },
    { value: "name-asc", label: t("sortAz") },
    { value: "name-desc", label: t("sortZa") },
  ], [t]);

  const filtered = useMemo(() => {
    let list = [...items];
    if (resourceFilter !== FILTER_ALL) list = list.filter((s) => s.name === resourceFilter);
    if (regionFilter !== FILTER_ALL) list = list.filter((s) => s.region === regionFilter);
    if (archFilter !== FILTER_ALL) list = list.filter((s) => s.architecture === archFilter);
    if (resourceGroupFilter !== FILTER_ALL) list = list.filter((s) => s.resourceGroup === resourceGroupFilter);

    list.sort((a, b) => {
      switch (sortMode) {
        case "name-asc": return a.name.localeCompare(b.name);
        case "name-desc": return b.name.localeCompare(a.name);
        case "cost-asc": return a.cost.monthlyCostUsd - b.cost.monthlyCostUsd;
        case "cost-desc": return b.cost.monthlyCostUsd - a.cost.monthlyCostUsd;
        default: return 0;
      }
    });
    return list;
  }, [items, resourceFilter, regionFilter, archFilter, resourceGroupFilter, sortMode]);

  const { page, setPage, pageSize, setPageSize, paged, total, totalPages } = usePagination(filtered, 15);

  const selectedServer = useMemo(
    () => items.find((s) => s.id === selectedServerId) || items[0] || null,
    [items, selectedServerId]
  );

  // ── Loading & Errors ──────────────────────────────────────────────────────
  if (!selectedTenant || selectedTenant.id === "default") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[340px] text-center p-8">
        <IconDatabase size={48} stroke={1} className="text-[#0054A6]/30 mb-4" />
        <p className="text-base font-semibold text-slate-600 dark:text-slate-400">{t("selectTenant")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[340px] text-center p-8 gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-[#0054A6]/20 border-t-[#0054A6] animate-spin" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">{t("loadingTitle")}</p>
        <p className="text-xs text-slate-400">{t("loadingSubtitle")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[340px] text-center p-8 gap-3">
        <IconAlertTriangle size={40} stroke={1.5} className="text-red-500" />
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">{t("load_error")}</p>
        <p className="text-xs text-slate-400">{error}</p>
        <button
          onClick={() => fetchData(true)}
          className="mt-2 px-3 py-1.5 h-8 rounded-lg border border-[#0054A6] text-[#0054A6] text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
        >
          {t("refresh")}
        </button>
      </div>
    );
  }

  const fin = data?.financialSummary || {
    mtdCost: 0,
    forecastEom: { value: 0, low: 0, high: 0 },
    deltaMoM: { value: 0, percentage: 0 },
    potentialSavings: 0,
  };
  const eff = data?.efficiency || {
    vCoreInstancesCount: 0,
    ruInstancesCount: 0,
    costPerVcoreOrKOps: 0,
    underutilizedCount: 0,
    haOverprovisionedCount: 0,
    manualRuCandidateCount: 0,
    riEligibleCount: 0,
  };
  const risk = data?.risk || {
    healthScore: 100,
    criticalAlerts: 0,
    throttling429InstancesCount: 0,
    highCpuPressureCount: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-[Montserrat,sans-serif]">
              {t("moduleTitle")}
            </h2>
            <InfoTooltip content={t("moduleTooltip")} />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("moduleSubtitle")}</p>
          {lastUpdatedAt && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 flex items-center gap-1">
              <IconClockHour4 size={11} stroke={2} />
              {t("updatedAt")}: {lastUpdatedAt.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg border border-[#0054A6] text-[#0054A6] text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50 shrink-0 whitespace-nowrap"
        >
          <IconRefresh size={14} stroke={2} className={refreshing ? "animate-spin text-[#0054A6]" : "text-[#0054A6]"} />
          <span>{refreshing ? t("refreshing") : t("refresh")}</span>
        </button>
      </div>

      {/* 8 Tarjetas KPI Principales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard
          icon={IconWallet}
          label={t("kpiMtdCost")}
          value={format(fin.mtdCost)}
          sub={t("currentBillingCycle")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_mtd")}
        />
        <KpiCard
          icon={IconGauge}
          label={t("kpiForecast")}
          value={format(fin.forecastEom.value)}
          sub={`${format(fin.forecastEom.low)} – ${format(fin.forecastEom.high)}`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_forecast")}
        />
        <KpiCard
          icon={IconTarget}
          label={t("kpiSavings")}
          value={format(fin.potentialSavings)}
          sub={`${data?.recommendations?.length || 0} ${t("actionsDetected")}`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_savings")}
        />
        <KpiCard
          icon={fin.deltaMoM.percentage >= 0 ? IconArrowUpRight : IconArrowDownRight}
          label={t("kpiDeltaMoM")}
          value={`${fin.deltaMoM.percentage >= 0 ? "+" : ""}${fin.deltaMoM.percentage.toFixed(1)}%`}
          sub={format(fin.deltaMoM.value)}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_delta")}
        />
        <KpiCard
          icon={IconDatabase}
          label={t("kpiResources")}
          value={String(items.length)}
          sub={`${eff.vCoreInstancesCount} vCore • ${eff.ruInstancesCount} RU`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_resources")}
        />
        <KpiCard
          icon={IconCpu}
          label={t("kpiEfficiency")}
          value={format(eff.costPerVcoreOrKOps)}
          sub={t("perUnit")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_efficiency")}
        />
        <KpiCard
          icon={IconBolt}
          label={t("kpiUnderutilized")}
          value={String(eff.underutilizedCount)}
          sub={t("candidatesRightsizing")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_underutilized")}
        />
        <KpiCard
          icon={IconActivity}
          label={t("kpiHealth")}
          value={`${risk.healthScore.toFixed(0)}%`}
          sub={`${risk.throttling429InstancesCount} ${t("throttlingEvents")}`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_health")}
        />
      </div>

      {/* Detalle por Recurso (Grid de 3 Columnas Polimórfico) */}
      {selectedServer && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {t("resourceDetailTitle")}:
              </span>
              <span className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                <IconDatabase size={18} stroke={1.5} className="text-[#0054A6]" />
                {selectedServer.name}
              </span>
              <ArchitectureBadge arch={selectedServer.architecture} />
            </div>
            <button
              onClick={() => setModalServer(selectedServer)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
            >
              <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
              <span>{t("inspect")} ({selectedServer.recommendations.length})</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Columna 1: Identidad & Motor */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <IconServer size={16} stroke={1.5} className="text-[#0054A6]" />
                {t("colIdentity")}
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelResource")}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedServer.name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelArchitecture")}:</span>
                  <ArchitectureBadge arch={selectedServer.architecture} />
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelVersion")}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">MongoDB {selectedServer.version}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelSubscription")}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                    {selectedServer.subscriptionName}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("labelResourceGroupRegion")}:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedServer.resourceGroup} ({selectedServer.region})
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">{t("colState")}:</span>
                  <StateBadge state={selectedServer.state} />
                </div>
              </div>
            </div>

            {/* Columna 2: Capacidad & Arquitectura (Polimórfico) */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <IconCpu size={16} stroke={1.5} className="text-[#0054A6]" />
                {t("colCapacityHa")}
              </h4>
              <div className="space-y-2 text-xs">
                {selectedServer.architecture === "vCore" && selectedServer.vcoreProfile ? (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">SKU de Clúster:</span>
                      <code className="text-[11px] font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-bold">
                        {selectedServer.vcoreProfile.skuName}
                      </code>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">vCPUs & Memoria:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedServer.vcoreProfile.vCores} vCores • {selectedServer.vcoreProfile.memoryGib} GB RAM
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Almacenamiento Provisionado:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedServer.vcoreProfile.diskSizeGb} GB ({selectedServer.vcoreProfile.iops} IOPS)
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Alta Disponibilidad (HA):</span>
                      <span className={`font-semibold ${selectedServer.vcoreProfile.haMode !== "Disabled" ? "text-emerald-600" : "text-slate-500"}`}>
                        {selectedServer.vcoreProfile.haMode} ({selectedServer.vcoreProfile.nodeCount} nodos)
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Modo Throughput:</span>
                      <span className="font-semibold text-[#0054A6]">
                        {selectedServer.ruProfile?.throughputMode} ({selectedServer.ruProfile?.provisionedRu} RU/s máx)
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Regiones Replicadas:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedServer.ruProfile?.regionsCount} región(es) ({selectedServer.ruProfile?.regions.join(", ")})
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Cosmos DB Free Tier:</span>
                      <span className={`font-semibold ${selectedServer.ruProfile?.enableFreeTier ? "text-emerald-600" : "text-slate-500"}`}>
                        {selectedServer.ruProfile?.enableFreeTier ? "Habilitado (1000 RU gratis)" : "Inactivo"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Datos vs Índices:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {selectedServer.ruProfile?.dataUsageGb} GB datos / {selectedServer.ruProfile?.indexUsageGb} GB índices
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Columna 3: Métricas, FinOps & Costos (Polimórfico) */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <IconCoin size={16} stroke={1.5} className="text-[#0054A6]" />
                {t("colFinopsMetrics")}
              </h4>
              <div className="space-y-2 text-xs">
                {selectedServer.architecture === "vCore" && selectedServer.metrics.vCoreMetrics ? (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">CPU Avg / Max:</span>
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {selectedServer.metrics.vCoreMetrics.cpuPercentAvg.toFixed(1)}% / {selectedServer.metrics.vCoreMetrics.cpuPercentMax.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Memoria RAM:</span>
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {selectedServer.metrics.vCoreMetrics.memoryPercentAvg.toFixed(1)}% avg
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Espacio en Disco Usado:</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {selectedServer.metrics.vCoreMetrics.diskSpacePercent.toFixed(1)}% ({selectedServer.metrics.vCoreMetrics.iopsConsumedAvg} IOPS)
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">RU Normalizado Avg:</span>
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {selectedServer.metrics.ruMetrics?.normalizedRuPercentAvg.toFixed(1)}% (Pico {selectedServer.metrics.ruMetrics?.normalizedRuPercentMax.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Eventos Throttling (429):</span>
                      <span className={`font-mono font-semibold ${(selectedServer.metrics.ruMetrics?.throttling429Count || 0) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {selectedServer.metrics.ruMetrics?.throttling429Count || 0} req
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Latencia Servidor:</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {selectedServer.metrics.ruMetrics?.serverLatencyMs} ms ({selectedServer.metrics.ruMetrics?.requestCount.toLocaleString()} reqs)
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between py-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="font-bold text-[#1B2A41] dark:text-white">Costo Mensual:</span>
                  <span className="font-black text-[#0054A6] text-sm">
                    {format(selectedServer.cost.monthlyCostUsd)}{" "}
                    {selectedServer.cost.potentialSavingsUsd > 0 && (
                      <span className="text-emerald-600 font-bold text-xs ml-1">
                        (-{format(selectedServer.cost.potentialSavingsUsd)})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabla de Recursos FinOps CMP */}
      <div className="space-y-4">
        {/* Filters */}
        <FinopsTableControls
          resourceOptions={resourceOptions}
          regionOptions={regionOptions}
          typeOptions={archOptions}
          resourceGroupOptions={rgOptions}
          sortOptions={sortOptions}
          selectedResource={resourceFilter}
          selectedRegion={regionFilter}
          selectedType={archFilter}
          selectedResourceGroup={resourceGroupFilter}
          selectedSort={sortMode}
          onResourceChange={(v) => { setResourceFilter(v); setPage(1); }}
          onRegionChange={(v) => { setRegionFilter(v); setPage(1); }}
          onTypeChange={(v) => { setArchFilter(v); setPage(1); }}
          onResourceGroupChange={(v) => { setResourceGroupFilter(v); setPage(1); }}
          onSortChange={(v) => { setSortMode(v as SortMode); setPage(1); }}
          labels={{
            resource: t("filterResource"),
            region: t("filterRegion"),
            type: t("filterArchitecture"),
            resourceGroup: t("filterResourceGroup"),
            sort: t("sortBy"),
          }}
        />

        {/* Table Container */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-200 font-[Montserrat,sans-serif]">
                {t("tableTitle")}
              </h3>
              <InfoTooltip content={t("tableTooltip")} />
            </div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {total} {t("resourcesCount")}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 text-left">
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">
                    <div className="flex items-center gap-1">{t("colResource")} <InfoTooltip content={t("tooltip_col_resource")} /></div>
                  </ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">
                    <div className="flex items-center gap-1">{t("colRegion")} <InfoTooltip content={t("tooltip_col_region")} /></div>
                  </ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">{t("colSubscription")}</ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">
                    <div className="flex items-center gap-1">{t("colArchitecture")} <InfoTooltip content={t("tooltip_col_arch")} /></div>
                  </ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300">SKU / Modo</ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-center">HA / Regiones</ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-center">{t("colState")}</ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">
                    <div className="flex items-center justify-end gap-1">CPU / RU % <InfoTooltip content={t("tooltip_col_cpu_ru")} /></div>
                  </ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">
                    <div className="flex items-center justify-end gap-1">Storage <InfoTooltip content={t("tooltip_col_storage")} /></div>
                  </ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colCost")}</ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">{t("colSavings")}</ResizableTh>
                  <ResizableTh className="p-3 font-bold text-slate-700 dark:text-slate-300 text-center">{t("colActions")}</ResizableTh>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center py-12 text-slate-400 dark:text-slate-600">
                      {t("noRecords")}
                    </td>
                  </tr>
                ) : (
                  paged.map((server: MongoDbResourceDetail) => {
                    const isSelected = server.id === selectedServerId;
                    return (
                      <tr
                        key={server.id}
                        className={`border-t border-slate-100 dark:border-slate-800 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-blue-50 dark:bg-blue-950/20"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        }`}
                        onClick={() => setSelectedServerId(isSelected ? "" : server.id)}
                      >
                        {/* Resource */}
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <IconDatabase size={14} stroke={1.5} className="text-[#0054A6] flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 dark:text-slate-200 text-xs truncate max-w-[160px]">
                                {server.name}
                              </p>
                              <p className="text-[10px] text-slate-400">Mongo {server.version}</p>
                            </div>
                          </div>
                        </td>
                        {/* Region */}
                        <td className="p-3">
                          <p className="text-xs text-slate-600 dark:text-slate-400">{server.region}</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[120px]">{server.resourceGroup}</p>
                        </td>
                        {/* Subscription */}
                        <td className="p-3">
                          <p className="text-xs text-slate-600 dark:text-slate-400 truncate max-w-[120px]">{server.subscriptionName}</p>
                        </td>
                        {/* Architecture */}
                        <td className="p-3">
                          <ArchitectureBadge arch={server.architecture} />
                        </td>
                        {/* SKU / Throughput */}
                        <td className="p-3">
                          {server.architecture === "vCore" && server.vcoreProfile ? (
                            <div>
                              <span className="font-mono font-bold text-xs text-slate-800 dark:text-slate-200">
                                {server.vcoreProfile.skuName}
                              </span>
                              <p className="text-[10px] text-slate-400">{server.vcoreProfile.vCores} vCores • {server.vcoreProfile.memoryGib}GB</p>
                            </div>
                          ) : (
                            <div>
                              <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                                {server.ruProfile?.throughputMode}
                              </span>
                              <p className="text-[10px] text-slate-400">{server.ruProfile?.provisionedRu} RU/s</p>
                            </div>
                          )}
                        </td>
                        {/* HA / Regiones */}
                        <td className="p-3 text-center">
                          {server.architecture === "vCore" ? (
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                              {server.vcoreProfile?.haMode}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                              {server.ruProfile?.regionsCount} reg
                            </span>
                          )}
                        </td>
                        {/* State */}
                        <td className="p-3 text-center">
                          <StateBadge state={server.state} />
                        </td>
                        {/* CPU / RU % */}
                        <td className="p-3 text-right">
                          {server.architecture === "vCore" ? (
                            <p className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                              CPU {server.metrics.vCoreMetrics?.cpuPercentAvg.toFixed(1)}%
                            </p>
                          ) : (
                            <p className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                              RU {server.metrics.ruMetrics?.normalizedRuPercentAvg.toFixed(1)}%
                            </p>
                          )}
                        </td>
                        {/* Storage */}
                        <td className="p-3 text-right">
                          {server.architecture === "vCore" ? (
                            <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                              {server.vcoreProfile?.diskSizeGb} GB
                            </p>
                          ) : (
                            <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                              {(server.ruProfile?.dataUsageGb || 0) + (server.ruProfile?.indexUsageGb || 0)} GB
                            </p>
                          )}
                        </td>
                        {/* Cost */}
                        <td className="p-3 text-right">
                          <p className="text-sm font-bold text-[#1B2A41] dark:text-slate-200">
                            {format(server.cost.monthlyCostUsd)}
                          </p>
                        </td>
                        {/* Savings */}
                        <td className="p-3 text-right">
                          {server.cost.potentialSavingsUsd > 0 ? (
                            <p className="text-sm font-bold text-emerald-600">
                              +{format(server.cost.potentialSavingsUsd)}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400">—</p>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setModalServer(server)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
                          >
                            <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                            <span>{t("inspect")}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800">
            <Pagination
              page={page}
              setPage={setPage}
              pageSize={pageSize}
              setPageSize={(s) => { setPageSize(s); setPage(1); }}
              total={total}
              totalPages={totalPages}
              pageSizes={[15, 30, 45, 60]}
            />
          </div>
        </div>
      </div>

      {/* Modal Interactivo de Remediación */}
      {modalServer && (
        <OptimizationModal
          server={modalServer}
          onClose={() => setModalServer(null)}
          format={format}
        />
      )}
    </div>
  );
}

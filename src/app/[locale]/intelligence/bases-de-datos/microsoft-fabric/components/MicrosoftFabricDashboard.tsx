"use client";

import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconBolt,
  IconBox,
  IconCheck,
  IconCircleCheck,
  IconClockHour4,
  IconCloud,
  IconCoin,
  IconCopy,
  IconCpu,
  IconDatabase,
  IconFileCode,
  IconGauge,
  IconLayersLinked,
  IconPlayerPause,
  IconRefresh,
  IconServer,
  IconShieldExclamation,
  IconSparkles,
  IconTable,
  IconTarget,
  IconTerminal2,
  IconTrendingUp,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { useCurrency } from "@/components/CurrencyProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTranslations } from "next-intl";
import InfoTooltip from "@/components/InfoTooltip";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import {
  FabricFinopsSummaryResponse,
  FabricRemediationAction,
} from "@/types/azureFabric";
import { toast } from "sonner";

// ─── Modal de Remediación y Optimización ─────────────────────────────────────
function FabricOptimizationModal({
  action,
  onClose,
  format,
}: {
  action: FabricRemediationAction;
  onClose: () => void;
  format: (v: number) => string;
}) {
  const [activeTab, setActiveTab] = useState<"cli" | "bicep" | "script">("cli");
  const [copied, setCopied] = useState(false);

  const code =
    activeTab === "cli"
      ? action.cliCommand || "# Comando CLI no disponible"
      : activeTab === "bicep"
      ? action.bicepSnippet || "// Plantilla Bicep no disponible"
      : action.scriptSnippet || action.cliCommand || "# Script no disponible";

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

  const riskBadge: Record<string, string> = {
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
                Plan de Remediación Fabric FinOps
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {action.title}
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
          <div className="p-4 bg-blue-50/40 dark:bg-slate-800/40 rounded-xl border border-blue-100 dark:border-slate-700 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-sm font-bold text-[#1B2A41] dark:text-white flex items-center gap-2">
                <IconBolt size={18} stroke={1.5} className="text-[#0054A6]" />
                {action.title}
              </h4>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {action.description}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
              {action.savingsMonthlyUsd > 0 && (
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 px-2.5 py-1 rounded-lg">
                  <IconCoin size={14} stroke={1.5} />
                  Ahorro Estimado: +{format(action.savingsMonthlyUsd)}/mes
                </span>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${riskBadge[action.risk] || ""}`}>
                Riesgo: {action.risk === "low" ? "Bajo" : action.risk === "medium" ? "Medio" : "Alto"}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                Confianza: {action.confidence === "high" ? "Alta" : action.confidence === "medium" ? "Media" : "Baja"}
              </span>
            </div>
          </div>

          {/* Execution Tabs */}
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
                Azure CLI / REST API
              </button>
              {action.bicepSnippet && (
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
              )}
              {action.scriptSnippet && (
                <button
                  onClick={() => setActiveTab("script")}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold transition-colors border-b-2 -mb-px ${
                    activeTab === "script"
                      ? "border-[#0054A6] text-[#0054A6]"
                      : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  }`}
                >
                  <IconFileCode size={14} stroke={2} />
                  PySpark / SQL
                </button>
              )}
            </div>
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

// ─── KPI Card ────────────────────────────────────────────────────────────────
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

// ─── Main Component ──────────────────────────────────────────────────────────
export default function MicrosoftFabricDashboard() {
  const t = useTranslations("MicrosoftFabric");
  const { selectedTenant } = useTenant();
  const { format } = useCurrency();
  const { instance, accounts } = useMsal();

  const [activeTab, setActiveTab] = useState<"capacity" | "artefacts" | "onelake" | "recommendations">("capacity");
  const [selectedAction, setSelectedAction] = useState<FabricRemediationAction | null>(null);

  // Search & Filter in Artefacts Tab
  const [artefactSearch, setArtefactSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("ALL");

  const hasSession = accounts.length > 0;
  const tenantId = selectedTenant?.id;

  const swrKey = tenantId && tenantId !== "default"
    ? `/api/intelligence/microsoft-fabric?tenantId=${tenantId}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<FabricFinopsSummaryResponse>(
    swrKey,
    async (url: string) => {
      let token: string | null = null;
      if (hasSession) {
        token = await getFreshIdToken(instance, accounts[0]);
      }
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    { revalidateOnFocus: true, dedupingInterval: 60000 }
  );

  // Filtered Artefacts
  const filteredArtefacts = useMemo(() => {
    if (!data?.artefacts) return [];
    return data.artefacts.filter((item) => {
      const matchSearch =
        item.name.toLowerCase().includes(artefactSearch.toLowerCase()) ||
        item.workspace.toLowerCase().includes(artefactSearch.toLowerCase()) ||
        item.owner.toLowerCase().includes(artefactSearch.toLowerCase());
      const matchType = selectedType === "ALL" || item.type === selectedType;
      const matchWorkspace = selectedWorkspace === "ALL" || item.workspace === selectedWorkspace;
      return matchSearch && matchType && matchWorkspace;
    });
  }, [data?.artefacts, artefactSearch, selectedType, selectedWorkspace]);

  const { page, setPage, pageSize, setPageSize, paged, total, totalPages } = usePagination(filteredArtefacts, 15);

  const workspacesList = useMemo(() => {
    if (!data?.artefacts) return [];
    return Array.from(new Set(data.artefacts.map((a) => a.workspace)));
  }, [data?.artefacts]);

  if (!selectedTenant || selectedTenant.id === "default") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[340px] text-center p-8">
        <IconDatabase size={48} stroke={1} className="text-[#0054A6]/30 mb-4" />
        <p className="text-base font-semibold text-slate-600 dark:text-slate-400">{t("selectTenant")}</p>
      </div>
    );
  }

  if (isLoading || !data) {
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
        <p className="text-xs text-slate-400">{error.message}</p>
        <button
          onClick={() => mutate()}
          className="mt-2 px-3 py-1.5 h-8 rounded-lg border border-[#0054A6] text-[#0054A6] text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
        >
          {t("refresh")}
        </button>
      </div>
    );
  }

  const fin = data.financialSummary;
  const eff = data.efficiency;
  const risk = data.risk;
  const primaryCapacity = data.capacities[0] || null;

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
          {data.timestamp && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 flex items-center gap-1">
              <IconClockHour4 size={11} stroke={2} />
              {t("updatedAt")}: {new Date(data.timestamp).toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={() => { mutate(); toast.success("Datos de Fabric sincronizados"); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg border border-[#0054A6] text-[#0054A6] text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm shrink-0 whitespace-nowrap"
        >
          <IconRefresh size={14} stroke={2} className="text-[#0054A6]" />
          <span>{t("refresh")}</span>
        </button>
      </div>

      {/* 8 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard
          icon={IconWallet}
          label={t("kpiMtdCost")}
          value={format(fin.totalSKUCostUSD)}
          sub={t("currentBillingCycle")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_mtd")}
        />
        <KpiCard
          icon={IconGauge}
          label={t("kpiForecast")}
          value={format(fin.forecastEomUSD)}
          sub={t("forecastEomSub")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_forecast")}
        />
        <KpiCard
          icon={IconTarget}
          label={t("kpiSavings")}
          value={format(fin.potentialSavingsUSD)}
          sub={`${data.recommendations.length} ${t("actionsDetected")}`}
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
          icon={IconServer}
          label={t("kpiCapacities")}
          value={String(data.capacities.length)}
          sub={`${eff.activeCapacitiesCount} activas • ${eff.pausedCapacitiesCount} pausadas`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_capacities")}
        />
        <KpiCard
          icon={IconCpu}
          label={t("kpiCUs")}
          value={`${eff.totalCUs} CUs`}
          sub={`${format(eff.costPerCuHour)}/CU-h`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_cus")}
        />
        <KpiCard
          icon={IconBolt}
          label={t("kpiThrottlingRisk")}
          value={fin.throttlingRiskLevel === "high" ? "Alto" : fin.throttlingRiskLevel === "medium" ? "Medio" : "Bajo"}
          sub={fin.burstingDetected ? t("burstingDetected") : t("noBursting")}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_throttling")}
        />
        <KpiCard
          icon={IconActivity}
          label={t("kpiHealth")}
          value={`${risk.healthScore}%`}
          sub={`${risk.criticalAlerts} ${t("criticalAlerts")}`}
          iconColorClass="text-[#0054A6]"
          tooltip={t("tooltip_kpi_health")}
        />
      </div>

      {/* 4 Sub-Tabs Navigation */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        <button
          onClick={() => setActiveTab("capacity")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors border-b-2 -mb-px whitespace-nowrap ${
            activeTab === "capacity"
              ? "border-[#0054A6] text-[#0054A6]"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <IconCpu size={16} stroke={1.5} className={activeTab === "capacity" ? "text-[#0054A6]" : "text-slate-400"} />
          {t("tabCapacityCost")}
        </button>
        <button
          onClick={() => setActiveTab("artefacts")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors border-b-2 -mb-px whitespace-nowrap ${
            activeTab === "artefacts"
              ? "border-[#0054A6] text-[#0054A6]"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <IconBox size={16} stroke={1.5} className={activeTab === "artefacts" ? "text-[#0054A6]" : "text-slate-400"} />
          {t("tabArtefacts")} ({data.artefacts.length})
        </button>
        <button
          onClick={() => setActiveTab("onelake")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors border-b-2 -mb-px whitespace-nowrap ${
            activeTab === "onelake"
              ? "border-[#0054A6] text-[#0054A6]"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <IconLayersLinked size={16} stroke={1.5} className={activeTab === "onelake" ? "text-[#0054A6]" : "text-slate-400"} />
          {t("tabOneLakeStorage")}
        </button>
        <button
          onClick={() => setActiveTab("recommendations")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors border-b-2 -mb-px whitespace-nowrap ${
            activeTab === "recommendations"
              ? "border-[#0054A6] text-[#0054A6]"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <IconTrendingUp size={16} stroke={1.5} className={activeTab === "recommendations" ? "text-[#0054A6]" : "text-slate-400"} />
          {t("tabRecommendations")} ({data.recommendations.length})
        </button>
      </div>

      {/* ─── PESTAÑA 1: Capacity & Cost ─────────────────────────────────────── */}
      {activeTab === "capacity" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Top Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Card 1: Total Monthly Cost */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {t("totalMonthlyCostTitle")}
                  </span>
                  {primaryCapacity && (
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
                      SKU {primaryCapacity.sku} ({primaryCapacity.capacityUnits} CUs)
                    </span>
                  )}
                </div>
                <div className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 font-[Montserrat,sans-serif]">
                  {format(fin.totalSKUCostUSD)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Cómputo F-SKU: <strong className="text-slate-800 dark:text-slate-200">{format(fin.totalComputeCUHoursUSD)}</strong> | OneLake Storage: <strong className="text-slate-800 dark:text-slate-200">{format(fin.totalStorageUSD)}</strong>
                </div>
              </div>

              {primaryCapacity?.isDevOrTest && (
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-500">Ambiente Dev detectado:</span>
                  <button
                    onClick={() => {
                      const rec = data.recommendations.find((r) => r.ruleKey === "auto_pause_dev");
                      if (rec) setSelectedAction(rec);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm"
                  >
                    <IconPlayerPause size={14} stroke={1.5} className="text-[#0054A6]" />
                    <span>Configurar Auto-Pausa</span>
                  </button>
                </div>
              )}
            </div>

            {/* Card 2: Throttling Risk & Forecast */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {t("throttlingRiskTitle")}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border ${
                    fin.throttlingRiskLevel === "high"
                      ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400"
                      : fin.throttlingRiskLevel === "medium"
                      ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400"
                  }`}>
                    {fin.throttlingRiskLevel === "high" && <IconShieldExclamation size={12} stroke={2} />}
                    {fin.throttlingRiskLevel === "medium" && <IconAlertTriangle size={12} stroke={2} />}
                    {fin.throttlingRiskLevel === "low" && <IconCircleCheck size={12} stroke={2} />}
                    {fin.throttlingRiskLevel === "high" ? "Riesgo Alto" : fin.throttlingRiskLevel === "medium" ? "Riesgo Medio" : "Riesgo Bajo (Sin Throttling)"}
                  </span>
                </div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {fin.burstingDetected ? "Picos de bursting detectados en los últimos 7 días" : "Operación dentro de los límites asignados de CUs"}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Forecast Fin de Mes (EOM): <strong className="text-[#0054A6]">{format(fin.forecastEomUSD)}</strong>
                </p>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">
                Smoothing Policy: 10 min para operaciones interactivas / 24h para background jobs.
              </div>
            </div>
          </div>

          {/* Capacity Utilization Panel */}
          {primaryCapacity && (
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-[Montserrat,sans-serif] flex items-center gap-2">
                  <IconActivity size={18} stroke={1.5} className="text-[#0054A6]" />
                  Utilización de Capacidad (Interactive & Background Smoothing)
                </h3>
                <span className="text-xs font-semibold text-slate-500">
                  Capacidad: <strong>{primaryCapacity.name}</strong>
                </span>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Operaciones Interactivas (Smoothing 10 min)</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{primaryCapacity.interactiveUtilPercent}%</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-[#0054A6] h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, primaryCapacity.interactiveUtilPercent)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Cargas Background / ETL (Smoothing 24h)</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{primaryCapacity.backgroundUtilPercent}%</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-[#0078D4] h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, primaryCapacity.backgroundUtilPercent)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Pico Máximo Registrado</span>
                    <span className="font-mono font-bold text-amber-600">{primaryCapacity.peakDayUtilPercent}%</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-500 ${primaryCapacity.peakDayUtilPercent > 90 ? "bg-red-500" : "bg-amber-500"}`}
                      style={{ width: `${Math.min(100, primaryCapacity.peakDayUtilPercent)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Inventario de Capacidades Fabric */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h4 className="text-sm font-bold text-[#1B2A41] dark:text-slate-200 font-[Montserrat,sans-serif]">
                Capacidades Microsoft Fabric Provisionadas
              </h4>
              <span className="text-xs font-semibold text-slate-500">{data.capacities.length} capacidades</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs font-bold text-slate-700 dark:text-slate-300">
                    <th className="p-3">Nombre</th>
                    <th className="p-3">SKU</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Región & RG</th>
                    <th className="p-3 text-right">Interactive %</th>
                    <th className="p-3 text-right">Background %</th>
                    <th className="p-3 text-right">Costo Mensual</th>
                    <th className="p-3 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.capacities.map((cap) => (
                    <tr key={cap.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-semibold text-slate-800 dark:text-slate-200 text-xs">
                        {cap.name}
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
                          {cap.sku} ({cap.capacityUnits} CUs)
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${
                          cap.state === "Active"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400"
                            : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400"
                        }`}>
                          {cap.state === "Active" ? <IconCircleCheck size={11} stroke={2} /> : <IconPlayerPause size={11} stroke={2} />}
                          {cap.state === "Active" ? "Activa" : "Pausada"}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-slate-600 dark:text-slate-400">
                        {cap.region} ({cap.resourceGroup})
                      </td>
                      <td className="p-3 text-right font-mono text-xs text-slate-700 dark:text-slate-300">
                        {cap.interactiveUtilPercent}%
                      </td>
                      <td className="p-3 text-right font-mono text-xs text-slate-700 dark:text-slate-300">
                        {cap.backgroundUtilPercent}%
                      </td>
                      <td className="p-3 text-right font-bold text-[#1B2A41] dark:text-slate-200">
                        {format(cap.monthlyCostUsd)}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => {
                            const rec = cap.isDevOrTest
                              ? data.recommendations.find((r) => r.ruleKey === "auto_pause_dev")
                              : data.recommendations.find((r) => r.ruleKey === "reservation_1y");
                            if (rec) setSelectedAction(rec);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
                        >
                          <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                          <span>Optimizar</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── PESTAÑA 2: Artefacts (Workspaces e Ítems) ──────────────────────── */}
      {activeTab === "artefacts" && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Controls: Search & Filters */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="w-full sm:w-72">
              <input
                type="text"
                placeholder="Buscar por nombre, workspace o owner..."
                value={artefactSearch}
                onChange={(e) => { setArtefactSearch(e.target.value); setPage(1); }}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0054A6]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={selectedType}
                onChange={(e) => { setSelectedType(e.target.value); setPage(1); }}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              >
                <option value="ALL">Todos los tipos</option>
                <option value="Lakehouse">Lakehouse</option>
                <option value="Warehouse">Warehouse</option>
                <option value="DataPipeline">Data Pipeline</option>
                <option value="Notebook">Notebook</option>
                <option value="SemanticModel">Semantic Model</option>
              </select>

              <select
                value={selectedWorkspace}
                onChange={(e) => { setSelectedWorkspace(e.target.value); setPage(1); }}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              >
                <option value="ALL">Todos los workspaces</option>
                {workspacesList.map((ws) => (
                  <option key={ws} value={ws}>{ws}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Artefacts Table */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs font-bold text-slate-700 dark:text-slate-300">
                    <ResizableTh className="p-3">Artefacto</ResizableTh>
                    <ResizableTh className="p-3">Tipo</ResizableTh>
                    <ResizableTh className="p-3">Workspace</ResizableTh>
                    <ResizableTh className="p-3 text-right">CU Consumo %</ResizableTh>
                    <ResizableTh className="p-3 text-right">Storage (GB)</ResizableTh>
                    <ResizableTh className="p-3">Última Modificación</ResizableTh>
                    <ResizableTh className="p-3">Responsable</ResizableTh>
                    <ResizableTh className="p-3 text-right">Costo Estimado</ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-slate-400">
                        No se encontraron artefactos con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    paged.map((art) => (
                      <tr key={art.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <IconTable size={16} stroke={1.5} className="text-[#0054A6] flex-shrink-0" />
                            <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">{art.name}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {art.type}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-slate-600 dark:text-slate-400 truncate max-w-[150px]">
                          {art.workspace}
                        </td>
                        <td className="p-3 text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {art.cuConsumptionPercent}%
                        </td>
                        <td className="p-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                          {art.storageGb} GB
                        </td>
                        <td className="p-3 text-xs text-slate-500">
                          {art.lastModified}
                        </td>
                        <td className="p-3 text-xs text-slate-600 dark:text-slate-400 truncate max-w-[140px]">
                          {art.owner}
                        </td>
                        <td className="p-3 text-right font-bold text-[#1B2A41] dark:text-slate-200">
                          {format(art.monthlyCostUsd)}
                        </td>
                      </tr>
                    ))
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
      )}

      {/* ─── PESTAÑA 3: OneLake Storage ─────────────────────────────────────── */}
      {activeTab === "onelake" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* OneLake Storage Breakdown (Azul Corporativo Armónico) */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 font-[Montserrat,sans-serif] flex items-center gap-2">
                <IconLayersLinked size={18} stroke={1.5} className="text-[#0054A6]" />
                OneLake Storage Breakdown (Deduplicación & Lifecycle)
              </h3>
              <span className="text-xs text-slate-500 font-semibold">
                Total Almacenado: <strong className="text-[#0054A6]">{data.onelake.totalStorageGb.toLocaleString()} GB</strong>
              </span>
            </div>

            <div className="space-y-4">
              {/* Barra 1: Total Storage (#0078D4 / bg-blue-600) */}
              <div>
                <div className="flex justify-between text-xs mb-1.5 font-semibold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#0078D4]" />
                    Total OneLake Storage
                  </span>
                  <span className="font-mono">{data.onelake.totalStorageGb.toLocaleString()} GB</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                  <div className="bg-[#0078D4] h-3 rounded-full" style={{ width: "100%" }} />
                </div>
              </div>

              {/* Barra 2: Estimated Duplicate Data (#2563EB / bg-blue-500) */}
              <div>
                <div className="flex justify-between text-xs mb-1.5 font-semibold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#2563EB]" />
                    Datos Físicamente Duplicados (Candidatos a OneLake Shortcuts)
                  </span>
                  <span className="font-mono text-[#2563EB]">{data.onelake.duplicateDataGb.toLocaleString()} GB</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-[#2563EB] h-3 rounded-full"
                    style={{ width: `${Math.min(100, (data.onelake.duplicateDataGb / Math.max(1, data.onelake.totalStorageGb)) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Barra 3: Recommended for Lifecycle (#93C5FD / bg-blue-300) */}
              <div>
                <div className="flex justify-between text-xs mb-1.5 font-semibold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#93C5FD]" />
                    Datos Inactivos para Lifecycle Management (Cold Storage Tier)
                  </span>
                  <span className="font-mono text-slate-600 dark:text-slate-300">{data.onelake.recommendedLifecycleGb.toLocaleString()} GB</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-[#93C5FD] h-3 rounded-full"
                    style={{ width: `${Math.min(100, (data.onelake.recommendedLifecycleGb / Math.max(1, data.onelake.totalStorageGb)) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Potential Monthly Savings Card (Limpio Enterprise sin verde plano) */}
            <div className="mt-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-[#0054A6]">
                  <IconCoin size={20} stroke={1.5} />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                    Ahorro Potencial Mensual en Storage: <span className="text-emerald-600">+{format(data.onelake.potentialSavingsUsd)}/mes</span>
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Mediante deduplicación Zero-Copy (OneLake Shortcuts) y políticas de archivado automático.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const rec = data.recommendations.find((r) => r.ruleKey === "onelake_shortcuts");
                  if (rec) setSelectedAction(rec);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
              >
                <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                <span>Crear Shortcuts</span>
              </button>
            </div>
          </div>

          {/* Tabla de Fragmentación de Tablas Delta (Vacuum / Optimize) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h4 className="text-sm font-bold text-[#1B2A41] dark:text-slate-200 font-[Montserrat,sans-serif]">
                Tablas Delta con Mantenimiento Pendiente (Vacuum & Optimize)
              </h4>
              <span className="text-xs font-semibold text-slate-500">
                {data.onelake.deltaFragmentationItems.length} tablas candidatas
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-left text-xs font-bold text-slate-700 dark:text-slate-300">
                    <th className="p-3">Tabla Delta</th>
                    <th className="p-3">Workspace</th>
                    <th className="p-3 text-right">Tamaño</th>
                    <th className="p-3 text-right">Archivos Pequeños</th>
                    <th className="p-3 text-right">Versiones Huérfanas</th>
                    <th className="p-3 text-right">Ahorro Estimado</th>
                    <th className="p-3 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {data.onelake.deltaFragmentationItems.map((item, idx) => (
                    <tr key={idx} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-semibold text-slate-800 dark:text-slate-200 text-xs">
                        {item.table}
                      </td>
                      <td className="p-3 text-xs text-slate-600 dark:text-slate-400">
                        {item.workspace}
                      </td>
                      <td className="p-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                        {item.sizeGb} GB
                      </td>
                      <td className="p-3 text-right font-mono text-xs text-amber-600">
                        {item.smallFilesCount.toLocaleString()}
                      </td>
                      <td className="p-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                        {item.unpurgedHistoricalVersions}
                      </td>
                      <td className="p-3 text-right font-bold text-emerald-600">
                        +{format(item.estimatedSavingsUsd)}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => {
                            const rec = data.recommendations.find((r) => r.ruleKey === "delta_vacuum_optimize");
                            if (rec) setSelectedAction(rec);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
                        >
                          <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                          <span>Optimizar</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── PESTAÑA 4: Recommendations ────────────────────────────────────── */}
      {activeTab === "recommendations" && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.recommendations.map((rec) => (
              <div
                key={rec.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
                      <IconBolt size={18} stroke={1.5} className="text-[#0054A6]" />
                      {rec.title}
                    </h4>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {rec.description}
                  </p>
                </div>

                <div className="pt-4 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-emerald-600">
                      +{format(rec.savingsMonthlyUsd)}/mes
                    </span>
                    <span className="text-[10px] text-slate-400">
                      (Riesgo: {rec.risk === "low" ? "Bajo" : rec.risk === "medium" ? "Medio" : "Alto"})
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedAction(rec)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 h-8 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors shadow-sm whitespace-nowrap"
                  >
                    <IconSparkles size={14} stroke={1.5} className="text-[#0054A6]" />
                    <span>Aplicar Remediación</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de Remediación */}
      {selectedAction && (
        <FabricOptimizationModal
          action={selectedAction}
          onClose={() => setSelectedAction(null)}
          format={format}
        />
      )}
    </div>
  );
}

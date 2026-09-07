"use client";
import { useTranslations } from "next-intl";

import React, { useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconDatabaseExport,
  IconSparkles,
  IconArrowUpCircle,
  IconRotateClockwise,
  IconDownload,
  IconCheck,
  IconLoader2,
  IconSearch,
  IconCopy,
  IconX,
  IconBrandPowershell,
  IconTerminal2,
  IconReceipt2,
  IconClock,
  IconShieldExclamation,
} from "@tabler/icons-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildLogAnalyticsRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import type {
  LogAnalyticsPayload,
  LogAnalyticsResource,
  LogAnalyticsRemediationAction,
} from "@/types/azureLogAnalytics.types";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

// `t` entra por parametro: buildFetcher no es un componente ni un hook y no
// puede llamar a useTranslations.
function buildFetcher(instance: any, accounts: any[], isMock: boolean, t: (k: string) => string) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isMock && accounts.length > 0) {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      } catch {
        // Fallback
      }
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("loadError"));
    }
    return res.json();
  };
}

// ─── Modal de Madurez de Monitoreo & Reevaluación ───
function MaturityEvaluationModal({
  isOpen,
  onClose,
  workspacesCount,
  potentialSavings,
}: {
  isOpen: boolean;
  onClose: () => void;
  workspacesCount: number;
  potentialSavings: number;
}) {
  const t = useTranslations("LogAnalyticsPanel");
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);

  if (!isOpen) return null;

  const handleEvaluate = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setCompleted(true);
      setTimeout(() => {
        setCompleted(false);
        onClose();
      }, 1200);
    }, 800);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl">
            <IconReceipt2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              {t("maturityTitle")}
            </h2>
            <p className="text-xs text-slate-500">
              {t("maturitySubtitle")}
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-medium">Workspaces Auditados:</span>
            <span className="font-bold text-[#1B2A41] dark:text-slate-100">{workspacesCount} instancias</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-medium">{t("savingsPotential")}</span>
            <span className="font-bold text-emerald-600">{formatCurrency(potentialSavings)}/mes</span>
          </div>
          <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/30 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {t("rerunDesc")}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleEvaluate}
            disabled={saving || completed}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 transition-colors cursor-pointer"
          >
            {saving ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin text-[#0054A6]" />
                {t("evaluating")}
              </>
            ) : completed ? (
              <>
                <IconCheck className="w-4 h-4 text-emerald-600" />
                {t("auditUpdated")}
              </>
            ) : (
              <>
                <IconSparkles className="w-4 h-4 text-[#0054A6]" />
                {t("rerun")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Remediación en 1-Clic ───
function RemediationModal({
  action,
  onClose,
}: {
  action: LogAnalyticsRemediationAction | null;
  onClose: () => void;
}) {
  const t = useTranslations("LogAnalyticsPanel");
  const [activeTab, setActiveTab] = useState<"CLI" | "POWERSHELL">("CLI");
  const [copied, setCopied] = useState(false);

  if (!action) return null;

  const command = buildLogAnalyticsRemediationCommand(action);
  const currentScript = activeTab === "CLI" ? command.cli : command.powershell;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl">
            <IconReceipt2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              {action.title}
            </h2>
            <p className="text-xs text-slate-500">{action.resourceName}</p>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-100 dark:border-slate-800">
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              {action.description}
            </p>
          </div>

          {action.category === "COMMITMENT_TIER" && (
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="font-bold text-blue-900 dark:text-blue-300">
                  {t("recCapacity")}
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  {t("estSavingsPerMonth", { amount: formatCurrency(action.estimatedSavingsUSD) })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Tier Actual:</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {action.currentTier || "Pay-As-You-Go"}
                  </span>
                </div>
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-blue-300 dark:border-blue-700">
                  <span className="text-[10px] text-blue-500 block mb-0.5">Tier Recomendado:</span>
                  <span className="font-bold text-[#0054A6]">
                    {action.recommendedTier || "CapacityReservation100GB"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {action.category === "DAILY_CAP" && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                  <IconShieldExclamation className="w-4 h-4 text-amber-600" />
                  {t("dailyCapTitle")}
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  {t("recLeakGuard")}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Fijar un límite diario de {action.recommendedDailyCapGB || 5} GB/día evita cobros desmedidos causados por bucles infinitos en aplicaciones en desarrollo.
              </p>
            </div>
          )}

          {action.category === "RETENTION_ADJUST" && (
            <div className="bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-sky-900 dark:text-sky-300 flex items-center gap-1.5">
                  <IconClock className="w-4 h-4 text-sky-600" />
                  {t("recRetention")}
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  {t("savingsPerMonth", { amount: formatCurrency(action.estimatedSavingsUSD) })}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Reducir el periodo de retención activa de {action.currentRetentionDays || 90} a {action.recommendedRetentionDays || 30} días elimina costos de retención extendida ($0.12/GB-mes).
              </p>
            </div>
          )}

          {/* Selector CLI / PowerShell */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {t("automationScript")}
              </span>
              <div className="flex rounded-lg p-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setActiveTab("CLI")}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                    activeTab === "CLI"
                      ? "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 shadow-xs"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <IconTerminal2 className="w-3.5 h-3.5" />
                  Azure CLI
                </button>
                <button
                  onClick={() => setActiveTab("POWERSHELL")}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                    activeTab === "POWERSHELL"
                      ? "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 shadow-xs"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <IconBrandPowershell className="w-3.5 h-3.5" />
                  PowerShell
                </button>
              </div>
            </div>

            <div className="relative">
              <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-[11px] font-mono overflow-x-auto border border-slate-800 max-h-40 leading-relaxed">
                <code>{currentScript}</code>
              </pre>
              <button
                onClick={handleCopy}
                className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-white rounded-md transition-colors border border-slate-700 cursor-pointer"
              >
                {copied ? (
                  <>
                    <IconCheck className="w-3.5 h-3.5 text-emerald-400" />
                    Copiado
                  </>
                ) : (
                  <>
                    <IconCopy className="w-3.5 h-3.5" />
                    {t("copy")}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card Component ───
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  alertBadge = false,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  alertBadge?: boolean;
}) {
  const t = useTranslations("LogAnalyticsPanel");
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {label}
        </span>
        <Icon className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
      </div>
      <div className="mt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-[#1B2A41] dark:text-slate-100 tracking-tight">
            {value}
          </span>
          {alertBadge && (
            <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 rounded-full border border-amber-200 dark:border-amber-800">
              {t("activeRisk")}
            </span>
          )}
        </div>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main Log Analytics Panel Component ───
export default function LogAnalyticsPanel() {
  const t = useTranslations("LogAnalyticsPanel");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const searchParams = useSearchParams();
  const isMock =
    isMockTenant(selectedTenant.id) || searchParams.get("mock") === "true";

  const [selectedAction, setSelectedAction] =
    useState<LogAnalyticsRemediationAction | null>(null);
  const [isMaturityModalOpen, setIsMaturityModalOpen] = useState(false);
  const [timeScope, setTimeScope] = useState<"MTD" | "30D" | "90D">("MTD");

  // Filtros
  const [filterResource, setFilterResource] = useState<string>("ALL");
  const [filterRegion, setFilterRegion] = useState<string>("ALL");
  const [filterTier, setFilterTier] = useState<string>("ALL");
  const [filterResourceGroup, setFilterResourceGroup] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Selección masiva
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);

  // Ordenamiento
  const [sortKey, setSortKey] = useState<keyof LogAnalyticsResource>("totalRealCostUSD");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const url = `/api/intelligence/log-analytics?tenantId=${encodeURIComponent(
    selectedTenant.id
  )}${isMock ? "&mock=true" : ""}`;

  const { data, error, isLoading, isValidating, mutate } = useSWR<LogAnalyticsPayload>(
    selectedTenant.id ? url : null,
    buildFetcher(instance, accounts, isMock, t),
    { revalidateOnFocus: false }
  );

  const isRefreshing = isValidating && !isLoading;

  const workspaces = data?.workspaces || [];
  const summary = data?.summary || {
    totalMonthlyCostUSD: 0,
    totalIngestedGB: 0,
    potentialSavingsUSD: 0,
    commitmentCandidatesCount: 0,
    unlimitedCapCount: 0,
    workspacesCount: 0,
    breakdownByPricingTier: [],
  };
  const remediationActions = data?.remediationActions || [];
  const breakdownByPricingTier = summary?.breakdownByPricingTier || [];
  const dailyIngestionTrend = data?.dailyIngestionTrend || [];

  // Opciones de Filtros
  const resourceOptions = ["ALL", ...new Set(workspaces.map((w) => w.name))];
  const regionOptions = ["ALL", ...new Set(workspaces.map((w) => w.location))];
  const tierOptions = ["ALL", ...new Set(workspaces.map((w) => w.pricingTier))];
  const rgOptions = ["ALL", ...new Set(workspaces.map((w) => w.resourceGroup))];

  // Filtrado
  const filteredWorkspaces = workspaces
    .filter((w) => filterResource === "ALL" || w.name === filterResource)
    .filter((w) => filterRegion === "ALL" || w.location === filterRegion)
    .filter((w) => filterTier === "ALL" || w.pricingTier === filterTier)
    .filter((w) => filterResourceGroup === "ALL" || w.resourceGroup === filterResourceGroup)
    .filter((w) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        w.name.toLowerCase().includes(q) ||
        w.resourceGroup.toLowerCase().includes(q) ||
        w.location.toLowerCase().includes(q) ||
        w.subscriptionName.toLowerCase().includes(q)
      );
    });

  // Ordenamiento
  const sortedWorkspaces = [...filteredWorkspaces].sort((a, b) => {
    const valA = a[sortKey];
    const valB = b[sortKey];
    if (typeof valA === "number" && typeof valB === "number") {
      return sortDir === "asc" ? valA - valB : valB - valA;
    }
    return sortDir === "asc"
      ? String(valA || "").localeCompare(String(valB || ""))
      : String(valB || "").localeCompare(String(valA || ""));
  });

  const { page, setPage, pageSize, setPageSize, total, totalPages, paged } =
    usePagination(sortedWorkspaces, 15);

  const toggleSelectAll = () => {
    if (selectedWorkspaceIds.length === paged.length) {
      setSelectedWorkspaceIds([]);
    } else {
      setSelectedWorkspaceIds(paged.map((w) => w.id));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedWorkspaceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSort = (key: keyof LogAnalyticsResource) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const exportCSV = () => {
    if (!workspaces.length) return;
    const headers = [
      "Workspace",
      "Región",
      "Grupo de Recursos",
      "Suscripción",
      "Pricing Tier",
      "Retención (Días)",
      "Daily Cap (GB)",
      "Ingesta MTD (GB)",
      "Ingesta Diaria Promedio (GB)",
      "Costo Ingesta (USD)",
      "Costo Retención (USD)",
      "Costo Total (USD)",
      "Ahorro Estimado (USD)",
    ];
    const rows = workspaces.map((w) => [
      w.name,
      w.location,
      w.resourceGroup,
      w.subscriptionName,
      w.pricingTier,
      w.retentionInDays,
      w.isDailyCapUnlimited ? "Sin Límite" : `${w.dailyCapGB} GB`,
      w.totalBillableGB_MTD,
      w.avgDailyIngestionGB,
      w.monthlyCostUSD,
      w.specializedCostUSD,
      w.totalRealCostUSD,
      w.potentialSavingsUSD,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `log-analytics-finops-${selectedTenant.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* ─── Header Minimalista y Botones de Acción Corporativos ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
            <IconReceipt2 className="w-7 h-7 text-[#0078D4]" stroke={1.5} />
            {t("pageTitle")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Selector de alcance temporal */}
          <div className="flex rounded-lg p-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            {(["MTD", "30D", "90D"] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => setTimeScope(scope)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors cursor-pointer ${
                  timeScope === scope
                    ? "bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 shadow-xs"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                {scope}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsMaturityModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
          >
            <IconSparkles className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
            {t("resumeAssessment")}
          </button>
          <button
            onClick={() => mutate()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
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

      {/* ─── KPI Cards Superiores (4 Tarjetas) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={IconCash}
          label={t("kpiCostMtd")}
          value={formatCurrency(summary.totalMonthlyCostUSD)}
          sub={`Proyección fin de mes: ${formatCurrency(summary.totalMonthlyCostUSD * 1.05)}`}
        />
        <KpiCard
          icon={IconDatabaseExport}
          label="Volumen Ingerido (GB MTD)"
          value={`${summary.totalIngestedGB.toFixed(1)} GB`}
          sub="Tarifa base PAYG: $2.30 USD/GB"
        />
        <KpiCard
          icon={IconSparkles}
          label={t("kpiTotalSavings")}
          value={formatCurrency(summary.potentialSavingsUSD)}
          sub={`${remediationActions.length} oportunidades activas`}
        />
        <KpiCard
          icon={IconArrowUpCircle}
          label="Candidatos Commitment Tier"
          value={String(summary.commitmentCandidatesCount)}
          sub={`${summary.workspacesCount} workspaces monitoreados`}
          alertBadge={summary.commitmentCandidatesCount > 0}
        />
      </div>

      {/* ─── Fila 1: Gráficas de Ingesta & Evolución (Grid de 2 Columnas) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel Izquierdo: Donut Chart Distribución por Pricing Tier */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              {t("costByTier")}
            </h3>
            <span className="text-[11px] text-slate-400">Mensual</span>
          </div>

          <div className="h-64 w-full">
            {breakdownByPricingTier.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                {t("noDistribution")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdownByPricingTier}
                    dataKey="costUSD"
                    nameKey="tierName"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                  >
                    {breakdownByPricingTier.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(val: any) => formatCurrency(Number(val))}
                    contentStyle={{
                      backgroundColor: "#1B2A41",
                      borderRadius: "8px",
                      color: "#FFFFFF",
                      fontSize: "12px",
                      border: "none",
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    formatter={(val) => <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">{val}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Panel Derecho: Gráfica de Área Evolución Ingesta & Costo */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              {t("ingestionTrend")}
            </h3>
            <span className="text-[11px] text-slate-400">{t("last30Days")}</span>
          </div>

          <div className="h-64 w-full">
            {dailyIngestionTrend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                {t("noDailyTrend")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={dailyIngestionTrend}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="ingestGradLaw" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0078D4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#94A3B8" }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} />
                  <RechartsTooltip
                    formatter={(val: any, name: any) =>
                      name === "ingestedGB"
                        ? [`${val} GB`, "Ingesta"]
                        : [formatCurrency(Number(val)), "Costo"]
                    }
                    contentStyle={{
                      backgroundColor: "#1B2A41",
                      borderRadius: "8px",
                      color: "#FFFFFF",
                      fontSize: "12px",
                      border: "none",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="ingestedGB"
                    name="ingestedGB"
                    stroke="#0078D4"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#ingestGradLaw)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ─── Fila 2: Filtros y Tabla "Desglose por Workspace" ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
        {/* Barra de Filtros Inmediatos */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Recurso */}
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="font-semibold">{t("detailResource")}</span>
              <select
                value={filterResource}
                onChange={(e) => setFilterResource(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 font-medium"
              >
                {resourceOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "ALL" ? "Todos los Workspaces" : opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Región */}
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="font-semibold">{t("detailRegion")}</span>
              <select
                value={filterRegion}
                onChange={(e) => setFilterRegion(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 font-medium"
              >
                {regionOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "ALL" ? "Todas las Regiones" : opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Pricing Tier */}
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="font-semibold">Tier:</span>
              <select
                value={filterTier}
                onChange={(e) => setFilterTier(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 font-medium"
              >
                {tierOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "ALL" ? "Todos los Tiers" : opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Grupo de Recursos */}
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="font-semibold">RG:</span>
              <select
                value={filterResourceGroup}
                onChange={(e) => setFilterResourceGroup(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 font-medium"
              >
                {rgOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "ALL" ? "Todos los RGs" : opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Buscador */}
          <div className="relative min-w-[220px]">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t("search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-[#0054A6]"
            />
          </div>
        </div>

        {/* Tabla Ancho Completo */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-full table-fixed text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={paged.length > 0 && selectedWorkspaceIds.length === paged.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-[#0054A6] focus:ring-[#0054A6] cursor-pointer"
                  />
                </th>
                <ResizableTh
                  minWidth={190}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("name")}
                >
                  Workspace {sortKey === "name" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={110}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("location")}
                >
                  Región {sortKey === "location" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={140}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("resourceGroup")}
                >
                  Grupo Rec. {sortKey === "resourceGroup" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={150}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("subscriptionName")}
                >
                  Suscripción {sortKey === "subscriptionName" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={130}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => handleSort("pricingTier")}
                >
                  Pricing Tier {sortKey === "pricingTier" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={100}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none text-right"
                  onClick={() => handleSort("retentionInDays")}
                >
                  Retención {sortKey === "retentionInDays" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={110}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none text-right"
                  onClick={() => handleSort("dailyCapGB")}
                >
                  Tope Diario {sortKey === "dailyCapGB" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={110}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none text-right"
                  onClick={() => handleSort("totalBillableGB_MTD")}
                >
                  Ingesta MTD {sortKey === "totalBillableGB_MTD" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={120}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none text-right"
                  onClick={() => handleSort("totalRealCostUSD")}
                >
                  Costo Total {sortKey === "totalRealCostUSD" && (sortDir === "asc" ? "▲" : "▼")}
                </ResizableTh>
                <ResizableTh
                  minWidth={160}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider"
                >
                  {t("colRecommendation")}
                </ResizableTh>
                <ResizableTh
                  minWidth={110}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right"
                >
                  {t("colEstSavings")}
                </ResizableTh>
                <ResizableTh
                  minWidth={120}
                  className="py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center"
                >
                  Acciones
                </ResizableTh>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-xs text-slate-400">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                paged.map((w) => {
                  const action = remediationActions.find((a) => a.resourceId === w.id);
                  const isSelected = selectedWorkspaceIds.includes(w.id);

                  return (
                    <tr
                      key={w.id}
                      className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                        isSelected ? "bg-blue-50/30 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(w.id)}
                          className="rounded border-slate-300 text-[#0054A6] focus:ring-[#0054A6] cursor-pointer"
                        />
                      </td>

                      {/* Workspace */}
                      <td className="py-3 px-3 font-semibold text-xs text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <IconReceipt2 className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className="truncate">{w.name}</span>
                        </div>
                      </td>

                      {/* Región */}
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400">
                        {w.location}
                      </td>

                      {/* Grupo Rec. */}
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400 truncate">
                        {w.resourceGroup}
                      </td>

                      {/* Suscripción */}
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400 truncate">
                        {w.subscriptionName}
                      </td>

                      {/* Pricing Tier */}
                      <td className="py-3 px-3 text-xs">
                        {w.pricingTier.includes("CapacityReservation") ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Commitment ({w.capacityReservationLevel || 100} GB)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            Pay-As-You-Go
                          </span>
                        )}
                      </td>

                      {/* Retención */}
                      <td className="py-3 px-3 text-xs text-right font-medium text-slate-700 dark:text-slate-300">
                        {t("daysValue", { n: w.retentionInDays })}
                      </td>

                      {/* Daily Cap */}
                      <td className="py-3 px-3 text-xs text-right">
                        {w.isDailyCapUnlimited ? (
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                            {t("noCap")}
                          </span>
                        ) : (
                          <span className="text-slate-700 dark:text-slate-300 font-medium">
                            {t("gbPerDay", { n: w.dailyCapGB ?? 0 })}
                          </span>
                        )}
                      </td>

                      {/* Ingesta MTD */}
                      <td className="py-3 px-3 text-xs text-right font-mono text-slate-700 dark:text-slate-300">
                        {w.totalBillableGB_MTD.toFixed(1)} GB
                      </td>

                      {/* Costo Total */}
                      <td className="py-3 px-3 text-xs text-right font-bold text-[#0054A6] dark:text-blue-400">
                        {formatCurrency(w.totalRealCostUSD)}
                      </td>

                      {/* Recomendación */}
                      <td className="py-3 px-3 text-xs">
                        {w.primaryRecommendation ? (
                          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 line-clamp-1">
                            {w.primaryRecommendation.title}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">{t("optimal")}</span>
                        )}
                      </td>

                      {/* Ahorro Est. */}
                      <td className="py-3 px-3 text-xs text-right font-bold text-emerald-600">
                        {w.potentialSavingsUSD > 0 ? formatCurrency(w.potentialSavingsUSD) : "—"}
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-3 text-center">
                        {action ? (
                          <button
                            onClick={() => setSelectedAction(action)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] rounded-md shadow-2xs hover:bg-blue-50/50 transition-colors cursor-pointer"
                          >
                            <IconSparkles className="w-3 h-3 text-[#0078D4]" />
                            Optimizar
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
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
        <Pagination
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          setPageSize={setPageSize}
          total={total}
          totalPages={totalPages}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      {/* ─── Panel de Recomendaciones Priorizadas de Log Analytics (Ancho 100%) ─── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
            <IconSparkles className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            {t("actionsTitle")}
          </h3>
          <span className="text-xs text-slate-400">
            {remediationActions.length} acciones sugeridas
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {remediationActions.length === 0 ? (
            <div className="col-span-full py-6 text-center text-xs text-slate-400">
              {t("noFindings")}
            </div>
          ) : (
            remediationActions.map((rec) => (
              <div
                key={rec.id}
                className="bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-[#0054A6] border border-blue-200 dark:border-blue-900">
                      {rec.category.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs font-bold text-emerald-600">
                      ~{formatCurrency(rec.estimatedSavingsUSD)}/mes
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    {rec.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-3">
                    {rec.description}
                  </p>
                </div>

                <div className="pt-3 mt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-medium">
                    Confianza: {rec.confidence}
                  </span>
                  <button
                    onClick={() => setSelectedAction(rec)}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-2xs hover:bg-blue-50/50 transition-colors cursor-pointer"
                  >
                    <IconSparkles className="w-3 h-3 text-[#0078D4]" />
                    Optimizar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ─── Modales ─── */}
      <RemediationModal
        action={selectedAction}
        onClose={() => setSelectedAction(null)}
      />

      <MaturityEvaluationModal
        isOpen={isMaturityModalOpen}
        onClose={() => setIsMaturityModalOpen(false)}
        workspacesCount={summary.workspacesCount}
        potentialSavings={summary.potentialSavingsUSD}
      />
    </div>
  );
}

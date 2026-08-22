"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconDatabaseExport,
  IconSparkles,
  IconAward,
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
  IconShieldLock,
  IconTopologyStarRing3,
  IconEye,
} from "@tabler/icons-react";
import {
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
import { buildSentinelRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import type {
  SentinelPayload,
  SentinelResource,
  SentinelRemediationAction,
} from "@/types/azureSentinel.types";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

function formatCurrencyAxis(value: number, maxDatasetValue: number): string {
  if (maxDatasetValue < 1000) {
    return `$${Math.round(value)}`;
  }
  return `$${(value / 1000).toFixed(1)}k`;
}

function buildFetcher(instance: any, accounts: any[], isMock: boolean) {
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
      throw new Error(err.error || "Error al cargar Microsoft Sentinel FinOps");
    }
    return res.json();
  };
}

// ─── Modal de Madurez de Seguridad & Reevaluación ───
function SecurityMaturityModal({
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
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl">
            <IconShieldLock className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              Evaluación de Madurez SIEM & Sentinel
            </h2>
            <p className="text-xs text-slate-500">
              Auditoría FinOps de conectores de ingesta, reglas analíticas y Capacity Tiers
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-medium">Workspaces Sentinel Auditados:</span>
            <span className="font-bold text-[#1B2A41] dark:text-slate-100">{workspacesCount} instancias</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-medium">Potencial de Ahorro Detectado:</span>
            <span className="font-bold text-emerald-600">{formatCurrency(potentialSavings)}/mes</span>
          </div>
          <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/30 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            La reevaluación cruza el volumen de ingesta de tablas de seguridad (SecurityEvent, CommonSecurityLog, SigninLogs), la vigencia de Capacity Reservations combinadas y el ratio de reglas analíticas sin hallazgos.
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={handleEvaluate}
            disabled={saving || completed}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 transition-colors cursor-pointer"
          >
            {saving ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin text-[#0054A6]" />
                Auditando SIEM...
              </>
            ) : completed ? (
              <>
                <IconCheck className="w-4 h-4 text-emerald-600" />
                Auditoría Actualizada
              </>
            ) : (
              <>
                <IconSparkles className="w-4 h-4 text-[#0054A6]" />
                Ejecutar Reevaluación
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
  action: SentinelRemediationAction | null;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"CLI" | "POWERSHELL">("CLI");
  const [copied, setCopied] = useState(false);

  if (!action) return null;

  const command = buildSentinelRemediationCommand(action);
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
            <IconShieldLock className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
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
                  Transición a Sentinel Capacity Reservation
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro estimado: ~{formatCurrency(action.estimatedSavingsUSD)}/mes
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Tier Actual:</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    {action.currentTier || "Pay-As-You-Go ($4.30/GB)"}
                  </span>
                </div>
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-blue-200 dark:border-blue-800">
                  <span className="text-[10px] text-[#0054A6] block mb-0.5">Tier Recomendado:</span>
                  <span className="font-bold text-[#0054A6]">
                    {action.recommendedTier || "CapacityReservation100GB"} (~$3.19/GB)
                  </span>
                </div>
              </div>
            </div>
          )}

          {action.category === "DAILY_CAP" && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-amber-900 dark:text-amber-300">
                  Tope Diario de Seguridad (Daily Cap)
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Límite sugerido: {action.recommendedDailyCapGB || 5} GB/día
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Evita la sobre-facturación accidental en entornos no productivos protegiendo contra bucles infinitos de ingesta.
              </p>
            </div>
          )}

          {action.category === "ORPHAN_RULES" && (
            <div className="bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-purple-900 dark:text-purple-300">
                  Racionalización de Reglas Analíticas Inactivas
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  {action.orphanRulesCount || 2} reglas identificadas
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Las reglas analíticas que no generan incidentes en 90 días consumen ciclos de cómputo continuos en Log Analytics ($2.30/GB).
              </p>
            </div>
          )}

          {/* Selector CLI / PowerShell */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab("CLI")}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === "CLI"
                      ? "bg-slate-900 text-white dark:bg-blue-600"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                  }`}
                >
                  <IconTerminal2 className="w-3.5 h-3.5" />
                  Azure CLI
                </button>
                <button
                  onClick={() => setActiveTab("POWERSHELL")}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === "POWERSHELL"
                      ? "bg-slate-900 text-white dark:bg-blue-600"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                  }`}
                >
                  <IconBrandPowershell className="w-3.5 h-3.5" />
                  PowerShell
                </button>
              </div>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0054A6] hover:underline cursor-pointer"
              >
                {copied ? (
                  <>
                    <IconCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600">¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <IconCopy className="w-3.5 h-3.5" />
                    Copiar Script
                  </>
                )}
              </button>
            </div>

            <pre className="p-3 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto whitespace-pre-wrap border border-slate-800">
              {currentScript}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Cerrar
          </button>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg shadow-xs hover:bg-blue-50/50 transition-colors cursor-pointer"
          >
            <IconCopy className="w-4 h-4 text-[#0054A6]" />
            Copiar Comando
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function SentinelPanel() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const [timeScope, setTimeScope] = useState<"MTD" | "30D" | "90D">("MTD");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRegion, setFilterRegion] = useState<string>("ALL");
  const [filterTier, setFilterTier] = useState<string>("ALL");
  const [filterRg, setFilterRg] = useState<string>("ALL");
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([]);
  const [activeRemediation, setActiveRemediation] = useState<SentinelRemediationAction | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  const isMock = useMemo(() => {
    return (
      searchParams.get("mock") === "true" ||
      isMockTenant(tenantId) ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    );
  }, [searchParams, tenantId]);

  const apiUrl = `/api/intelligence/monitoring/sentinel?tenantId=${encodeURIComponent(
    tenantId
  )}${isMock ? "&mock=true" : ""}&timeScope=${timeScope}`;

  const { data, error, isLoading, mutate } = useSWR<SentinelPayload>(
    apiUrl,
    buildFetcher(instance, accounts, isMock),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  const workspaces = useMemo(() => data?.workspaces || [], [data]);
  const metrics = data?.summary;
  const topTables = useMemo(() => data?.topTables || [], [data]);
  const history = useMemo(() => data?.dailyTrend || [], [data]);
  const remediations = useMemo(() => data?.remediationActions || [], [data]);

  // Filtros disponibles
  const regions = useMemo(() => {
    const set = new Set<string>();
    workspaces.forEach((w) => w.location && set.add(w.location));
    return Array.from(set).sort();
  }, [workspaces]);

  const tiers = useMemo(() => {
    const set = new Set<string>();
    workspaces.forEach((w) => w.lawPricingTier && set.add(w.lawPricingTier));
    return Array.from(set).sort();
  }, [workspaces]);

  const resourceGroups = useMemo(() => {
    const set = new Set<string>();
    workspaces.forEach((w) => w.resourceGroup && set.add(w.resourceGroup));
    return Array.from(set).sort();
  }, [workspaces]);

  // Filtrado
  const filteredWorkspaces = useMemo(() => {
    return workspaces.filter((w) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = w.name.toLowerCase().includes(q);
        const matchesRg = w.resourceGroup.toLowerCase().includes(q);
        const matchesSub = w.subscriptionName.toLowerCase().includes(q);
        if (!matchesName && !matchesRg && !matchesSub) return false;
      }
      if (filterRegion !== "ALL" && w.location !== filterRegion) return false;
      if (filterTier !== "ALL" && w.lawPricingTier !== filterTier) return false;
      if (filterRg !== "ALL" && w.resourceGroup !== filterRg) return false;
      return true;
    });
  }, [workspaces, searchQuery, filterRegion, filterTier, filterRg]);

  // Paginación Estándar CMP
  const {
    paged: paginatedWorkspaces,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredWorkspaces, 15);

  const toggleSelectAll = () => {
    if (selectedWorkspaces.length === filteredWorkspaces.length) {
      setSelectedWorkspaces([]);
    } else {
      setSelectedWorkspaces(filteredWorkspaces.map((w) => w.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedWorkspaces((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleExportCSV = () => {
    const headers = [
      "Workspace",
      "Región",
      "Grupo de Recursos",
      "Suscripción",
      "Tier LAW",
      "Retención (Días)",
      "Daily Cap (GB)",
      "Ingesta MTD (GB)",
      "Costo Consolidado ($ USD)",
      "Ahorro Estimado ($ USD)",
    ];
    const rows = filteredWorkspaces.map((w) => [
      `"${w.name}"`,
      w.location,
      `"${w.resourceGroup}"`,
      `"${w.subscriptionName}"`,
      w.lawPricingTier,
      w.retentionInDays,
      w.dailyCapGB ? `${w.dailyCapGB} GB` : "Ilimitado",
      w.totalIngestedGB_MTD.toFixed(2),
      w.totalRealCostUSD.toFixed(2),
      w.potentialSavingsUSD.toFixed(2),
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sentinel_finops_${tenantId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const maxSpend = useMemo(() => {
    if (!history || history.length === 0) return 1000;
    return Math.max(...history.map((h) => h.costUSD || 0), 1000);
  }, [history]);

  return (
    <div className="w-full max-w-full space-y-6 animate-in fade-in duration-300">
      {/* ─── Header Minimalista y Acciones ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900/50">
            <IconReceipt2 className="w-7 h-7 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-sans">
                Gobernanza FinOps de Microsoft Sentinel
              </h1>
              {isMock && (
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-md border border-amber-300 dark:border-amber-700">
                  Modo Demo / Sintético
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Auditoría de ingesta SIEM consolidada ($4.30/GB), optimización de Capacity Tiers y purga de reglas de alerta inactivas
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Selector de Alcance Temporal */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
            {(["MTD", "30D", "90D"] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => setTimeScope(scope)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  timeScope === scope
                    ? "bg-white dark:bg-slate-900 text-[#0054A6] shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {scope}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsAuditModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-xl hover:bg-blue-50/40 transition-colors shadow-xs cursor-pointer"
          >
            <IconSparkles className="w-4 h-4 text-[#0054A6]" />
            Retomar Evaluación
          </button>

          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-[#10B981] bg-white dark:bg-slate-900 border border-[#10B981] rounded-xl hover:bg-emerald-50/40 transition-colors shadow-xs cursor-pointer"
          >
            <IconDownload className="w-4 h-4 text-[#10B981]" />
            Exportar CSV
          </button>

          <button
            onClick={() => mutate()}
            disabled={isLoading}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            title="Actualizar datos"
          >
            <IconRotateClockwise
              className={`w-4 h-4 ${isLoading ? "animate-spin text-[#0078D4]" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* ─── KPI Cards Superiores (Ancho 100% - 4 Tarjetas) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
        {/* Card 1: Costo Sentinel MTD */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Costo Sentinel MTD (Amortizado)
            </span>
            <IconCash className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 font-sans">
              {formatCurrency(metrics?.totalMonthlyCostUSD || 0)}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500">
              <span>Proyección fin de mes:</span>
              <span className="font-bold text-[#0054A6]">
                ~{formatCurrency((metrics?.totalMonthlyCostUSD || 0) * 1.12)}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Volumen Ingerido (GB MTD) */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Volumen Ingerido (GB MTD)
            </span>
            <IconDatabaseExport className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 font-sans">
              {(metrics?.totalIngestedGB || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500">
              <span>Tarifa combinada:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                $4.30 USD / GB
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Ahorro Potencial Total */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Ahorro Potencial Total
            </span>
            <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-emerald-600 font-sans">
              {formatCurrency(metrics?.potentialSavingsUSD || 0)}
              <span className="text-xs text-slate-500 font-normal ml-1">/mes</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              <IconCheck className="w-3.5 h-3.5" />
              <span>{remediations.length} acciones optimizables</span>
            </div>
          </div>
        </div>

        {/* Card 4: Candidatos Capacity Tier */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Candidatos Capacity Tier
            </span>
            <IconAward className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 font-sans">
              {metrics?.commitmentCandidatesCount || 0}
              <span className="text-xs text-slate-500 font-normal ml-1">workspaces</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-[#0054A6]">
              <span>Ingesta &gt; 100 GB/día sostenido</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Fila 1: Top Tablas Ingeridas por Volumen & Evolución ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
        {/* Panel Izquierdo: Top 5 Tablas Ingeridas */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                Top 5 Tablas Ingeridas por Volumen (GB MTD)
              </h2>
              <p className="text-xs text-slate-500">
                Atribución directa de volumen y costo consolidado ($4.30/GB)
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              Total: {(metrics?.totalIngestedGB || 0).toFixed(1)} GB
            </span>
          </div>

          <div className="space-y-3">
            {topTables.map((t, idx) => (
              <div key={t.tableName} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] bg-blue-100 text-[#0054A6] dark:bg-blue-950 dark:text-blue-300">
                      #{idx + 1}
                    </span>
                    <span className="font-bold text-[#1B2A41] dark:text-slate-100 font-mono">
                      {t.tableName}
                    </span>
                    <span className="text-[10px] text-slate-400">({t.category})</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#0054A6] mr-2">
                      {formatCurrency(t.costUSD)}
                    </span>
                    <span className="text-slate-500 font-mono text-[11px]">
                      {t.ingestedGB.toFixed(1)} GB ({t.percentage}%)
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.max(5, t.percentage))}%`,
                      backgroundColor: t.color || "#0054A6",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Panel Derecho: Evolución Temporal de Ingesta y Gasto Diario */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                Evolución de Ingesta & Costo Diario
              </h2>
              <p className="text-xs text-slate-500">
                Volumen diario (GB) vs Gasto diario ($ USD)
              </p>
            </div>
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              Últimos 30 días
            </span>
          </div>

          <div className="h-64 w-full">
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sentinelCostGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0078D4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#64748B" }}
                    tickLine={false}
                    axisLine={{ stroke: "#E2E8F0" }}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: "#64748B" }}
                    tickLine={false}
                    axisLine={{ stroke: "#E2E8F0" }}
                    tickFormatter={(val) => formatCurrencyAxis(val, maxSpend)}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "#64748B" }}
                    tickLine={false}
                    axisLine={{ stroke: "#E2E8F0" }}
                    tickFormatter={(val) => `${val} GB`}
                  />
                  <RechartsTooltip
                    formatter={(val: any, name: any) => {
                      if (name === "Costo ($ USD)") return [formatCurrency(Number(val) || 0), name];
                      return [`${Number(val).toFixed(1)} GB`, name];
                    }}
                    contentStyle={{
                      backgroundColor: "#1B2A41",
                      borderRadius: "12px",
                      color: "#FFFFFF",
                      border: "1px solid #334155",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="costUSD"
                    name="Costo ($ USD)"
                    stroke="#0078D4"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#sentinelCostGrad)"
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="ingestedGB"
                    name="Ingesta Diaria (GB)"
                    stroke="#00AEEF"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fill="none"
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    formatter={(value) => (
                      <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                        {value}
                      </span>
                    )}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Sin datos de evolución diaria disponibles
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Fila 2: Tabla "LAW + Sentinel Audit (Auditoría FinOps)" ─── */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 w-full">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              Auditoría FinOps de Workspaces Sentinel & Log Analytics
            </h2>
            <p className="text-xs text-slate-500">
              Supervisión de consumo por workspace, tiers activos y topes de seguridad
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Buscador */}
            <div className="relative">
              <IconSearch className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar workspace o RG..."
                className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-[#0078D4] w-48 sm:w-60"
              />
            </div>

            {/* Filtro Región */}
            <select
              value={filterRegion}
              onChange={(e) => setFilterRegion(e.target.value)}
              className="text-xs px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">Todas las Regiones</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {/* Filtro Tier */}
            <select
              value={filterTier}
              onChange={(e) => setFilterTier(e.target.value)}
              className="text-xs px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">Todos los Tiers</option>
              {tiers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            {/* Filtro Grupo de Recursos */}
            <select
              value={filterRg}
              onChange={(e) => setFilterRg(e.target.value)}
              className="text-xs px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-700 dark:text-slate-300"
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

        {/* Tabla Responsive Full-Width */}
        <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredWorkspaces.length > 0 &&
                      selectedWorkspaces.length === filteredWorkspaces.length
                    }
                    onChange={toggleSelectAll}
                    className="rounded-sm border-slate-300 text-[#0054A6] focus:ring-0 cursor-pointer"
                  />
                </th>
                <ResizableTh minWidth={200} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Workspace
                </ResizableTh>
                <ResizableTh minWidth={110} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Región
                </ResizableTh>
                <ResizableTh minWidth={130} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Grupo de Recursos
                </ResizableTh>
                <ResizableTh minWidth={130} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Suscripción
                </ResizableTh>
                <ResizableTh minWidth={130} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Pricing Tier
                </ResizableTh>
                <ResizableTh minWidth={90} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Retención
                </ResizableTh>
                <ResizableTh minWidth={100} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Tope Diario
                </ResizableTh>
                <ResizableTh minWidth={110} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Ingesta MTD
                </ResizableTh>
                <ResizableTh minWidth={120} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Costo MTD
                </ResizableTh>
                <ResizableTh minWidth={150} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Recomendación
                </ResizableTh>
                <ResizableTh minWidth={100} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Ahorro Est.
                </ResizableTh>
                <th className="p-3 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-slate-400">
                    <IconLoader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0078D4]" />
                    Cargando inventario de Microsoft Sentinel...
                  </td>
                </tr>
              ) : paginatedWorkspaces.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-slate-400">
                    No se encontraron workspaces de Sentinel coincidentes con los filtros
                  </td>
                </tr>
              ) : (
                paginatedWorkspaces.map((w: SentinelResource) => {
                  const isSelected = selectedWorkspaces.includes(w.id);
                  const matchingRemediation = remediations.find(
                    (r) => r.resourceId === w.id
                  );

                  return (
                    <tr
                      key={w.id}
                      className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${
                        isSelected ? "bg-blue-50/30 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(w.id)}
                          className="rounded-sm border-slate-300 text-[#0054A6] focus:ring-0 cursor-pointer"
                        />
                      </td>

                      <td className="p-3 font-medium text-[#1B2A41] dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          <IconTopologyStarRing3 className="w-4 h-4 text-[#0078D4] shrink-0" />
                          <span className="font-semibold">{w.name}</span>
                        </div>
                      </td>

                      <td className="p-3 text-slate-500">{w.location}</td>

                      <td className="p-3 text-slate-500">{w.resourceGroup}</td>

                      <td className="p-3 text-slate-500 font-medium">
                        {w.subscriptionName}
                      </td>

                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                            w.lawPricingTier.startsWith("CapacityReservation")
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300"
                          }`}
                        >
                          {w.lawPricingTier}
                        </span>
                      </td>

                      <td className="p-3 text-slate-600 dark:text-slate-300 font-medium">
                        {w.retentionInDays} días
                      </td>

                      <td className="p-3 text-slate-500">
                        {w.dailyCapGB ? (
                          <span className="text-emerald-600 font-medium">{w.dailyCapGB} GB/d</span>
                        ) : (
                          <span className="text-amber-600 font-medium">Sin tope</span>
                        )}
                      </td>

                      <td className="p-3 text-slate-700 dark:text-slate-200 font-mono font-medium">
                        {w.totalIngestedGB_MTD.toFixed(1)} GB
                      </td>

                      <td className="p-3 font-bold text-[#0054A6]">
                        {formatCurrency(w.totalRealCostUSD)}
                      </td>

                      <td className="p-3 text-slate-600 dark:text-slate-300 font-medium">
                        {w.primaryRecommendation ? (
                          <span className="text-xs text-[#0054A6] line-clamp-1">
                            {w.primaryRecommendation.title}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">Sin cambios</span>
                        )}
                      </td>

                      <td className="p-3 font-bold text-emerald-600">
                        {matchingRemediation ? (
                          `${formatCurrency(matchingRemediation.estimatedSavingsUSD)}/mo`
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="p-3 text-right">
                        {matchingRemediation ? (
                          <button
                            onClick={() => setActiveRemediation(matchingRemediation)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg hover:bg-blue-50/50 transition-colors shadow-2xs cursor-pointer"
                          >
                            <IconSparkles className="w-3.5 h-3.5 text-[#0054A6]" />
                            Optimizar
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setActiveRemediation({
                                id: `rem-${w.id}`,
                                resourceId: w.id,
                                resourceName: w.name,
                                title: `Auditar Ingesta de '${w.name}'`,
                                description: `Evaluación de volumen y conectores en ${w.name}`,
                                category: "DAILY_CAP",
                                estimatedSavingsUSD: 50,
                                confidence: "MEDIUM",
                                actionType: "AUDIT_INGESTION",
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-[#0054A6] transition-colors cursor-pointer"
                          >
                            <IconEye className="w-3.5 h-3.5" />
                            Detalles
                          </button>
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
          totalPages={totalPages}
          pageSize={pageSize}
          total={total}
          setPage={setPage}
          setPageSize={setPageSize}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      {/* ─── Panel de Recomendaciones Priorizadas de Sentinel ─── */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-5 h-5 text-[#0078D4]" />
            <div>
              <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                Acciones de Optimización FinOps Recomendadas
              </h2>
              <p className="text-xs text-slate-500">
                Oportunidades de ahorro directo en licencias combinadas Sentinel + LAW e ingesta de telemetría
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-emerald-600">
            Ahorro Total: {formatCurrency(metrics?.potentialSavingsUSD || 0)}/mes
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {remediations.map((action) => (
            <div
              key={action.id}
              className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border ${
                      action.category === "COMMITMENT_TIER"
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : action.category === "ORPHAN_RULES"
                        ? "bg-purple-50 text-purple-700 border-purple-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {action.category.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs font-extrabold text-emerald-600">
                    ~{formatCurrency(action.estimatedSavingsUSD)}/mes
                  </span>
                </div>
                <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-1">
                  {action.title}
                </h3>
                <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed">
                  {action.description}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-[10px] text-slate-400 font-mono">
                  {action.resourceName}
                </span>
                <button
                  onClick={() => setActiveRemediation(action)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg hover:bg-blue-50/50 transition-colors shadow-2xs cursor-pointer"
                >
                  <IconSparkles className="w-3.5 h-3.5 text-[#0054A6]" />
                  Remediar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Modales ─── */}
      <SecurityMaturityModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        workspacesCount={workspaces.length}
        potentialSavings={metrics?.potentialSavingsUSD || 0}
      />

      <RemediationModal
        action={activeRemediation}
        onClose={() => setActiveRemediation(null)}
      />
    </div>
  );
}

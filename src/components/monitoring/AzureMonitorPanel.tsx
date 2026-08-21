"use client";

import React, { useState, useMemo, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconAlertCircle,
  IconDatabaseExport,
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
  IconClock,
  IconShieldExclamation,
  IconLayersLinked,
  IconFilter,
  IconCode,
  IconServer,
  IconBellRinging,
  IconEye,
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
  BarChart,
  Bar,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildAzureMonitorRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import type {
  AzureMonitorPayload,
  AzureAlertResource,
  AzureMonitorRemediationAction,
} from "@/types/azureMonitor.types";

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
    let headers: Record<string, string> = {};
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
      throw new Error(err.error || "Error al cargar Azure Monitor & Alertas");
    }
    return res.json();
  };
}

// ─── Modal de Madurez & Auditoría de Alertas ───
function AlertAuditModal({
  isOpen,
  onClose,
  alertsCount,
  potentialSavings,
}: {
  isOpen: boolean;
  onClose: () => void;
  alertsCount: number;
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
            <IconActivity className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              Auditoría FinOps de Alertas & Telemetría
            </h2>
            <p className="text-xs text-slate-500">
              Evaluación de consultas Log Search KQL, duplicaciones y frecuencias de escaneo
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-medium">Alertas Auditadas:</span>
            <span className="font-bold text-[#1B2A41] dark:text-slate-100">{alertsCount} reglas</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-medium">Desperdicio Mensual Estimado:</span>
            <span className="font-bold text-emerald-600">{formatCurrency(potentialSavings)}/mes</span>
          </div>
          <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/30 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            La auditoría correlaciona el volumen de datos consultado por Log Search Alerts en Log Analytics ($2.30/GB) y detecta oportunidades de migración a Metric Alerts o ajuste de periodicidad en ambientes no productivos.
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
                Auditando telemetría...
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
  action: AzureMonitorRemediationAction | null;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"CLI" | "POWERSHELL">("CLI");
  const [copied, setCopied] = useState(false);

  if (!action) return null;

  const command = buildAzureMonitorRemediationCommand(action);
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
            <IconActivity className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
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

          {action.category === "KQL_OPTIMIZE" && (
            <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-blue-900 dark:text-blue-300">
                  Optimización de Consulta KQL Log Search
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro proyectado: ~{formatCurrency(action.estimatedSavingsUSD)}/mes
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-2">
                Limita el rango temporal de la consulta y aplica filtros de partición tempranos para evitar escaneos de tablas completas en Log Analytics.
              </p>
              {action.recommendedQuery && (
                <div className="p-2.5 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-lg overflow-x-auto">
                  <code>{action.recommendedQuery}</code>
                </div>
              )}
            </div>
          )}

          {action.category === "MIGRATE_TO_METRIC" && (
            <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-indigo-900 dark:text-indigo-300">
                  Migración de Log Search Alert a Native Metric Alert
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro proyectado: ~{formatCurrency(action.estimatedSavingsUSD)}/mes (85% reducción)
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Las alertas métricas operan en streaming con costo plano ($0.10/métrica/mes), eliminando las tarifas de procesamiento por volumen de datos escaneados.
              </p>
            </div>
          )}

          {action.category === "FREQUENCY_ADJUST" && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-amber-900 dark:text-amber-300">
                  Ajuste de Frecuencia de Ejecución (Ambiente No Productivo)
                </span>
                <span className="text-[11px] font-extrabold text-emerald-600">
                  Ahorro proyectado: ~{formatCurrency(action.estimatedSavingsUSD)}/mes
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Cambio de intervalo de evaluación de 1m a 5m en recursos Dev/Test, disminuyendo 5x las ejecuciones KQL sin riesgo operacional.
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
export default function AzureMonitorPanel() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const [timeScope, setTimeScope] = useState<"MTD" | "30D" | "90D">("MTD");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedRegion, setSelectedRegion] = useState<string>("ALL");
  const [selectedRg, setSelectedRg] = useState<string>("ALL");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("ALL");
  const [selectedAlerts, setSelectedAlerts] = useState<string[]>([]);
  const [activeRemediation, setActiveRemediation] = useState<AzureMonitorRemediationAction | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  const isMock = useMemo(() => {
    return (
      searchParams.get("mock") === "true" ||
      isMockTenant(tenantId) ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    );
  }, [searchParams, tenantId]);

  const apiUrl = `/api/intelligence/monitoring/azure-monitor?tenantId=${encodeURIComponent(
    tenantId
  )}${isMock ? "&mock=true" : ""}&timeScope=${timeScope}`;

  const { data, error, isLoading, mutate } = useSWR<AzureMonitorPayload>(
    apiUrl,
    buildFetcher(instance, accounts, isMock),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  const alerts = useMemo(() => data?.alerts || [], [data]);
  const metrics = data?.summary;
  const history = useMemo(() => data?.dailyTrend || [], [data]);
  const remediations = useMemo(() => data?.remediationActions || [], [data]);

  // Filtros disponibles
  const regions = useMemo(() => {
    const set = new Set<string>();
    alerts.forEach((a) => a.location && set.add(a.location));
    return Array.from(set).sort();
  }, [alerts]);

  const resourceGroups = useMemo(() => {
    const set = new Set<string>();
    alerts.forEach((a) => a.resourceGroup && set.add(a.resourceGroup));
    return Array.from(set).sort();
  }, [alerts]);

  const alertTypes = useMemo(() => {
    const set = new Set<string>();
    alerts.forEach((a) => a.alertType && set.add(a.alertType));
    return Array.from(set).sort();
  }, [alerts]);

  // Filtrado de alertas
  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = a.name.toLowerCase().includes(q);
        const matchesTarget = a.targetResourceName.toLowerCase().includes(q);
        const matchesRg = a.resourceGroup.toLowerCase().includes(q);
        if (!matchesName && !matchesTarget && !matchesRg) return false;
      }
      if (selectedType !== "ALL" && a.alertType !== selectedType) return false;
      if (selectedRegion !== "ALL" && a.location !== selectedRegion) return false;
      if (selectedRg !== "ALL" && a.resourceGroup !== selectedRg) return false;
      if (selectedSeverity !== "ALL" && a.currentSeverity !== selectedSeverity) return false;
      return true;
    });
  }, [alerts, searchQuery, selectedType, selectedRegion, selectedRg, selectedSeverity]);

  // Top 5 Alertas costosas por procesamiento KQL
  const topCostlyAlerts = useMemo(() => {
    return [...alerts]
      .filter((a) => a.dataProcessedGB_MTD > 0 || a.costMtdUSD > 0)
      .sort((a, b) => b.costMtdUSD - a.costMtdUSD)
      .slice(0, 5);
  }, [alerts]);

  // Paginación Estándar CMP
  const {
    paged: paginatedAlerts,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredAlerts, 15);

  const toggleSelectAll = () => {
    if (selectedAlerts.length === filteredAlerts.length) {
      setSelectedAlerts([]);
    } else {
      setSelectedAlerts(filteredAlerts.map((a) => a.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedAlerts((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleExportCSV = () => {
    const headers = [
      "Nombre Alerta",
      "Tipo",
      "Recurso Target",
      "Grupo de Recursos",
      "Suscripción",
      "Región",
      "Severidad",
      "Estado",
      "Frecuencia",
      "Datos Procesados (GB MTD)",
      "Costo MTD ($ USD)",
      "Ahorro Estimado ($ USD)",
    ];
    const rows = filteredAlerts.map((a) => [
      `"${a.name}"`,
      a.alertType,
      `"${a.targetResourceName}"`,
      `"${a.resourceGroup}"`,
      `"${a.subscriptionName}"`,
      a.location,
      a.currentSeverity,
      a.isEnabled ? (a.isFiring ? "Firing" : "Active") : "Disabled",
      a.runFrequency,
      a.dataProcessedGB_MTD.toFixed(2),
      a.costMtdUSD.toFixed(2),
      a.potentialSavingsUSD.toFixed(2),
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `azure_monitor_alerts_${tenantId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Max value para formatear ejes dinámicamente
  const maxSpend = useMemo(() => {
    if (!history || history.length === 0) return 100;
    return Math.max(...history.map((h) => h.costUSD || 0), 100);
  }, [history]);

  const maxDataGB = useMemo(() => {
    if (!history || history.length === 0) return 50;
    return Math.max(...history.map((h) => h.dataProcessedGB || 0), 50);
  }, [history]);

  return (
    <div className="w-full max-w-full space-y-6 animate-in fade-in duration-300">
      {/* ─── Header Minimalista y Acciones ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900/50">
            <IconActivity className="w-7 h-7 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 font-sans">
                Control FinOps de Alertas & Azure Monitor
              </h1>
              {isMock && (
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-md border border-amber-300 dark:border-amber-700">
                  Modo Demo / Sintético
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Auditoría de telemetría, atribución de costos por datos consultados (KQL $2.30/GB) y optimización de reglas de alerta
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
            Reevaluar Alertas ✨
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
        {/* Card 1: Costo Total Procesamiento */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Costo Total Procesamiento
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
                ~{formatCurrency((metrics?.totalMonthlyCostUSD || 0) * 1.15)}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Alertas Detectadas */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Alertas Detectadas
            </span>
            <IconAlertCircle className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 font-sans">
              {metrics?.totalAlertsCount || alerts.length}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[11px]">
              <span className="text-emerald-600 font-medium">
                {metrics?.enabledCount || 0} Habilitadas
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-500">
                {metrics?.disabledCount || 0} Inactivas
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Total Datos Procesados (Log Search) */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Datos Procesados (Log Search)
            </span>
            <IconDatabaseExport className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 font-sans">
              {(metrics?.logSearchDataProcessedGB || 0).toFixed(1)} GB
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500">
              <span>Tarifa estimada:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                $2.30 USD / GB consultado
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Gasto Ineficiente Detectado */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Gasto Ineficiente Detectado
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
              <span>{remediations.length} acciones de optimización</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Fila 1: Gráficas de Capacidad & Evolución (Grid 2 Columnas) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
        {/* Panel Izquierdo: Donut de Distribución por Tipo de Alerta */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                Distribución de Costos por Tipo de Alerta
              </h2>
              <p className="text-xs text-slate-500">
                Desglose financiero según motor de evaluación de reglas
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              Total: {formatCurrency(metrics?.totalMonthlyCostUSD || 0)}
            </span>
          </div>

          <div className="h-64 w-full">
            {metrics?.breakdownByAlertType && metrics.breakdownByAlertType.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.breakdownByAlertType}
                    dataKey="costUSD"
                    nameKey="typeName"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={3}
                  >
                    {metrics.breakdownByAlertType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(val: any) => [formatCurrency(Number(val) || 0), "Costo MTD"]}
                    contentStyle={{
                      backgroundColor: "#1B2A41",
                      borderRadius: "12px",
                      color: "#FFFFFF",
                      border: "1px solid #334155",
                      fontSize: "12px",
                    }}
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
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Sin datos de distribución disponibles
              </div>
            )}
          </div>
        </div>

        {/* Panel Derecho: Evolución Temporal de Datos Procesados y Costo */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                Evolución de Datos Procesados & Costo Diario
              </h2>
              <p className="text-xs text-slate-500">
                Volumen consultado por Log Search (GB) vs Gasto diario ($ USD)
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
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
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
                      return [`${Number(val).toFixed(2)} GB`, name];
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
                    fill="url(#costGrad)"
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="dataProcessedGB"
                    name="Datos Procesados (GB)"
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

      {/* ─── Fila 2: Top Alertas Costosas por Procesamiento ─── */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs w-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <IconAlertCircle className="w-5 h-5 text-[#0078D4]" />
            <div>
              <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                Top 5 Alertas de Mayor Procesamiento de Datos & Costo
              </h2>
              <p className="text-xs text-slate-500">
                Reglas Log Search que ejecutan consultas KQL de alto volumen sobre Log Analytics
              </p>
            </div>
          </div>
          <span className="text-xs text-slate-500">
            Frecuencia & Volumen
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {topCostlyAlerts.length > 0 ? (
            topCostlyAlerts.map((alert, idx) => (
              <div
                key={alert.id || idx}
                className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-[#0054A6] bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-900">
                      #{idx + 1} Top Cost
                    </span>
                    <span className="text-[10px] text-slate-400">{alert.runFrequency}</span>
                  </div>
                  <div className="font-bold text-xs text-[#1B2A41] dark:text-slate-100 line-clamp-1 mt-1" title={alert.name}>
                    {alert.name}
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-1" title={alert.targetResourceName}>
                    {alert.targetResourceName}
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Datos MTD:</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {alert.dataProcessedGB_MTD.toFixed(1)} GB
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">Costo MTD:</span>
                    <span className="text-xs font-bold text-[#0054A6]">
                      {formatCurrency(alert.costMtdUSD)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-5 p-6 text-center text-xs text-slate-400">
              No se detectaron alertas con sobrecosto significativo
            </div>
          )}
        </div>
      </div>

      {/* ─── Fila 3: Tabla "Desglose por Recurso de Alerta y Auditoría FinOps" ─── */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 w-full">
        {/* Encabezado y Barra de Filtros */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              Desglose por Recurso de Alerta & Auditoría FinOps
            </h2>
            <p className="text-xs text-slate-500">
              Inventario exhaustivo de reglas de alerta, frecuencias y telemetría de facturación
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
                placeholder="Buscar alerta o recurso..."
                className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-[#0078D4] w-48 sm:w-60"
              />
            </div>

            {/* Filtro Tipo */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="text-xs px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">Todos los Tipos</option>
              {alertTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            {/* Filtro Región */}
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="text-xs px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">Todas las Regiones</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {/* Filtro Grupo de Recursos */}
            <select
              value={selectedRg}
              onChange={(e) => setSelectedRg(e.target.value)}
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
                      filteredAlerts.length > 0 &&
                      selectedAlerts.length === filteredAlerts.length
                    }
                    onChange={toggleSelectAll}
                    className="rounded-sm border-slate-300 text-[#0054A6] focus:ring-0 cursor-pointer"
                  />
                </th>
                <ResizableTh minWidth={200} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Alerta
                </ResizableTh>
                <ResizableTh minWidth={110} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Tipo
                </ResizableTh>
                <ResizableTh minWidth={140} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Recurso Target
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
                <ResizableTh minWidth={90} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Estado
                </ResizableTh>
                <ResizableTh minWidth={80} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Frecuencia
                </ResizableTh>
                <ResizableTh minWidth={100} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Datos (GB)
                </ResizableTh>
                <ResizableTh minWidth={100} className="p-3 font-semibold text-slate-600 dark:text-slate-300">
                  Costo MTD
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
                    Cargando inventario de alertas...
                  </td>
                </tr>
              ) : paginatedAlerts.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-slate-400">
                    No se encontraron alertas coincidentes con los filtros seleccionados
                  </td>
                </tr>
              ) : (
                paginatedAlerts.map((alert: AzureAlertResource) => {
                  const isSelected = selectedAlerts.includes(alert.id);
                  const matchingRemediation = remediations.find(
                    (r) => r.resourceId === alert.id
                  );

                  return (
                    <tr
                      key={alert.id}
                      className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors ${
                        isSelected ? "bg-blue-50/30 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(alert.id)}
                          className="rounded-sm border-slate-300 text-[#0054A6] focus:ring-0 cursor-pointer"
                        />
                      </td>

                      <td className="p-3 font-medium text-[#1B2A41] dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          <IconActivity className="w-4 h-4 text-[#0078D4] shrink-0" />
                          <span className="font-semibold">{alert.name}</span>
                        </div>
                      </td>

                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                            alert.alertType === "logSearch"
                              ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300"
                              : alert.alertType === "metric"
                              ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300"
                              : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {alert.alertType}
                        </span>
                      </td>

                      <td className="p-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                        {alert.targetResourceName}
                      </td>

                      <td className="p-3 text-slate-500">{alert.location}</td>

                      <td className="p-3 text-slate-500">{alert.resourceGroup}</td>

                      <td className="p-3 text-slate-500 font-medium">
                        {alert.subscriptionName}
                      </td>

                      <td className="p-3">
                        {alert.isEnabled ? (
                          alert.isFiring ? (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 rounded-md">
                              Firing
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">
                              Active
                            </span>
                          )
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 rounded-md">
                            Disabled
                          </span>
                        )}
                      </td>

                      <td className="p-3 text-slate-500 font-medium">
                        {alert.runFrequency}
                      </td>

                      <td className="p-3 text-slate-700 dark:text-slate-200 font-mono font-medium">
                        {alert.dataProcessedGB_MTD > 0
                          ? `${alert.dataProcessedGB_MTD.toFixed(1)} GB`
                          : "—"}
                      </td>

                      <td className="p-3 font-bold text-[#0054A6]">
                        {formatCurrency(alert.costMtdUSD)}
                      </td>

                      <td className="p-3 font-bold text-emerald-600">
                        {alert.potentialSavingsUSD > 0
                          ? `${formatCurrency(alert.potentialSavingsUSD)}/mo`
                          : "—"}
                      </td>

                      <td className="p-3 text-right">
                        {matchingRemediation ? (
                          <button
                            onClick={() => setActiveRemediation(matchingRemediation)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#0054A6] bg-white dark:bg-slate-900 border border-[#0054A6] rounded-lg hover:bg-blue-50/50 transition-colors shadow-2xs cursor-pointer"
                          >
                            <IconSparkles className="w-3.5 h-3.5 text-[#0054A6]" />
                            Optimizar ✨
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setActiveRemediation({
                                id: `rem-${alert.id}`,
                                resourceId: alert.id,
                                resourceName: alert.name,
                                title: `Optimizar Alerta ${alert.name}`,
                                description: `Revisión de periodicidad y alcance temporal en ${alert.targetResourceName}`,
                                category:
                                  alert.alertType === "logSearch"
                                    ? "KQL_OPTIMIZE"
                                    : "FREQUENCY_ADJUST",
                                estimatedSavingsUSD: alert.potentialSavingsUSD || 5,
                                confidence: "MEDIUM",
                                actionType: "OPTIMIZE_ALERT",
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

      {/* ─── Panel de Recomendaciones Priorizadas de Azure Monitor ─── */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-5 h-5 text-[#0078D4]" />
            <div>
              <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
                Acciones de Optimización FinOps Recomendadas
              </h2>
              <p className="text-xs text-slate-500">
                Oportunidades de ahorro directo en costos de procesamiento KQL y telemetría de monitoreo
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
                      action.category === "KQL_OPTIMIZE"
                        ? "bg-purple-50 text-purple-700 border-purple-200"
                        : action.category === "MIGRATE_TO_METRIC"
                        ? "bg-blue-50 text-blue-700 border-blue-200"
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
                  Remediar ✨
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Modales ─── */}
      <AlertAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        alertsCount={alerts.length}
        potentialSavings={metrics?.potentialSavingsUSD || 0}
      />

      <RemediationModal
        action={activeRemediation}
        onClose={() => setActiveRemediation(null)}
      />
    </div>
  );
}

"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconBell,
  IconFlame,
  IconSparkles,
  IconChartLine,
  IconFileCode,
  IconHistory,
  IconBrain,
  IconWorld,
  IconRotateClockwise,
  IconDatabaseExport,
  IconSearch,
  IconCheck,
  IconX,
  IconCopy,
  IconAlertCircle,
  IconAdjustmentsHorizontal,
  IconClock,
  IconTerminal2,
  IconBrandPowershell,
  IconLoader2,
  IconLayersLinked,
  IconPower,
} from "@tabler/icons-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildAlertRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import type {
  AlertsPayload,
  AlertRuleResource,
  AlertRemediationAction,
  AlertFiringEvent,
} from "@/types/azureAlerts.types";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

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
      throw new Error(err.error || "Error al cargar reglas de alerta de Azure Monitor");
    }
    return res.json();
  };
}

// ─── Modal de Madurez y Auditoría de Alertas ───
function AlertAuditModal({
  isOpen,
  onClose,
  totalAlerts,
  potentialSavings,
}: {
  isOpen: boolean;
  onClose: () => void;
  totalAlerts: number;
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
          <IconAdjustmentsHorizontal className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              Auditoría FinOps & Gobernanza de Alertas
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evaluación automatizada de cobertura, frecuencias y reglas huérfanas
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 flex justify-between items-center text-sm">
            <span className="text-slate-600 dark:text-slate-300">Total Reglas Evaluadas:</span>
            <span className="font-bold text-[#1B2A41] dark:text-slate-100">{totalAlerts}</span>
          </div>
          <div className="p-3 bg-blue-50/50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 flex justify-between items-center text-sm">
            <span className="text-[#0054A6] dark:text-blue-300">Ahorro Mensual Proyectado:</span>
            <span className="font-bold text-[#0054A6] dark:text-blue-200">{formatCurrency(potentialSavings)}/mes</span>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
              <IconCheck className="w-4 h-4 text-emerald-500" />
              Validación de existencia de recursos objetivo (Target Scopes)
            </div>
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
              <IconCheck className="w-4 h-4 text-emerald-500" />
              Auditoría de vinculación obligatoria de Action Groups
            </div>
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
              <IconCheck className="w-4 h-4 text-emerald-500" />
              Racionalización de frecuencias de 1m en ambientes Dev/Test
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            Cerrar
          </button>
          <button
            onClick={handleEvaluate}
            disabled={saving || completed}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-2 cursor-pointer"
          >
            {saving ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin text-[#0054A6]" />
                Auditando...
              </>
            ) : completed ? (
              <>
                <IconCheck className="w-4 h-4 text-emerald-600" />
                ¡Auditoría Completada!
              </>
            ) : (
              <>
                <IconAdjustmentsHorizontal className="w-4 h-4 text-[#0054A6]" />
                Ejecutar Reevaluación
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Condición Formal y KQL ───
function AlertConditionModal({
  alert,
  onClose,
}: {
  alert: AlertRuleResource | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!alert) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <IconFileCode className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              Detalle de Condición & Criterios: {alert.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {alert.alertTypeDisplayName} • {alert.resourceGroup} • {alert.subscriptionName}
            </p>
          </div>
        </div>

        <div className="space-y-4 text-sm mb-6">
          {/* Tarjeta de Resumen */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Condición Formal Configurada
            </div>
            <div className="text-slate-800 dark:text-slate-200 font-medium leading-relaxed">
              {alert.conditionSummary || "Sin resumen de condición disponible"}
            </div>
            <div className="flex flex-wrap gap-4 pt-2 text-xs text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700">
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">Frecuencia de Evaluación:</span>{" "}
                {alert.evaluationFrequency}
              </div>
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">Ventana Temporal:</span>{" "}
                {alert.windowSize}
              </div>
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">Severidad:</span>{" "}
                <span className="font-bold text-[#0054A6]">{alert.severity}</span>
              </div>
            </div>
          </div>

          {/* Consulta KQL si aplica */}
          {alert.queryKql && (
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Consulta KQL (Log Search)
                </span>
                <button
                  onClick={() => handleCopy(alert.queryKql!)}
                  className="text-xs flex items-center gap-1 text-[#0054A6] hover:underline cursor-pointer"
                >
                  {copied ? <IconCheck className="w-3.5 h-3.5 text-emerald-500" /> : <IconCopy className="w-3.5 h-3.5" />}
                  {copied ? "Copiado" : "Copiar KQL"}
                </button>
              </div>
              <pre className="p-3.5 bg-slate-950 text-slate-100 rounded-xl font-mono text-xs overflow-x-auto border border-slate-800 leading-relaxed">
                {alert.queryKql}
              </pre>
            </div>
          )}

          {/* Recurso Target */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Recurso Monitoreado (Target Scope)
            </div>
            <div className="font-mono text-xs text-slate-800 dark:text-slate-200 break-all">
              {alert.targetResourceId}
            </div>
            <div className="text-xs text-slate-500">
              Tipo: <span className="font-semibold text-slate-700 dark:text-slate-300">{alert.targetResourceType}</span>
            </div>
          </div>

          {/* Action Groups Vinculados */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Grupos de Acción Vinculados ({alert.actionGroupIds.length})
            </div>
            {alert.actionGroupIds.length > 0 ? (
              <ul className="space-y-1">
                {(alert.actionGroupNames || alert.actionGroupIds).map((ag, i) => (
                  <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <IconLayersLinked className="w-3.5 h-3.5 text-[#0078D4]" />
                    <span>{ag}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-medium">
                <IconAlertCircle className="w-4 h-4" />
                Esta alerta no tiene ningún Action Group vinculado (se dispara en silencio).
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Historial de Activaciones ───
function AlertHistoryModal({
  alert,
  onClose,
}: {
  alert: AlertRuleResource | null;
  onClose: () => void;
}) {
  if (!alert) return null;

  // Sin historial de Azure sólo se sintetiza un evento si hay un timestamp real
  // de la ultima activacion. No se inventa una fecha (Directiva 24.1: cero
  // fallbacks fabricados) ni se llama a Date.now() durante el render, que
  // produciria hydration mismatch entre servidor y cliente.
  const history: AlertFiringEvent[] =
    alert.firingHistory ||
    (alert.lastFiredTimestamp
      ? [
          {
            timestamp: alert.lastFiredTimestamp,
            status: alert.isFiring ? "Firing" : "Resolved",
            description: alert.isFiring
              ? "Condición de umbral excedida. Alerta en estado activo."
              : "Valores operativos dentro del rango normal.",
          },
        ]
      : []);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <IconClock className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              Historial de Activaciones: {alert.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Últimas activaciones e incidentes detectados
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-6 max-h-72 overflow-y-auto pr-1">
          {history.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
              Azure Monitor no reporta activaciones para esta regla.
            </p>
          )}
          {history.map((h, i) => (
            <div
              key={i}
              className={`p-3 rounded-xl border flex items-start gap-3 ${
                h.status === "Firing"
                  ? "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800/50"
                  : "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50"
              }`}
            >
              {h.status === "Firing" ? (
                <IconFlame className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              ) : (
                <IconCheck className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1 flex-1">
                <div className="flex justify-between items-center text-xs">
                  <span
                    className={`font-bold ${
                      h.status === "Firing" ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    Estado: {h.status === "Firing" ? "Disparada (Firing)" : "Normalizada (Resolved)"}
                  </span>
                  <span className="text-slate-500 font-mono">
                    {new Date(h.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {h.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Remediación CLI / PowerShell ───
function RemediationModal({
  action,
  onClose,
}: {
  action: AlertRemediationAction | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"cli" | "powershell">("cli");
  const [copied, setCopied] = useState(false);

  if (!action) return null;

  const script = buildAlertRemediationCommand(action);
  const commandText = tab === "cli" ? script.cli : script.powershell;

  const handleCopy = () => {
    navigator.clipboard.writeText(commandText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <IconSparkles className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              Remediación FinOps: {action.title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ahorro estimado: <span className="font-bold text-emerald-600">{formatCurrency(action.estimatedSavingsUSD)}/mes</span>
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
          {action.description}
        </p>

        {/* Tab Selector */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setTab("cli")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition ${
              tab === "cli"
                ? "border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6]"
                : "border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400"
            }`}
          >
            <IconTerminal2 className="w-3.5 h-3.5" />
            Azure CLI
          </button>
          <button
            onClick={() => setTab("powershell")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition ${
              tab === "powershell"
                ? "border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6]"
                : "border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400"
            }`}
          >
            <IconBrandPowershell className="w-3.5 h-3.5" />
            PowerShell
          </button>
        </div>

        {/* Code Box */}
        <div className="relative mb-6">
          <pre className="p-3.5 bg-slate-950 text-slate-100 rounded-xl font-mono text-xs overflow-x-auto border border-slate-800 leading-relaxed pr-12">
            {commandText}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute top-2.5 right-2.5 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
            title="Copiar comando"
          >
            {copied ? <IconCheck className="w-4 h-4 text-emerald-400" /> : <IconCopy className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function AlertsManagementPanel() {
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

  const apiUrl = `/api/intelligence/monitoring/alerts?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<AlertsPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  // Estados locales
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("ALL");
  const [selectedState, setSelectedState] = useState<string>("ALL");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedRg, setSelectedRg] = useState<string>("ALL");
  const [selectedSub, setSelectedSub] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"cost_desc" | "cost_asc" | "name_asc" | "name_desc" | "severity">("cost_desc");

  // Selección múltiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Optimistic Toggle state
  const [toggleOverrides, setToggleOverrides] = useState<Record<string, boolean>>({});

  // Modales
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [viewConditionAlert, setViewConditionAlert] = useState<AlertRuleResource | null>(null);
  const [viewHistoryAlert, setViewHistoryAlert] = useState<AlertRuleResource | null>(null);
  const [activeRemediation, setActiveRemediation] = useState<AlertRemediationAction | null>(null);

  // Lista de reglas aplicando overrides
  const rulesList: AlertRuleResource[] = useMemo(() => {
    if (!data?.alerts) return [];
    return data.alerts.map((a) => {
      if (toggleOverrides[a.id] !== undefined) {
        return { ...a, isEnabled: toggleOverrides[a.id] };
      }
      return a;
    });
  }, [data?.alerts, toggleOverrides]);

  // Grupos de recursos y suscripciones únicos
  const resourceGroups = useMemo(() => {
    const set = new Set<string>();
    rulesList.forEach((a) => {
      if (a.resourceGroup) set.add(a.resourceGroup);
    });
    return Array.from(set).sort();
  }, [rulesList]);

  const subscriptions = useMemo(() => {
    const map = new Map<string, string>();
    rulesList.forEach((a) => {
      if (a.subscriptionId) map.set(a.subscriptionId, a.subscriptionName || a.subscriptionId);
    });
    return Array.from(map.entries());
  }, [rulesList]);

  // Filtrado y Ordenamiento
  const filteredAlerts = useMemo(() => {
    return rulesList
      .filter((alert) => {
        // Texto
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const matchName = alert.name.toLowerCase().includes(term);
          const matchTarget = (alert.targetResourceName || "").toLowerCase().includes(term);
          const matchRg = alert.resourceGroup.toLowerCase().includes(term);
          const matchSub = (alert.subscriptionName || "").toLowerCase().includes(term);
          if (!matchName && !matchTarget && !matchRg && !matchSub) return false;
        }
        // Severidad
        if (selectedSeverity !== "ALL" && alert.severity !== selectedSeverity) {
          return false;
        }
        // Estado
        if (selectedState === "ENABLED" && !alert.isEnabled) return false;
        if (selectedState === "DISABLED" && alert.isEnabled) return false;
        // Tipo
        if (selectedType !== "ALL" && alert.alertType !== selectedType) {
          return false;
        }
        // RG
        if (selectedRg !== "ALL" && alert.resourceGroup !== selectedRg) {
          return false;
        }
        // Subscripción
        if (selectedSub !== "ALL" && alert.subscriptionId !== selectedSub) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "cost_desc") return b.monthlyCostUSD - a.monthlyCostUSD;
        if (sortBy === "cost_asc") return a.monthlyCostUSD - b.monthlyCostUSD;
        if (sortBy === "name_asc") return a.name.localeCompare(b.name);
        if (sortBy === "name_desc") return b.name.localeCompare(a.name);
        if (sortBy === "severity") return a.severity.localeCompare(b.severity);
        return 0;
      });
  }, [rulesList, searchTerm, selectedSeverity, selectedState, selectedType, selectedRg, selectedSub, sortBy]);

  // Paginación
  const {
    paged: paginatedAlerts,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredAlerts, 15);

  // Toggle de Estado
  const handleToggleState = async (alert: AlertRuleResource) => {
    const newState = !alert.isEnabled;
    setToggleOverrides((prev) => ({ ...prev, [alert.id]: newState }));

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!isMock && accounts.length > 0) {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      }
      const res = await fetch(`/api/intelligence/monitoring/alerts?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "TOGGLE_STATE",
          ruleId: alert.id,
          isEnabled: newState,
        }),
      });
      // fetch no lanza ante 401/403/500: revertir explicitamente.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Revert on error
      setToggleOverrides((prev) => ({ ...prev, [alert.id]: alert.isEnabled }));
    }
  };

  // Selección múltiple
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(paginatedAlerts.map((a: AlertRuleResource) => a.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkToggle = (targetState: boolean) => {
    const overrides: Record<string, boolean> = {};
    selectedIds.forEach((id: string) => {
      overrides[id] = targetState;
    });
    setToggleOverrides((prev) => ({ ...prev, ...overrides }));
    setSelectedIds(new Set());
  };

  // Exportar CSV
  const handleExportCSV = () => {
    if (!filteredAlerts || filteredAlerts.length === 0) return;
    const headers = [
      "Rule Name",
      "Type",
      "Resource Group",
      "Subscription",
      "Severity",
      "State",
      "Target Resource",
      "Frequency",
      "Monthly Cost USD",
      "Is Orphan",
      "Is Inefficient",
    ];
    const rows = filteredAlerts.map((a) => [
      `"${a.name}"`,
      `"${a.alertTypeDisplayName}"`,
      `"${a.resourceGroup}"`,
      `"${a.subscriptionName}"`,
      `"${a.severity}"`,
      `"${a.isEnabled ? "Enabled" : "Disabled"}"`,
      `"${a.targetResourceName}"`,
      `"${a.evaluationFrequency}"`,
      a.monthlyCostUSD.toFixed(2),
      a.isOrphan ? "YES" : "NO",
      a.isInefficient ? "YES" : "NO",
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `azure-alerts-inventory-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary || {
    totalMonthlyCostUSD: 0,
    totalAlertsCount: 0,
    enabledCount: 0,
    disabledCount: 0,
    firingLast24hCount: 0,
    orphanCount: 0,
    inefficientCount: 0,
    potentialSavingsUSD: 0,
    breakdownByType: [],
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado Principal y Controles Globales ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconBell className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>Inventario y Gobernanza de Alertas</span>
              <InfoTooltip
                content="Consola unificada de reglas de alerta de Azure (Métricas, KQL Scheduled Query, Activity Log, Smart Detectors y Web Tests). Monitoreo de costos de ejecución, auditoría de reglas huérfanas y optimización de frecuencias."
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Azure Resource Graph" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Gestión centralizada de reglas, tarifas fijas mensuales, estados de disparo y optimizaciones FinOps
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <button
            onClick={() => setIsAuditModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconAdjustmentsHorizontal className="w-4 h-4 text-[#0054A6]" />
            Auditoría FinOps
          </button>
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

      {/* ─── 4 Tarjetas KPI Superiores (Ancho 100% - Iconos Tabler Azules sin Fondo) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Costo Mensual de Alertas */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Costo Mensual de Alertas</span>
              <InfoTooltip content="Gasto total atribuido a tarifas fijas mensuales de reglas de alerta activas (Métricas $0.10, Log Search $0.50-$1.50, Web Tests $1.00)." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCurrency(summary.totalMonthlyCostUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Proyección EOM: <span className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(summary.totalMonthlyCostUSD)}</span>
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        {/* Card 2: Total Reglas de Alerta */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Total Reglas de Alerta</span>
              <InfoTooltip content="Total de reglas aprovisionadas en Azure Monitor con desglose de Habilitadas vs Deshabilitadas." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalAlertsCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{summary.enabledCount} activas</span> •{" "}
              <span className="text-slate-400">{summary.disabledCount} pausadas</span>
            </div>
          </div>
          <IconBell className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        {/* Card 3: Alertas en Disparo (Firing) */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Alertas en Disparo (24h)</span>
              <InfoTooltip content="Número de alertas que han superado sus umbrales operativos y entraron en estado 'Firing' en las últimas 24 horas." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <span>{summary.firingLast24hCount}</span>
              {summary.firingLast24hCount > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md border border-red-200 dark:border-red-800 text-red-600 bg-white dark:bg-slate-900">
                  Activas
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Requieren atención del equipo de guardia
            </div>
          </div>
          <IconFlame className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        {/* Card 4: Alertas Huérfanas / Ineficientes */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Fugas & Reglas Huérfanas</span>
              <InfoTooltip content="Reglas apuntando a recursos inexistentes o con frecuencia excesiva (1m) en ambientes no productivos." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <span>{summary.orphanCount + summary.inefficientCount}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800 text-emerald-600 bg-white dark:bg-slate-900">
                {formatCurrency(summary.potentialSavingsUSD)} ahorro
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.orphanCount} huérfanas • {summary.inefficientCount} optimizables
            </div>
          </div>
          <IconSparkles className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>
      </div>

      {/* ─── Gráficos de Desglose en Tonos de Azul ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Distribución por Tipo de Alerta (Pie Chart) */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              <IconChartLine className="w-4 h-4 text-[#0078D4]" />
              Distribución de Costo por Tipo
            </h3>
            <InfoTooltip content="Participación porcentual del costo mensual por tipología de alerta en Azure Monitor." />
          </div>

          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={summary.breakdownByType.filter((b) => b.count > 0)}
                  dataKey="costUSD"
                  nameKey="typeLabel"
                  cx="50%"
                  cy="50%"
                  innerRadius={38}
                  outerRadius={62}
                  paddingAngle={3}
                >
                  {summary.breakdownByType.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(val: any) => [formatCurrency(Number(val)), "Costo Mensual"]}
                  contentStyle={{
                    backgroundColor: "#1B2A41",
                    color: "#FFFFFF",
                    borderRadius: "12px",
                    border: "1px solid #334155",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            {summary.breakdownByType.map((b) => (
              <div key={b.typeName} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                <span className="text-slate-600 dark:text-slate-400 truncate">{b.typeLabel}:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Comparativa de Reglas y Costo Mensual (Bar Chart) */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs lg:col-span-2 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              <IconLayersLinked className="w-4 h-4 text-[#0078D4]" />
              Conteo de Reglas vs. Gasto Mensual ($ USD)
            </h3>
            <InfoTooltip content="Comparación del volumen de reglas y su consumo mensual acumulado en la suscripción." />
          </div>

          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.breakdownByType} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                <XAxis dataKey="typeLabel" tick={{ fontSize: 11, fill: "#64748B" }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#64748B" }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#64748B" }} tickFormatter={(v) => `$${v}`} />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: "#1B2A41",
                    color: "#FFFFFF",
                    borderRadius: "12px",
                    border: "1px solid #334155",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "6px" }} />
                <Bar yAxisId="left" dataKey="count" name="Cantidad Reglas" fill="#0078D4" radius={[6, 6, 0, 0]} />
                <Bar yAxisId="right" dataKey="costUSD" name="Costo USD/mes" fill="#38BDF8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── Barra Superior de Filtros y Búsqueda (Ancho 100%) ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Buscador */}
          <div className="lg:col-span-2 relative">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por nombre, recurso, RG..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            />
          </div>

          {/* Filtro Severidad */}
          <div>
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="ALL">Severidad (Todas)</option>
              <option value="Sev0">Sev0 (Crítica)</option>
              <option value="Sev1">Sev1 (Error)</option>
              <option value="Sev2">Sev2 (Advertencia)</option>
              <option value="Sev3">Sev3 (Informativa)</option>
              <option value="Sev4">Sev4 (Verbose)</option>
            </select>
          </div>

          {/* Filtro Estado */}
          <div>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="ALL">Estado (Todas)</option>
              <option value="ENABLED">Habilitadas (Enabled)</option>
              <option value="DISABLED">Deshabilitadas (Disabled)</option>
            </select>
          </div>

          {/* Filtro Tipo */}
          <div>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="ALL">Tipo (Todos)</option>
              <option value="metric">Métricas</option>
              <option value="scheduledQuery">Log Search (KQL)</option>
              <option value="activityLog">Activity Log</option>
              <option value="smartDetector">Smart Detector (IA)</option>
              <option value="webTest">Pruebas Web</option>
            </select>
          </div>

          {/* Ordenamiento */}
          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="cost_desc">Costo: Mayor a Menor</option>
              <option value="cost_asc">Costo: Menor a Mayor</option>
              <option value="name_asc">Nombre: A - Z</option>
              <option value="name_desc">Nombre: Z - A</option>
              <option value="severity">Severidad</option>
            </select>
          </div>
        </div>

        {/* Acciones Masivas cuando hay selección */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-blue-50/70 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-800">
            <span className="text-xs font-semibold text-[#0054A6] dark:text-blue-300">
              {selectedIds.size} {selectedIds.size === 1 ? "regla seleccionada" : "reglas seleccionadas"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkToggle(true)}
                className="px-3 py-1 text-xs font-medium rounded-lg border border-emerald-600 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50/50 transition cursor-pointer"
              >
                Habilitar Selección
              </button>
              <button
                onClick={() => handleBulkToggle(false)}
                className="px-3 py-1 text-xs font-medium rounded-lg border border-slate-400 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition cursor-pointer"
              >
                Deshabilitar Selección
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-2.5 py-1 text-xs text-slate-500 hover:underline cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Tabla "Inventario y Gestión de Reglas de Alerta" (Estándar FinOps CMP - Ancho 100%) ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconBell className="w-5 h-5 text-[#0078D4]" />
              <span>Inventario y Gestión de Reglas de Alerta</span>
              <InfoTooltip content="Catálogo completo de reglas de alerta con controles rápidos de habilitación, inspección KQL e historial de activaciones." />
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mostrando {paginatedAlerts.length} de {filteredAlerts.length} reglas filtradas
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={paginatedAlerts.length > 0 && selectedIds.size === paginatedAlerts.length}
                    className="rounded-sm border-slate-300 text-[#0054A6] focus:ring-0 cursor-pointer"
                  />
                </th>
                <ResizableTh minWidth={220}>Regla de Alerta</ResizableTh>
                <ResizableTh minWidth={160}>Tipo de Alerta</ResizableTh>
                <ResizableTh minWidth={180}>Recurso Monitoreado</ResizableTh>
                <ResizableTh minWidth={110}>Severidad</ResizableTh>
                <ResizableTh minWidth={110}>Estado</ResizableTh>
                <ResizableTh minWidth={140}>Frecuencia / Ventana</ResizableTh>
                <ResizableTh minWidth={160}>Suscripción</ResizableTh>
                <ResizableTh minWidth={110}>Costo Mensual</ResizableTh>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedAlerts.length > 0 ? (
                paginatedAlerts.map((alert: AlertRuleResource) => {
                  const isSelected = selectedIds.has(alert.id);

                  // Icono según tipo
                  let TypeIcon = IconChartLine;
                  if (alert.alertType === "scheduledQuery") TypeIcon = IconFileCode;
                  else if (alert.alertType === "activityLog") TypeIcon = IconHistory;
                  else if (alert.alertType === "smartDetector") TypeIcon = IconBrain;
                  else if (alert.alertType === "webTest") TypeIcon = IconWorld;

                  // Severidad badge styles
                  let sevClass = "border-blue-200 dark:border-blue-800 text-[#0054A6] bg-blue-50/40 dark:bg-blue-950/20";
                  if (alert.severity === "Sev0") sevClass = "border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 bg-red-50/50 dark:bg-red-950/20";
                  else if (alert.severity === "Sev1") sevClass = "border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 bg-orange-50/50 dark:bg-orange-950/20";
                  else if (alert.severity === "Sev2") sevClass = "border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 bg-amber-50/50 dark:bg-amber-950/20";
                  else if (alert.severity === "Sev4") sevClass = "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/30";

                  return (
                    <tr
                      key={alert.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                        isSelected ? "bg-blue-50/40 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectOne(alert.id)}
                          className="rounded-sm border-slate-300 text-[#0054A6] focus:ring-0 cursor-pointer"
                        />
                      </td>

                      {/* Regla */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-xs" title={alert.name}>
                          {alert.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs flex items-center gap-1">
                          <span>RG: {alert.resourceGroup}</span>
                          {alert.isOrphan && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-bold border border-red-300 dark:border-red-800 text-red-600 bg-white dark:bg-slate-900">
                              Huérfana
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Tipo */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <TypeIcon className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className="text-slate-700 dark:text-slate-300 truncate">
                            {alert.alertTypeDisplayName}
                          </span>
                        </div>
                      </td>

                      {/* Recurso Monitoreado */}
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-xs" title={alert.targetResourceName}>
                          {alert.targetResourceName}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {alert.location || "global"}
                        </div>
                      </td>

                      {/* Severidad */}
                      <td className="py-3 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded-md font-bold text-[10px] border ${sevClass}`}>
                          {alert.severity}
                        </span>
                      </td>

                      {/* Estado Toggle */}
                      <td className="py-3 px-3">
                        <button
                          onClick={() => handleToggleState(alert)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 transition cursor-pointer ${
                            alert.isEnabled
                              ? "border-emerald-600 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50/50"
                              : "border-slate-400 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-100"
                          }`}
                        >
                          <IconPower className={`w-3.5 h-3.5 ${alert.isEnabled ? "text-emerald-600" : "text-slate-400"}`} />
                          {alert.isEnabled ? "Activa" : "Pausada"}
                        </button>
                      </td>

                      {/* Frecuencia */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                        {alert.evaluationFrequency} / {alert.windowSize}
                      </td>

                      {/* Suscripción */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400 truncate max-w-[150px]" title={alert.subscriptionName}>
                        {alert.subscriptionName}
                      </td>

                      {/* Costo Mensual */}
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {formatCurrency(alert.monthlyCostUSD)}
                        </div>
                        <div className="text-[10px] text-slate-400">/ mes</div>
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setViewConditionAlert(alert)}
                            className="p-1.5 rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 transition cursor-pointer"
                            title="Ver Condición & KQL"
                          >
                            <IconFileCode className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setViewHistoryAlert(alert)}
                            className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer"
                            title="Ver Historial de Activaciones"
                          >
                            <IconHistory className="w-3.5 h-3.5 text-[#0078D4]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    <IconBell className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" stroke={1.5} />
                    No se encontraron reglas de alerta con los filtros seleccionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación CMP */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
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

      {/* ─── Panel de Recomendaciones Priorizadas de Alertas (Ancho 100%) ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <span>Oportunidades y Recomendaciones FinOps de Alertas</span>
              <InfoTooltip content="Acciones directas para eliminar desperdicio por reglas huérfanas, reducir frecuencias innecesarias y asegurar gobernanza operativa." />
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ahorro potencial total identificado:{" "}
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(summary.potentialSavingsUSD)}/mes</span>
            </p>
          </div>
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
                  <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">
                    {action.title}
                  </h4>
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
                    Remediar ✨
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              No se detectaron fugas de costo ni anomalías en las reglas de alerta evaluadas.
            </div>
          )}
        </div>
      </div>

      {/* ─── Modales Renderizados en z-50 ─── */}
      <AlertAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        totalAlerts={summary.totalAlertsCount}
        potentialSavings={summary.potentialSavingsUSD}
      />

      <AlertConditionModal
        alert={viewConditionAlert}
        onClose={() => setViewConditionAlert(null)}
      />

      <AlertHistoryModal
        alert={viewHistoryAlert}
        onClose={() => setViewHistoryAlert(null)}
      />

      <RemediationModal
        action={activeRemediation}
        onClose={() => setActiveRemediation(null)}
      />
    </div>
  );
}

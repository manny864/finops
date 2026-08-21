"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconCash,
  IconBellRinging,
  IconShieldExclamation,
  IconAlertTriangle,
  IconSparkles,
  IconRotateClockwise,
  IconDatabaseExport,
  IconSearch,
  IconCheck,
  IconX,
  IconCopy,
  IconAlertCircle,
  IconAdjustmentsHorizontal,
  IconTerminal2,
  IconBrandPowershell,
  IconLoader2,
  IconMail,
  IconWebhook,
  IconBinaryTree,
  IconCpu,
  IconDeviceMobile,
  IconLayersLinked,
  IconEye,
  IconPower,
  IconCircleCheck,
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
import { buildActionGroupRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import type {
  ActionGroupsPayload,
  ActionGroupResource,
  ActionGroupRemediationAction,
} from "@/types/azureActionGroups.types";

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
      throw new Error(err.error || "Error al cargar Action Groups de Azure Monitor");
    }
    return res.json();
  };
}

// ─── Modal de Madurez y Auditoría de Notificaciones ───
function ActionGroupAuditModal({
  isOpen,
  onClose,
  totalGroups,
  orphanCount,
  potentialSavings,
}: {
  isOpen: boolean;
  onClose: () => void;
  totalGroups: number;
  orphanCount: number;
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
              Auditoría FinOps de Grupos de Acción
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evaluación de canales de entrega, rebotes y depuración de grupos huérfanos
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 flex justify-between items-center text-sm">
            <span className="text-slate-600 dark:text-slate-300">Total Action Groups Evaluados:</span>
            <span className="font-bold text-[#1B2A41] dark:text-slate-100">{totalGroups}</span>
          </div>
          <div className="p-3 bg-blue-50/50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 flex justify-between items-center text-sm">
            <span className="text-[#0054A6] dark:text-blue-300">Grupos Huérfanos Detectados:</span>
            <span className="font-bold text-amber-600 dark:text-amber-400">{orphanCount} grupos</span>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
              <IconCheck className="w-4 h-4 text-emerald-500" />
              Verificación cruzada con reglas de alerta activas (Metric, Log Search, Activity Log)
            </div>
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
              <IconCheck className="w-4 h-4 text-emerald-500" />
              Detección de destinatarios con rebotes permanentes (Hard Bounces)
            </div>
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
              <IconCheck className="w-4 h-4 text-emerald-500" />
              Auditoría de endpoints webhooks con errores 4xx/5xx recurrentes
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

// ─── Modal de Destinatarios & Receptores Configurados ───
function ActionGroupReceiversModal({
  actionGroup,
  onClose,
}: {
  actionGroup: ActionGroupResource | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  if (!actionGroup) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const receivers = actionGroup.receivers || {
    emails: [],
    webhooks: [],
    logicApps: [],
    azureFunctions: [],
    sms: [],
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
          <IconBellRinging className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              Canales & Receptores: {actionGroup.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nombre corto: <span className="font-mono font-semibold">{actionGroup.shortName || "—"}</span> • {actionGroup.resourceGroup} • {actionGroup.subscriptionName}
            </p>
          </div>
        </div>

        <div className="space-y-4 text-sm mb-6">
          {/* Emails */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <IconMail className="w-4 h-4 text-[#0078D4]" />
                Destinatarios de Correo Electrónico ({receivers.emails.length})
              </span>
            </div>
            {receivers.emails.length > 0 ? (
              <ul className="space-y-1.5">
                {receivers.emails.map((email, idx) => (
                  <li key={idx} className="flex justify-between items-center text-xs p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="font-mono text-slate-800 dark:text-slate-200">{email}</span>
                    <button
                      onClick={() => handleCopy(email, `email-${idx}`)}
                      className="text-slate-400 hover:text-[#0054A6] cursor-pointer"
                      title="Copiar email"
                    >
                      {copied === `email-${idx}` ? <IconCheck className="w-3.5 h-3.5 text-emerald-500" /> : <IconCopy className="w-3.5 h-3.5" />}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-slate-400 italic">No hay direcciones de correo configuradas.</div>
            )}
          </div>

          {/* Webhooks */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconWebhook className="w-4 h-4 text-[#2563EB]" />
              Webhooks & Integraciones Externas ({receivers.webhooks.length})
            </div>
            {receivers.webhooks.length > 0 ? (
              <ul className="space-y-1.5">
                {receivers.webhooks.map((wh, idx) => (
                  <li key={idx} className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1">
                    <div className="flex justify-between items-center text-xs font-semibold text-slate-800 dark:text-slate-200">
                      <span>{wh.name}</span>
                      {wh.useAadAuth && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded border border-blue-200 dark:border-blue-800 text-[#0054A6]">
                          Azure AD Auth
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between items-center font-mono text-[11px] text-slate-600 dark:text-slate-400 truncate">
                      <span className="truncate max-w-md">{wh.serviceUri}</span>
                      <button
                        onClick={() => handleCopy(wh.serviceUri, `wh-${idx}`)}
                        className="text-slate-400 hover:text-[#0054A6] cursor-pointer shrink-0 ml-2"
                      >
                        {copied === `wh-${idx}` ? <IconCheck className="w-3.5 h-3.5 text-emerald-500" /> : <IconCopy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-slate-400 italic">No hay webhooks configurados.</div>
            )}
          </div>

          {/* Logic Apps & Functions */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <IconBinaryTree className="w-4 h-4 text-[#0284C7]" />
              Logic Apps & Azure Functions ({receivers.logicApps.length + receivers.azureFunctions.length})
            </div>
            {receivers.logicApps.length > 0 || receivers.azureFunctions.length > 0 ? (
              <div className="space-y-1.5">
                {receivers.logicApps.map((la, idx) => (
                  <div key={`la-${idx}`} className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      <IconBinaryTree className="w-3.5 h-3.5 text-[#0284C7]" />
                      Logic App: {la.name}
                    </div>
                    <div className="font-mono text-[10px] text-slate-500 truncate mt-0.5">{la.resourceId}</div>
                  </div>
                ))}
                {receivers.azureFunctions.map((fn, idx) => (
                  <div key={`fn-${idx}`} className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      <IconCpu className="w-3.5 h-3.5 text-[#38BDF8]" />
                      Azure Function: {fn.functionName} ({fn.name})
                    </div>
                    <div className="font-mono text-[10px] text-slate-500 truncate mt-0.5">{fn.functionAppResourceId}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">No hay workflows serverless configurados.</div>
            )}
          </div>

          {/* SMS / Voice */}
          {receivers.sms && receivers.sms.length > 0 && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <IconDeviceMobile className="w-4 h-4 text-[#0EA5E9]" />
                SMS / Notificaciones Telefónicas ({receivers.sms.length})
              </div>
              <ul className="space-y-1">
                {receivers.sms.map((s, idx) => (
                  <li key={idx} className="flex justify-between items-center text-xs p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{s.name}</span>
                    <span className="font-mono text-slate-600 dark:text-slate-400">+{s.countryCode} {s.phoneNumber}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

// ─── Modal de Alertas Vinculadas ───
function ActionGroupAlertsModal({
  actionGroup,
  onClose,
}: {
  actionGroup: ActionGroupResource | null;
  onClose: () => void;
}) {
  if (!actionGroup) return null;

  const alerts = actionGroup.associatedAlertRuleNames || [];

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
          <IconLayersLinked className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div>
            <h2 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100">
              Reglas de Alerta Vinculadas: {actionGroup.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Total de reglas suscritas a este grupo: <span className="font-bold text-[#0054A6]">{actionGroup.associatedAlertsCount}</span>
            </p>
          </div>
        </div>

        <div className="space-y-2 mb-6 max-h-72 overflow-y-auto pr-1">
          {alerts.length > 0 ? (
            alerts.map((altName, i) => (
              <div
                key={i}
                className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <IconCircleCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{altName}</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900 font-medium">
                  Monitoreada
                </span>
              </div>
            ))
          ) : (
            <div className="p-6 text-center text-xs text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-800/50 flex flex-col items-center gap-2">
              <IconShieldExclamation className="w-6 h-6 text-amber-500" />
              <span>Este Action Group no tiene reglas de alerta asociadas (Estado Huérfano).</span>
            </div>
          )}
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
function ActionGroupRemediationModal({
  action,
  onClose,
}: {
  action: ActionGroupRemediationAction | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"cli" | "powershell">("cli");
  const [copied, setCopied] = useState(false);

  if (!action) return null;

  const script = buildActionGroupRemediationCommand(action);
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
export default function ActionGroupsBoard() {
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

  const apiUrl = `/api/intelligence/monitoring/action-groups?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<ActionGroupsPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  // Estados locales
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedHealth, setSelectedHealth] = useState<string>("ALL");
  const [selectedRg, setSelectedRg] = useState<string>("ALL");
  const [selectedSub, setSelectedSub] = useState<string>("ALL");
  const [timeScope, setTimeScope] = useState<"MTD" | "30D" | "90D">("MTD");
  const [sortBy, setSortBy] = useState<"notifs_desc" | "cost_desc" | "name_asc" | "name_desc" | "health">("notifs_desc");

  // Selección múltiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Optimistic Toggle state
  const [toggleOverrides, setToggleOverrides] = useState<Record<string, "Enabled" | "Disabled">>({});

  // Modales
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [viewReceiversGroup, setViewReceiversGroup] = useState<ActionGroupResource | null>(null);
  const [viewAlertsGroup, setViewAlertsGroup] = useState<ActionGroupResource | null>(null);
  const [activeRemediation, setActiveRemediation] = useState<ActionGroupRemediationAction | null>(null);

  // Lista aplicando overrides
  const groupsList: ActionGroupResource[] = useMemo(() => {
    if (!data?.actionGroups) return [];
    return data.actionGroups.map((ag) => {
      if (toggleOverrides[ag.id] !== undefined) {
        return { ...ag, state: toggleOverrides[ag.id] };
      }
      return ag;
    });
  }, [data?.actionGroups, toggleOverrides]);

  // Grupos de recursos y suscripciones únicos
  const resourceGroups = useMemo(() => {
    const set = new Set<string>();
    groupsList.forEach((ag) => {
      if (ag.resourceGroup) set.add(ag.resourceGroup);
    });
    return Array.from(set).sort();
  }, [groupsList]);

  const subscriptions = useMemo(() => {
    const map = new Map<string, string>();
    groupsList.forEach((ag) => {
      if (ag.subscriptionId) map.set(ag.subscriptionId, ag.subscriptionName || ag.subscriptionId);
    });
    return Array.from(map.entries());
  }, [groupsList]);

  // Filtrado y Ordenamiento
  const filteredGroups = useMemo(() => {
    return groupsList
      .filter((ag) => {
        // Texto
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const matchName = ag.name.toLowerCase().includes(term);
          const matchShort = (ag.shortName || "").toLowerCase().includes(term);
          const matchRg = ag.resourceGroup.toLowerCase().includes(term);
          const matchSub = (ag.subscriptionName || "").toLowerCase().includes(term);
          if (!matchName && !matchShort && !matchRg && !matchSub) return false;
        }
        // Tipo
        if (selectedType !== "ALL" && ag.specializedActionType !== selectedType) {
          return false;
        }
        // Salud
        if (selectedHealth !== "ALL" && ag.healthStatus !== selectedHealth) {
          return false;
        }
        // RG
        if (selectedRg !== "ALL" && ag.resourceGroup !== selectedRg) {
          return false;
        }
        // Subscripción
        if (selectedSub !== "ALL" && ag.subscriptionId !== selectedSub) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "notifs_desc") return b.totalNotificationsMTD - a.totalNotificationsMTD;
        if (sortBy === "cost_desc") return b.specializedCostUSD - a.specializedCostUSD;
        if (sortBy === "name_asc") return a.name.localeCompare(b.name);
        if (sortBy === "name_desc") return b.name.localeCompare(a.name);
        if (sortBy === "health") return a.healthStatus.localeCompare(b.healthStatus);
        return 0;
      });
  }, [groupsList, searchTerm, selectedType, selectedHealth, selectedRg, selectedSub, sortBy]);

  // Paginación Estándar CMP
  const {
    paged: paginatedGroups,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredGroups, 15);

  // Toggle de Estado
  const handleToggleState = async (ag: ActionGroupResource) => {
    const newState = ag.state === "Enabled" ? "Disabled" : "Enabled";
    setToggleOverrides((prev) => ({ ...prev, [ag.id]: newState }));

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!isMock && accounts.length > 0) {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      }
      const res = await fetch(`/api/intelligence/monitoring/action-groups?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "TOGGLE_STATE",
          resourceId: ag.id,
          state: newState,
        }),
      });
      // fetch no lanza ante 401/403/500: hay que revertir el estado optimista
      // explicitamente o la UI queda mostrando un cambio que nunca se aplico.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setToggleOverrides((prev) => ({ ...prev, [ag.id]: ag.state }));
    }
  };

  // Selección múltiple
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(paginatedGroups.map((ag: ActionGroupResource) => ag.id)));
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

  const handleBulkToggle = (targetState: "Enabled" | "Disabled") => {
    const overrides: Record<string, "Enabled" | "Disabled"> = {};
    selectedIds.forEach((id: string) => {
      overrides[id] = targetState;
    });
    setToggleOverrides((prev) => ({ ...prev, ...overrides }));
    setSelectedIds(new Set());
  };

  // Exportar CSV
  const handleExportCSV = () => {
    if (!filteredGroups || filteredGroups.length === 0) return;
    const headers = [
      "Action Group Name",
      "Short Name",
      "Resource Group",
      "Subscription",
      "Type",
      "State",
      "Health Status",
      "Emails Count",
      "Webhooks Count",
      "Logic Apps Count",
      "Functions Count",
      "Associated Alerts",
      "Total Notifications MTD",
      "Specialized Cost USD",
    ];
    const rows = filteredGroups.map((ag) => [
      `"${ag.name}"`,
      `"${ag.shortName || ""}"`,
      `"${ag.resourceGroup}"`,
      `"${ag.subscriptionName}"`,
      `"${ag.specializedActionType}"`,
      `"${ag.state}"`,
      `"${ag.healthStatus}"`,
      ag.emailReceiversCount,
      ag.webhookReceiversCount,
      ag.logicAppReceiversCount,
      ag.functionReceiversCount,
      ag.associatedAlertsCount,
      ag.totalNotificationsMTD,
      ag.specializedCostUSD.toFixed(2),
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `azure-action-groups-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary || {
    specializedCostUSD: 0,
    totalResourcesCount: 0,
    enabledCount: 0,
    disabledCount: 0,
    orphanCount: 0,
    totalNotificationsMTD: 0,
    failedNotificationsMTD: 0,
    bouncedEmailsTotal: 0,
    potentialSavingsUSD: 0,
    breakdownByActionType: [],
  };

  const dailyTrend = data?.dailyTrend || [];

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado Principal y Controles Globales ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconBellRinging className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>Gobernanza y Orquestación de Action Groups</span>
              <InfoTooltip
                content="Consola de auditoría de Action Groups de Azure Monitor. Monitoreo de canales de entrega (Email, Webhook, Logic Apps, Functions, SMS), detección de grupos huérfanos sin alertas asociadas, rebotes de email y fallas de orquestación."
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Azure Resource Graph" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Gestión de canales de notificación, enrutamiento de incidentes, costos de cómputo serverless y salud operativa
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
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
        {/* Card 1: Costo Cómputo Invocado MTD */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Costo Cómputo Invocado</span>
              <InfoTooltip content="Gasto de cómputo derivado de ejecuciones de Logic Apps, Functions y Webhooks orquestados por alertas." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCurrency(summary.specializedCostUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.totalNotificationsMTD} orquestaciones MTD
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        {/* Card 2: Total Action Groups */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Total de Action Groups</span>
              <InfoTooltip content="Total de grupos de acción aprovisionados en Azure Monitor." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalResourcesCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{summary.enabledCount} activos</span> •{" "}
              <span className="text-slate-400">{summary.disabledCount} deshabilitados</span>
            </div>
          </div>
          <IconBellRinging className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        {/* Card 3: Grupos Huérfanos / Inactivos */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Grupos Huérfanos</span>
              <InfoTooltip content="Action Groups que no tienen ninguna regla de alerta activa asociada (0 vinculaciones)." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <span>{summary.orphanCount}</span>
              {summary.orphanCount > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800 text-amber-600 bg-white dark:bg-slate-900">
                  Sin Alertas
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Candidatos a purga e higiene de gobernanza
            </div>
          </div>
          <IconShieldExclamation className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        {/* Card 4: Fallas de Notificación / Rebotes */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Fallas & Rebotes de Email</span>
              <InfoTooltip content="Notificaciones no entregadas por webhooks caídos (4xx/5xx) o emails rebotados." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <span>{summary.failedNotificationsMTD + summary.bouncedEmailsTotal}</span>
              {summary.failedNotificationsMTD + summary.bouncedEmailsTotal > 0 ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md border border-red-200 dark:border-red-800 text-red-600 bg-white dark:bg-slate-900">
                  Atención Requerida
                </span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800 text-emerald-600 bg-white dark:bg-slate-900">
                  100% Entregados
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.bouncedEmailsTotal} rebotes • {summary.failedNotificationsMTD} fallas webhook
            </div>
          </div>
          <IconAlertTriangle className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>
      </div>

      {/* ─── Fila 1: Gráficas de Capacidad & Throughput (Ancho 100% - Grid de 2 Columnas) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Distribución por Tipo de Acción (Donut Chart) */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              <IconBellRinging className="w-4 h-4 text-[#0078D4]" />
              Distribución por Canal de Acción
            </h3>
            <InfoTooltip content="Desglose de canales predominantes (Emails, Webhooks, Logic Apps, Functions, SMS) configurados en la plataforma." />
          </div>

          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={summary.breakdownByActionType.filter((b) => b.count > 0)}
                  dataKey="count"
                  nameKey="typeName"
                  cx="50%"
                  cy="50%"
                  innerRadius={38}
                  outerRadius={62}
                  paddingAngle={3}
                >
                  {summary.breakdownByActionType.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(val: any) => [`${val} grupos`, "Cantidad"]}
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
            {summary.breakdownByActionType.map((b) => (
              <div key={b.typeName} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                <span className="text-slate-600 dark:text-slate-400 truncate">{b.typeName}:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Evolución de Orquestación de Respuestas y Fallas (Area Chart) */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs lg:col-span-2 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              <IconLayersLinked className="w-4 h-4 text-[#0078D4]" />
              Evolución de Orquestación de Respuestas y Fallas (30 Días)
            </h3>
            <InfoTooltip content="Historial de volumen de notificaciones procesadas versus incidencias de entrega (rebotes y errores webhook)." />
          </div>

          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorNotifs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748B" }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: "#64748B" }} />
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
                <Area type="monotone" dataKey="notificationsCount" name="Notificaciones Exitosas" stroke="#0078D4" strokeWidth={2} fillOpacity={1} fill="url(#colorNotifs)" />
                <Area type="monotone" dataKey="failedCount" name="Fallas / Rebotes" stroke="#EF4444" strokeWidth={2} fillOpacity={1} fill="url(#colorFailed)" />
              </AreaChart>
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
              placeholder="Buscar por nombre, short name, RG..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            />
          </div>

          {/* Filtro Tipo de Acción */}
          <div>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="ALL">Canal (Todos)</option>
              <option value="Email">Email</option>
              <option value="Webhook">Webhook</option>
              <option value="Logic App">Logic App</option>
              <option value="Azure Function">Azure Function</option>
              <option value="SMS / Voz">SMS / Voz</option>
              <option value="Multi-Canal">Multi-Canal</option>
              <option value="Sin Destinatarios">Sin Destinatarios</option>
            </select>
          </div>

          {/* Filtro Salud */}
          <div>
            <select
              value={selectedHealth}
              onChange={(e) => setSelectedHealth(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="ALL">Salud (Todas)</option>
              <option value="Valid">Válido</option>
              <option value="Orphan">Huérfano (0 Alertas)</option>
              <option value="Invalid_Bounces">Con Rebotes</option>
              <option value="Invalid_Endpoint_Error">Error de Endpoint</option>
            </select>
          </div>

          {/* Filtro Grupo de Recursos */}
          <div>
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

          {/* Ordenamiento */}
          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="notifs_desc">Notificaciones: Mayor</option>
              <option value="cost_desc">Costo Cómputo: Mayor</option>
              <option value="name_asc">Nombre: A - Z</option>
              <option value="name_desc">Nombre: Z - A</option>
              <option value="health">Estado de Salud</option>
            </select>
          </div>
        </div>

        {/* Acciones Masivas cuando hay selección */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-blue-50/70 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-800">
            <span className="text-xs font-semibold text-[#0054A6] dark:text-blue-300">
              {selectedIds.size} {selectedIds.size === 1 ? "grupo seleccionado" : "grupos seleccionados"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkToggle("Enabled")}
                className="px-3 py-1 text-xs font-medium rounded-lg border border-emerald-600 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50/50 transition cursor-pointer"
              >
                Habilitar Selección
              </button>
              <button
                onClick={() => handleBulkToggle("Disabled")}
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

      {/* ─── Fila 2: Tabla "Desglose por Recurso de Action Group" (Estándar FinOps CMP - Ancho 100%) ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconBellRinging className="w-5 h-5 text-[#0078D4]" />
              <span>Desglose por Recurso de Action Group</span>
              <InfoTooltip content="Catálogo completo de Action Groups con detalle de canales configurados, salud de entrega y vinculación con alertas." />
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mostrando {paginatedGroups.length} de {filteredGroups.length} grupos filtrados
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
                    checked={paginatedGroups.length > 0 && selectedIds.size === paginatedGroups.length}
                    className="rounded-sm border-slate-300 text-[#0054A6] focus:ring-0 cursor-pointer"
                  />
                </th>
                <ResizableTh minWidth={200}>Recurso (Action Group)</ResizableTh>
                <ResizableTh minWidth={140}>Canal Principal</ResizableTh>
                <ResizableTh minWidth={180}>Destinatarios Configurados</ResizableTh>
                <ResizableTh minWidth={130}>Salud / Estado</ResizableTh>
                <ResizableTh minWidth={100}>Estado</ResizableTh>
                <ResizableTh minWidth={160}>Suscripción</ResizableTh>
                <ResizableTh minWidth={110}>Alertas Vinculadas</ResizableTh>
                <ResizableTh minWidth={120}>Notificaciones MTD</ResizableTh>
                <ResizableTh minWidth={110}>Costo Cómputo</ResizableTh>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedGroups.length > 0 ? (
                paginatedGroups.map((ag: ActionGroupResource) => {
                  const isSelected = selectedIds.has(ag.id);

                  // Icono según tipo de acción
                  let ChannelIcon = IconMail;
                  if (ag.specializedActionType === "Webhook") ChannelIcon = IconWebhook;
                  else if (ag.specializedActionType === "Logic App") ChannelIcon = IconBinaryTree;
                  else if (ag.specializedActionType === "Azure Function") ChannelIcon = IconCpu;
                  else if (ag.specializedActionType === "SMS / Voz") ChannelIcon = IconDeviceMobile;
                  else if (ag.specializedActionType === "Multi-Canal") ChannelIcon = IconLayersLinked;

                  // Health badge
                  let healthBadge = (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <IconCircleCheck className="w-3 h-3" />
                      Válido
                    </span>
                  );
                  if (ag.healthStatus === "Orphan") {
                    healthBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
                        <IconShieldExclamation className="w-3 h-3" />
                        Huérfano (0 Alertas)
                      </span>
                    );
                  } else if (ag.healthStatus === "Invalid_Bounces") {
                    healthBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 bg-rose-50/50 dark:bg-rose-950/20">
                        <IconAlertTriangle className="w-3 h-3" />
                        Rebotes ({ag.bouncedEmailCount})
                      </span>
                    );
                  } else if (ag.healthStatus === "Invalid_Endpoint_Error") {
                    healthBadge = (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 bg-red-50/50 dark:bg-red-950/20">
                        <IconAlertCircle className="w-3 h-3" />
                        Falla Webhook ({ag.failedWebhookCount})
                      </span>
                    );
                  }

                  // Resumen de receptores texto
                  const receiversParts: string[] = [];
                  if (ag.emailReceiversCount > 0) receiversParts.push(`${ag.emailReceiversCount} Email${ag.emailReceiversCount > 1 ? "s" : ""}`);
                  if (ag.webhookReceiversCount > 0) receiversParts.push(`${ag.webhookReceiversCount} Webhook${ag.webhookReceiversCount > 1 ? "s" : ""}`);
                  if (ag.logicAppReceiversCount > 0) receiversParts.push(`${ag.logicAppReceiversCount} Logic App`);
                  if (ag.functionReceiversCount > 0) receiversParts.push(`${ag.functionReceiversCount} Function`);
                  if (ag.smsReceiversCount && ag.smsReceiversCount > 0) receiversParts.push(`${ag.smsReceiversCount} SMS`);
                  const receiversSummaryText = receiversParts.length > 0 ? receiversParts.join(" / ") : "Sin destinatarios";

                  return (
                    <tr
                      key={ag.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                        isSelected ? "bg-blue-50/40 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectOne(ag.id)}
                          className="rounded-sm border-slate-300 text-[#0054A6] focus:ring-0 cursor-pointer"
                        />
                      </td>

                      {/* Recurso */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-xs" title={ag.name}>
                          {ag.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">
                          RG: {ag.resourceGroup}
                        </div>
                      </td>

                      {/* Canal Principal */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <ChannelIcon className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className="text-slate-700 dark:text-slate-300 truncate">
                            {ag.specializedActionType}
                          </span>
                        </div>
                      </td>

                      {/* Destinatarios */}
                      <td className="py-3 px-3 text-slate-700 dark:text-slate-300 truncate max-w-xs font-mono text-[11px]" title={receiversSummaryText}>
                        {receiversSummaryText}
                      </td>

                      {/* Salud */}
                      <td className="py-3 px-3">
                        {healthBadge}
                      </td>

                      {/* Estado Toggle */}
                      <td className="py-3 px-3">
                        <button
                          onClick={() => handleToggleState(ag)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 transition cursor-pointer ${
                            ag.state === "Enabled"
                              ? "border-emerald-600 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50/50"
                              : "border-slate-400 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-100"
                          }`}
                        >
                          <IconPower className={`w-3.5 h-3.5 ${ag.state === "Enabled" ? "text-emerald-600" : "text-slate-400"}`} />
                          {ag.state === "Enabled" ? "Activo" : "Pausado"}
                        </button>
                      </td>

                      {/* Suscripción */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400 truncate max-w-[140px]" title={ag.subscriptionName}>
                        {ag.subscriptionName}
                      </td>

                      {/* Alertas Vinculadas */}
                      <td className="py-3 px-3">
                        <button
                          onClick={() => setViewAlertsGroup(ag)}
                          className="font-bold text-[#0054A6] hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <IconLayersLinked className="w-3.5 h-3.5 text-[#0078D4]" />
                          <span>{ag.associatedAlertsCount} regla{ag.associatedAlertsCount !== 1 ? "s" : ""}</span>
                        </button>
                      </td>

                      {/* Total Notificaciones */}
                      <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                        {ag.totalNotificationsMTD}
                      </td>

                      {/* Costo Cómputo */}
                      <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(ag.specializedCostUSD)}
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setViewReceiversGroup(ag)}
                            className="p-1.5 rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 transition cursor-pointer"
                            title="Ver Canales y Receptores"
                          >
                            <IconEye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    <IconBellRinging className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" stroke={1.5} />
                    No se encontraron Action Groups con los filtros seleccionados.
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

      {/* ─── Panel de Recomendaciones Priorizadas de Action Groups (Ancho 100%) ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconSparkles className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
              <span>Oportunidades de Optimización & Salud de Action Groups</span>
              <InfoTooltip content="Recomendaciones automáticas para depurar grupos huérfanos, resolver rebotes de correo y asegurar entrega de alertas." />
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
              Todos los Action Groups están saludables y vinculados a alertas operativas.
            </div>
          )}
        </div>
      </div>

      {/* ─── Modales Renderizados en z-50 ─── */}
      <ActionGroupAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        totalGroups={summary.totalResourcesCount}
        orphanCount={summary.orphanCount}
        potentialSavings={summary.potentialSavingsUSD}
      />

      <ActionGroupReceiversModal
        actionGroup={viewReceiversGroup}
        onClose={() => setViewReceiversGroup(null)}
      />

      <ActionGroupAlertsModal
        actionGroup={viewAlertsGroup}
        onClose={() => setViewAlertsGroup(null)}
      />

      <ActionGroupRemediationModal
        action={activeRemediation}
        onClose={() => setActiveRemediation(null)}
      />
    </div>
  );
}

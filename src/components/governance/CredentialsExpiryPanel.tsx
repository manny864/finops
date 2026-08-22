"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import {
  IconKey,
  IconBellRinging,
  IconAlertOctagon,
  IconClockExclamation,
  IconShieldCheck,
  IconApps,
  IconPlus,
  IconColumns,
  IconSearch,
  IconCopy,
  IconRotateClockwise,
  IconEye,
  IconEdit,
  IconTrash,
  IconX,
  IconCheck,
  IconAlertTriangle,
  IconInfoCircle,
  IconCertificate,
  IconBrandWindows,
  IconMail,
  IconBrandSlack,
  IconWebhook,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  ALERT_RULE_COLUMNS,
  CHANNEL_LABELS,
  CREDENTIAL_COLUMNS,
  STATUS_LABELS_ES,
  VALIDITY_OPTIONS,
  type CredentialAlertRuleItem,
  type CredentialItem,
  type CredentialStatus,
  type CredentialsPayload,
  type NotificationChannel,
  type TableColumnConfig,
} from "@/types/azureCredentialsExpiry.types";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
  "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
  "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const CELL = "min-w-[120px] max-w-[240px] truncate";

const STATUS_BADGE: Record<CredentialStatus, string> = {
  HEALTHY: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800",
  EXPIRING_SOON: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
  EXPIRED: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800",
};

const CHANNEL_ICONS: Record<NotificationChannel, React.ComponentType<{ size?: number; className?: string; stroke?: number }>> = {
  EMAIL: IconMail,
  TEAMS: IconBrandWindows,
  SLACK: IconBrandSlack,
  WEBHOOK: IconWebhook,
};

function useColumnConfig(storageKey: string, defaults: TableColumnConfig[]) {
  const [columns, setColumns] = useState<TableColumnConfig[]>(defaults);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      setColumns((prev) =>
        prev.map((c) => {
          const m = parsed.find((p: { id?: string }) => p?.id === c.id);
          return m ? { ...c, visible: Boolean(m.visible) } : c;
        })
      );
    } catch {
      // Preferencia corrupta: se ignora.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(columns.map((c) => ({ id: c.id, visible: c.visible }))));
    } catch {
      // Cuota llena o modo privado.
    }
  }, [columns, storageKey]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const isVisible = useCallback((id: string) => columns.find((c) => c.id === id)?.visible ?? true, [columns]);
  const toggle = useCallback(
    (id: string) => setColumns((p) => p.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))),
    []
  );
  return { columns, isVisible, toggle, open, setOpen, menuRef };
}

function ColumnMenu({ columns, toggle, open, setOpen, menuRef }: ReturnType<typeof useColumnConfig>) {
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
      >
        <IconColumns size={16} className="inline mr-1.5 text-[#0078D4]" stroke={1.5} />
        Personalizar Columnas
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-60 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-[100] space-y-0.5">
          {columns.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <input type="checkbox" checked={c.visible} onChange={() => toggle(c.id)} className="accent-[#0054A6] cursor-pointer" />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CredentialsExpiryPanel() {
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

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (isMock || accounts.length === 0) return {};
    try {
      const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [instance, accounts, isMock]);

  const canFetch = Boolean(tenantId) && (isMock || accounts.length > 0);
  const apiUrl = `/api/governance/expiring-credentials?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`;

  const { data, error, isValidating, mutate } = useSWR<CredentialsPayload>(
    canFetch ? apiUrl : null,
    async (url: string) => {
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  const summary = data?.summary;
  const credentials = useMemo(() => summary?.credentials || [], [summary]);
  const alertRules = useMemo(() => summary?.alertRules || [], [summary]);

  const [tab, setTab] = useState<"CREDENTIALS" | "ALERTS">("CREDENTIALS");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState<"days_asc" | "name_asc" | "name_desc" | "expiry_desc">("days_asc");

  const [rotateItem, setRotateItem] = useState<CredentialItem | null>(null);
  const [rotateMonths, setRotateMonths] = useState(12);
  const [rotateResult, setRotateResult] = useState<{ secretText: string; endDateTime: string } | null>(null);
  const [isRotating, setIsRotating] = useState(false);

  const [ruleModal, setRuleModal] = useState<CredentialAlertRuleItem | "NEW" | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleThresholds, setRuleThresholds] = useState("30,7");
  const [ruleChannels, setRuleChannels] = useState<NotificationChannel[]>(["EMAIL"]);
  const [ruleRecipients, setRuleRecipients] = useState("");
  const [isSavingRule, setIsSavingRule] = useState(false);

  const credCols = useColumnConfig(`table_columns_config_credentials_expiry_${tenantId}`, CREDENTIAL_COLUMNS);
  const ruleCols = useColumnConfig(`table_columns_config_credentials_alerts_${tenantId}`, ALERT_RULE_COLUMNS);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = credentials.filter((c) => {
      if (q && !c.applicationDisplayName.toLowerCase().includes(q) && !c.appId.toLowerCase().includes(q)) return false;
      if (typeFilter !== "ALL" && c.credentialType !== typeFilter) return false;
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sortBy === "name_asc") return a.applicationDisplayName.localeCompare(b.applicationDisplayName);
      if (sortBy === "name_desc") return b.applicationDisplayName.localeCompare(a.applicationDisplayName);
      if (sortBy === "expiry_desc") return b.daysRemaining - a.daysRemaining;
      return a.daysRemaining - b.daysRemaining;
    });
  }, [credentials, search, typeFilter, statusFilter, sortBy]);

  const credPg = usePagination(filtered, 15);
  const rulePg = usePagination(alertRules, 15);

  const copy = (value: string, label: string) => {
    navigator.clipboard?.writeText(value);
    toast.success(`${label} copiado al portapapeles`);
  };

  const handleRotate = async () => {
    if (!rotateItem) return;
    setIsRotating(true);
    try {
      const res = await fetch(`/api/governance/credentials/rotate${isMock ? "?mock=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          tenantId,
          applicationId: rotateItem.applicationId,
          validityMonths: rotateMonths,
          description: `Rotación desde CSCloudSolutions para ${rotateItem.applicationDisplayName}`,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setRotateResult({ secretText: body.secretText, endDateTime: body.endDateTime });
      toast.success(body.message || "Secreto rotado");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || "No se pudo rotar el secreto");
    } finally {
      setIsRotating(false);
    }
  };

  const openRuleModal = (rule: CredentialAlertRuleItem | "NEW") => {
    setRuleModal(rule);
    if (rule === "NEW") {
      setRuleName("");
      setRuleThresholds("30,7");
      setRuleChannels(["EMAIL"]);
      setRuleRecipients("");
    } else {
      setRuleName(rule.ruleName);
      setRuleThresholds(rule.warningThresholdsDays.join(","));
      setRuleChannels(rule.notificationChannels);
      setRuleRecipients(rule.recipients.join(", "));
    }
  };

  const handleSaveRule = async () => {
    const recipients = ruleRecipients.split(",").map((r) => r.trim()).filter(Boolean);
    if (!ruleName.trim()) {
      toast.error("Poné un nombre a la alerta");
      return;
    }
    if (recipients.length === 0) {
      toast.error("La alerta necesita al menos un destinatario");
      return;
    }
    setIsSavingRule(true);
    try {
      const res = await fetch(`/api/governance/expiring-credentials${isMock ? "?mock=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          tenantId,
          id: ruleModal !== "NEW" && ruleModal ? ruleModal.id : undefined,
          ruleName: ruleName.trim(),
          warningThresholdsDays: ruleThresholds.split(",").map((n) => parseInt(n.trim(), 10)).filter(Number.isFinite),
          notificationChannels: ruleChannels,
          recipients,
          isEnabled: ruleModal !== "NEW" && ruleModal ? ruleModal.isEnabled : true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(body.message || "Alerta guardada");
      setRuleModal(null);
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || "No se pudo guardar la alerta");
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleToggleRule = async (rule: CredentialAlertRuleItem) => {
    try {
      const res = await fetch(`/api/governance/expiring-credentials${isMock ? "?mock=true" : ""}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ tenantId, id: rule.id, isEnabled: !rule.isEnabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(body.message || "Alerta actualizada");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || "No se pudo actualizar la alerta");
    }
  };

  const handleDeleteRule = async (rule: CredentialAlertRuleItem) => {
    try {
      const res = await fetch(
        `/api/governance/expiring-credentials?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(rule.id)}${isMock ? "&mock=true" : ""}`,
        { method: "DELETE", headers: await authHeaders() }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success("Alerta eliminada");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e) || "No se pudo eliminar la alerta");
    }
  };

  const kpis = [
    {
      label: "Credenciales Vencidas",
      tip: "Secretos y certificados cuya fecha de expiración ya pasó. Siguen listados porque la aplicación puede seguir configurada con ellos.",
      value: summary?.expiredCount ?? 0,
      Icon: IconAlertOctagon,
      color: "text-[#0078D4]",
    },
    {
      label: "Próximas a Vencer (< 30 días)",
      tip: "Ventana estándar de aviso: 30 días alcanzan para coordinar la rotación y migrar los consumidores.",
      value: summary?.expiringSoonCount ?? 0,
      Icon: IconClockExclamation,
      color: "text-[#2563EB]",
    },
    {
      label: "Credenciales Vigentes",
      tip: "Con más de 30 días de vida útil restante.",
      value: summary?.healthyCount ?? 0,
      Icon: IconShieldCheck,
      color: "text-[#0284C7]",
    },
    {
      label: "Service Principals Auditados",
      tip: "Identidades de aplicación distintas evaluadas. Una app con tres secretos cuenta una sola vez.",
      value: summary?.totalApplicationsCount ?? 0,
      Icon: IconApps,
      color: "text-slate-900 dark:text-white",
    },
  ];

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconKey size={22} className="text-[#0078D4]" stroke={1.5} />
              <span>Credenciales por Expirar (Entra ID)</span>
            </h1>
            <InfoTooltip
              content="Rotar crea un secreto nuevo sin revocar el anterior, a propósito: revocar en el mismo paso dejaría fuera de servicio todo lo que todavía usa el viejo. Migrá los consumidores y recién después eliminá el anterior."
              position="bottom"
              align="left"
            />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Microsoft Graph Live" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Service Principals y Applications con secretos o certificados próximos a vencer.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              setTab("ALERTS");
              openRuleModal("NEW");
            }}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
          >
            <IconPlus size={16} className="inline mr-1.5" stroke={2} />
            Crear alerta de vencimiento
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] cursor-pointer disabled:opacity-60"
          >
            <IconRotateClockwise size={16} className={`inline text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {data?.warning && (
        <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 flex items-start gap-2">
          <IconInfoCircle size={16} className="text-amber-600 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-amber-800 dark:text-amber-300">{data.warning}</p>
        </div>
      )}

      {/* ─── KPIs ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between"
          >
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span className="truncate">{k.label}</span>
                <InfoTooltip content={k.tip} />
              </div>
              <div className={`text-3xl font-extrabold tabular-nums ${k.color}`}>{k.value}</div>
            </div>
            <k.Icon size={32} className="text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Pestañas ─── */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setTab("CREDENTIALS")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 cursor-pointer transition ${
            tab === "CREDENTIALS" ? "border-[#0078D4] text-[#0054A6]" : "border-transparent text-slate-500 dark:text-slate-400"
          }`}
        >
          <IconKey size={16} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
          Credenciales
        </button>
        <button
          onClick={() => setTab("ALERTS")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 cursor-pointer transition ${
            tab === "ALERTS" ? "border-[#0078D4] text-[#0054A6]" : "border-transparent text-slate-500 dark:text-slate-400"
          }`}
        >
          <IconBellRinging size={16} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
          Alertas Configuradas
        </button>
      </div>

      {/* ─── Pestaña 1: credenciales ─── */}
      {tab === "CREDENTIALS" && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              Inventario de Credenciales de Entra ID
              <InfoTooltip content="Los días restantes se recalculan en cada consulta, no se guardan: una credencial pasa de vigente a por vencer sin que nadie la toque." />
            </h2>
            <ColumnMenu {...credCols} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <IconSearch size={14} className="text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Buscar aplicación o App ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="ALL">Tipo: Todas</option>
              <option value="Secret">Secretos (Client Secret)</option>
              <option value="Certificate">Certificados X.509</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="ALL">Estado: Todos</option>
              <option value="HEALTHY">Vigentes</option>
              <option value="EXPIRING_SOON">Próximas a Vencer</option>
              <option value="EXPIRED">Vencidas</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            >
              <option value="days_asc">Días Restantes: Menor a Mayor</option>
              <option value="expiry_desc">Días Restantes: Mayor a Menor</option>
              <option value="name_asc">Nombre: A-Z</option>
              <option value="name_desc">Nombre: Z-A</option>
            </select>
          </div>

          <div className={VISIBLE_SCROLLBAR}>
            <table className="w-full text-xs table-fixed">
              <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  {CREDENTIAL_COLUMNS.filter((c) => credCols.isVisible(c.id)).map((c) => (
                    <ResizableTh key={c.id} minWidth={c.minWidth} className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200">
                      {c.label}
                    </ResizableTh>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {credPg.paged.length === 0 ? (
                  <tr>
                    <td colSpan={CREDENTIAL_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      {credentials.length === 0
                        ? "Microsoft Graph no reporta credenciales en las aplicaciones visibles para el Service Principal."
                        : "Ninguna credencial coincide con los filtros aplicados."}
                    </td>
                  </tr>
                ) : (
                  credPg.paged.map((c: CredentialItem) => (
                    <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      {credCols.isVisible("application") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {c.credentialType === "Certificate" ? (
                              <IconCertificate size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                            ) : (
                              <IconBrandWindows size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                            )}
                            <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 ${CELL}`} title={c.applicationDisplayName}>
                              {c.applicationDisplayName}
                            </span>
                          </div>
                          {c.hint && <span className="text-[10px] text-slate-500 dark:text-slate-400">Hint: {c.hint}···</span>}
                        </td>
                      )}
                      {credCols.isVisible("type") && (
                        <td className="py-2.5 px-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border whitespace-nowrap ${
                              c.credentialType === "Certificate"
                                ? "bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800"
                                : "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border-blue-200 dark:border-blue-800"
                            }`}
                          >
                            {c.credentialType}
                          </span>
                        </td>
                      )}
                      {credCols.isVisible("status") && (
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${STATUS_BADGE[c.status]}`}>
                            {STATUS_LABELS_ES[c.status]}
                          </span>
                        </td>
                      )}
                      {credCols.isVisible("expiry") && (
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {c.formattedExpiryDate}
                        </td>
                      )}
                      {credCols.isVisible("days") && (
                        <td className="py-2.5 px-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                            {c.daysRemaining < 0 ? `Vencida hace ${Math.abs(c.daysRemaining)} días` : `${c.daysRemaining} días`}
                          </span>
                        </td>
                      )}
                      {credCols.isVisible("appId") && (
                        <td className="py-2.5 px-3">
                          <span className={`font-mono text-slate-600 dark:text-slate-300 inline-block ${CELL}`} title={c.appId}>
                            {c.appId}
                          </span>
                          <IconCopy
                            size={14}
                            className="inline ml-1 text-slate-400 hover:text-[#0078D4] cursor-pointer"
                            onClick={() => copy(c.appId, "App ID")}
                          />
                        </td>
                      )}
                      {credCols.isVisible("actions") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => {
                                setRotateItem(c);
                                setRotateMonths(12);
                                setRotateResult(null);
                              }}
                              disabled={c.credentialType === "Certificate"}
                              title={
                                c.credentialType === "Certificate"
                                  ? "Los certificados se renuevan subiendo la clave pública, no se generan desde acá"
                                  : "Rotar secreto"
                              }
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                              <IconRotateClockwise size={14} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
                              Rotar
                            </button>
                            <button
                              onClick={() => {
                                setTab("ALERTS");
                                openRuleModal("NEW");
                              }}
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
                            >
                              <IconBellRinging size={14} className="inline mr-1" stroke={1.5} />
                              Alerta
                            </button>
                            <a
                              href={`https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Credentials/appId/${encodeURIComponent(c.appId)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Ver en Entra ID"
                              className="cursor-pointer bg-transparent"
                            >
                              <IconEye size={16} className="text-slate-400 hover:text-[#0078D4]" stroke={1.5} />
                            </a>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={credPg.page}
            totalPages={credPg.totalPages}
            pageSize={credPg.pageSize}
            total={credPg.total}
            setPage={credPg.setPage}
            setPageSize={credPg.setPageSize}
            pageSizes={[15, 30, 45, 60]}
          />
        </div>
      )}

      {/* ─── Pestaña 2: alertas ─── */}
      {tab === "ALERTS" && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
              Alertas de Vencimiento Configuradas
              <InfoTooltip content="Cada umbral dispara un aviso independiente: con 60/30/7 el equipo recibe tres recordatorios antes del vencimiento, no uno solo." />
            </h2>
            <ColumnMenu {...ruleCols} />
          </div>

          <div className={VISIBLE_SCROLLBAR}>
            <table className="w-full text-xs table-fixed">
              <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  {ALERT_RULE_COLUMNS.filter((c) => ruleCols.isVisible(c.id)).map((c) => (
                    <ResizableTh key={c.id} minWidth={c.minWidth} className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200">
                      {c.label}
                    </ResizableTh>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rulePg.paged.length === 0 ? (
                  <tr>
                    <td colSpan={ALERT_RULE_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      No hay alertas configuradas. Sin ellas, un secreto puede vencer un domingo sin que nadie se entere.
                    </td>
                  </tr>
                ) : (
                  rulePg.paged.map((r: CredentialAlertRuleItem) => (
                    <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      {ruleCols.isVisible("name") && (
                        <td className="py-2.5 px-3">
                          <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 block ${CELL}`} title={r.ruleName}>
                            {r.ruleName}
                          </span>
                          {r.lastTriggeredAt && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                              Último aviso: {new Date(r.lastTriggeredAt).toLocaleDateString("es-AR")}
                            </span>
                          )}
                        </td>
                      )}
                      {ruleCols.isVisible("thresholds") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {r.warningThresholdsDays.map((d) => (
                              <span
                                key={d}
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6] whitespace-nowrap"
                              >
                                {d} días antes
                              </span>
                            ))}
                          </div>
                        </td>
                      )}
                      {ruleCols.isVisible("channels") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {r.notificationChannels.map((ch) => {
                              const Icon = CHANNEL_ICONS[ch];
                              return (
                                <span
                                  key={ch}
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 flex items-center gap-1 whitespace-nowrap"
                                >
                                  <Icon size={12} className="text-[#0078D4]" stroke={1.5} />
                                  {CHANNEL_LABELS[ch]}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      )}
                      {ruleCols.isVisible("recipients") && (
                        <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={r.recipients.join(", ")}>
                          {r.recipients.join(", ")}
                        </td>
                      )}
                      {ruleCols.isVisible("enabled") && (
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => handleToggleRule(r)}
                            role="switch"
                            aria-checked={r.isEnabled}
                            className={`relative w-10 h-5 rounded-full transition cursor-pointer ${
                              r.isEnabled ? "bg-[#0078D4]" : "bg-slate-300 dark:bg-slate-700"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                                r.isEnabled ? "left-[22px]" : "left-0.5"
                              }`}
                            />
                          </button>
                        </td>
                      )}
                      {ruleCols.isVisible("actions") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openRuleModal(r)} className="cursor-pointer bg-transparent" title="Editar">
                              <IconEdit size={16} className="text-slate-400 hover:text-[#0078D4]" stroke={1.5} />
                            </button>
                            <button onClick={() => handleDeleteRule(r)} className="cursor-pointer bg-transparent" title="Eliminar">
                              <IconTrash size={16} className="text-slate-400 hover:text-rose-600" stroke={1.5} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={rulePg.page}
            totalPages={rulePg.totalPages}
            pageSize={rulePg.pageSize}
            total={rulePg.total}
            setPage={rulePg.setPage}
            setPageSize={rulePg.setPageSize}
            pageSizes={[15, 30, 45, 60]}
          />
        </div>
      )}

      {/* ─── Modal: rotación de secreto ─── */}
      {rotateItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconRotateClockwise size={18} className="text-[#0078D4]" stroke={1.5} />
                Rotar secreto de {rotateItem.applicationDisplayName}
              </h3>
              <button
                onClick={() => {
                  setRotateItem(null);
                  setRotateResult(null);
                }}
                className="cursor-pointer bg-transparent"
              >
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            {!rotateResult ? (
              <>
                <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30">
                  <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                    Se crea un secreto <strong>nuevo</strong> y el actual sigue vigente. Es deliberado: revocar el viejo en
                    el mismo paso cortaría el servicio a todo lo que aún lo usa. Migrá los consumidores y después eliminá
                    el anterior desde el portal de Entra ID.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Vigencia del nuevo secreto</label>
                  <select
                    value={rotateMonths}
                    onChange={(e) => setRotateMonths(Number(e.target.value))}
                    className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
                  >
                    {VALIDITY_OPTIONS.map((v) => (
                      <option key={v.months} value={v.months}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setRotateItem(null)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleRotate}
                    disabled={isRotating}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer disabled:opacity-50"
                  >
                    <IconCheck size={16} className="inline mr-1" stroke={2} />
                    {isRotating ? "Generando…" : "Generar secreto"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
                  <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                    <strong>Este valor se muestra una sola vez.</strong> Microsoft Graph no lo devuelve de nuevo y la
                    plataforma no lo guarda. Copialo ahora y almacenalo en Azure Key Vault.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-2">
                  <code className="text-[11px] font-mono text-slate-800 dark:text-slate-200 break-all">
                    {rotateResult.secretText}
                  </code>
                  <button
                    onClick={() => copy(rotateResult.secretText, "Secreto")}
                    className="cursor-pointer bg-transparent shrink-0"
                    title="Copiar secreto"
                  >
                    <IconCopy size={16} className="text-slate-400 hover:text-[#0078D4]" stroke={1.5} />
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Vence el {new Date(rotateResult.endDateTime).toLocaleDateString("es-AR")}.
                </p>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setRotateItem(null);
                      setRotateResult(null);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
                  >
                    Ya lo guardé
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Modal: alta / edición de alerta ─── */}
      {ruleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconBellRinging size={18} className="text-[#0078D4]" stroke={1.5} />
                {ruleModal === "NEW" ? "Crear alerta de vencimiento" : "Editar alerta"}
              </h3>
              <button onClick={() => setRuleModal(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Nombre de la alerta</label>
                <input
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Ej: Identidades de producción"
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Umbrales de disparo (días antes, separados por coma)
                </label>
                <input
                  type="text"
                  value={ruleThresholds}
                  onChange={(e) => setRuleThresholds(e.target.value)}
                  placeholder="60,30,7"
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
                />
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Cada umbral dispara un aviso independiente. Un solo recordatorio a 7 días rara vez alcanza para
                  coordinar una rotación con los equipos consumidores.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Canales</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(Object.keys(CHANNEL_LABELS) as NotificationChannel[]).map((ch) => {
                    const Icon = CHANNEL_ICONS[ch];
                    const active = ruleChannels.includes(ch);
                    return (
                      <button
                        key={ch}
                        onClick={() =>
                          setRuleChannels((prev) => (active ? prev.filter((c) => c !== ch) : [...prev, ch]))
                        }
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border cursor-pointer bg-white dark:bg-slate-900 flex items-center gap-1 ${
                          active ? "border-[#0078D4] text-[#0054A6]" : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        <Icon size={13} className="text-[#0078D4]" stroke={1.5} />
                        {CHANNEL_LABELS[ch]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Destinatarios (mails o URLs de webhook, separados por coma)
                </label>
                <input
                  type="text"
                  value={ruleRecipients}
                  onChange={(e) => setRuleRecipients(e.target.value)}
                  placeholder="cloudops@empresa.com, #canal-alertas"
                  className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRuleModal(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveRule}
                disabled={isSavingRule}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer disabled:opacity-50"
              >
                <IconCheck size={16} className="inline mr-1" stroke={2} />
                Guardar alerta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useTranslations } from "next-intl";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  IconBellRinging,
  IconFlame,
  IconShare,
  IconShieldCheck,
  IconPlus,
  IconRotateClockwise,
  IconSearch,
  IconFilter,
  IconMail,
  IconBrandTeams,
  IconBrandSlack,
  IconWebhook,
  IconServer,
  IconSparkles,
  IconTrash,
  IconCheck,
  IconAlertTriangle,
  IconX,
  IconSend,
  IconAdjustmentsHorizontal,
  IconCode,
} from "@tabler/icons-react";
import {
  AlertRuleType,
  AlertScopeType,
  NotificationChannelType,
  SelfServiceAlertRule,
  SelfServiceAlertsPayload,
  AlertTestResult,
} from "@/types/azureSelfServiceAlerts.types";

const VISIBLE_SCROLLBAR =
  "scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

// `t` entra por parametro: buildFetcher no es un componente ni un hook y no
// puede llamar a useTranslations.
function buildFetcher(instance: any, accounts: any[], isMock: boolean, t: (k: string) => string) {
  return async (url: string) => {
    if (isMock) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(t("loadError"));
      return res.json();
    }
    const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  };
}

function getChannelIcon(channel: NotificationChannelType) {
  switch (channel) {
    case "TEAMS":
      return IconBrandTeams;
    case "SLACK":
      return IconBrandSlack;
    case "EMAIL":
      return IconMail;
    case "SERVICENOW":
      return IconServer;
    case "WEBHOOK":
    default:
      return IconWebhook;
  }
}

function getTypeBadge(type: AlertRuleType) {
  switch (type) {
    case "BUDGET":
      return {
        label: "Presupuesto",
        className: "border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900",
      };
    case "FIXED_THRESHOLD":
      return {
        label: "Umbral Fijo USD",
        className: "border-[#2563EB] text-[#2563EB] bg-white dark:bg-slate-900",
      };
    case "ANOMALY_PERCENT":
      return {
        label: "Anomalía AI",
        className: "border-[#0284C7] text-[#0284C7] bg-white dark:bg-slate-900",
      };
    case "FORECAST_OVERRUN":
      return {
        label: "Forecast EOM",
        className: "border-[#38BDF8] text-[#0284C7] bg-white dark:bg-slate-900",
      };
    default:
      return {
        label: type,
        className: "border-slate-300 text-slate-600 bg-white dark:bg-slate-900",
      };
  }
}

// ─── Modal de Creación / Edición de Regla (3 Pasos) ───
interface RuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  tenantId: string;
  initialRule?: SelfServiceAlertRule | null;
}

function CreateOrEditRuleModal({ isOpen, onClose, onSaved, tenantId, initialRule }: RuleModalProps) {
  const t = useTranslations("SelfServiceAlerts");
  const { instance, accounts } = useMsal();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<AlertTestResult | null>(null);

  const [name, setName] = useState(initialRule?.name || "");
  const [alertType, setAlertType] = useState<AlertRuleType>(initialRule?.alertType || "BUDGET");
  const [scopeType, setScopeType] = useState<AlertScopeType>(initialRule?.scopeType || "TENANT");
  const [scopeValue, setScopeValue] = useState(initialRule?.scopeValue || "Tenant Completo");
  const [thresholdValue, setThresholdValue] = useState<number>(initialRule?.thresholdValue || 80);
  const [thresholdUnit, setThresholdUnit] = useState<"PERCENT" | "USD">(initialRule?.thresholdUnit || "PERCENT");
  const [notificationChannel, setNotificationChannel] = useState<NotificationChannelType>(
    initialRule?.notificationChannel || "TEAMS"
  );
  const [channelTarget, setChannelTarget] = useState(
    initialRule?.channelConfig?.channelTarget || initialRule?.channelConfig?.webhookUrl || ""
  );

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const isMock = isMockTenant(tenantId);
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);

      const syntheticRule: Partial<SelfServiceAlertRule> = {
        id: initialRule?.id || "test-preview",
        name: name || "Regla de Prueba",
        alertType,
        scopeType,
        scopeValue,
        thresholdValue,
        thresholdUnit,
        formattedThreshold: `${thresholdValue} ${thresholdUnit}`,
        notificationChannel,
        channelConfig: { channelTarget, webhookUrl: channelTarget },
      };

      const res = await fetch(`/api/analytics/self-service-alerts/test?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(syntheticRule),
      });

      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        success: false,
        responseMessage: `Error: ${err.message || "Fallo en la prueba"}`,
        testedAt: new Date().toISOString(),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const isMock = isMockTenant(tenantId);
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);

      const payload = {
        name,
        alertType,
        scopeType,
        scopeValue,
        thresholdValue,
        thresholdUnit,
        notificationChannel,
        channelTarget,
      };

      const res = await fetch(`/api/analytics/self-service-alerts?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSaved();
        onClose();
      }
    } catch (err) {
      console.error("Error guardando regla:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 z-[100] space-y-6">
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <IconBellRinging className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
            <div>
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
                {initialRule ? "Editar Regla de Alerta" : "Nueva Regla de Alerta Self-Service"}
              </h3>
              <p className="text-xs text-slate-500">Paso {step} de 3 — Configuración de Disparo y Destino</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Indicador de Pasos */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { n: 1, label: "Tipo y Alcance" },
            { n: 2, label: "Condición" },
            { n: 3, label: "Canal y Destino" },
          ].map((s) => (
            <div
              key={s.n}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold text-center border transition ${
                step === s.n
                  ? "border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900"
                  : "border-slate-200 dark:border-slate-800 text-slate-400 bg-slate-50 dark:bg-slate-800/30"
              }`}
            >
              {s.n}. {s.label}
            </div>
          ))}
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* PASO 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                  {t("ruleName")}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ej. Alerta Presupuesto AKS > 85%"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                    {t("alertType")}
                  </label>
                  <select
                    value={alertType}
                    onChange={(e) => setAlertType(e.target.value as AlertRuleType)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                  >
                    <option value="BUDGET">{t("typeBudget")}</option>
                    <option value="FIXED_THRESHOLD">{t("typeFixed")}</option>
                    <option value="ANOMALY_PERCENT">{t("typeAnomaly")}</option>
                    <option value="FORECAST_OVERRUN">{t("typeForecast")}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                    Alcance (Scope)
                  </label>
                  <select
                    value={scopeType}
                    onChange={(e) => setScopeType(e.target.value as AlertScopeType)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                  >
                    <option value="TENANT">{t("scopeTenant")}</option>
                    <option value="SUBSCRIPTION">{t("scopeSubscription")}</option>
                    <option value="RESOURCE_GROUP">{t("scopeRg")}</option>
                    <option value="TAG">{t("scopeCostCenter")}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                  {t("scopeValue")}
                </label>
                <input
                  type="text"
                  required
                  value={scopeValue}
                  onChange={(e) => setScopeValue(e.target.value)}
                  placeholder="ej. CSCS-LandingZone o rg-production"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                />
              </div>
            </div>
          )}

          {/* PASO 2 */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                    {t("thresholdValue")}
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={thresholdValue}
                    onChange={(e) => setThresholdValue(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                    {t("thresholdUnit")}
                  </label>
                  <select
                    value={thresholdUnit}
                    onChange={(e) => setThresholdUnit(e.target.value as "PERCENT" | "USD")}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                  >
                    <option value="PERCENT">{t("unitPercent")}</option>
                    <option value="USD">{t("unitDollars")}</option>
                  </select>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 text-xs space-y-1">
                <span className="font-bold text-[#0054A6] flex items-center gap-1">
                  <IconSparkles className="w-4 h-4 text-[#0078D4]" />
                  {t("conditionPreview")}
                </span>
                <p className="text-slate-600 dark:text-slate-300">
                  La alerta se emitirá cuando el gasto en <strong>{scopeValue}</strong> supere{" "}
                  <strong>
                    {thresholdUnit === "PERCENT" ? `${thresholdValue}%` : `$${thresholdValue.toFixed(2)} USD`}
                  </strong>{" "}
                  bajo el criterio de <strong>{alertType}</strong>.
                </p>
              </div>
            </div>
          )}

          {/* PASO 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                  {t("notificationChannel")}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: "TEAMS", label: "Microsoft Teams", Icon: IconBrandTeams },
                    { id: "SLACK", label: "Slack", Icon: IconBrandSlack },
                    { id: "EMAIL", label: "Correo Electrónico", Icon: IconMail },
                    { id: "SERVICENOW", label: "ServiceNow", Icon: IconServer },
                    { id: "WEBHOOK", label: "Custom Webhook", Icon: IconWebhook },
                  ].map((ch) => (
                    <button
                      type="button"
                      key={ch.id}
                      onClick={() => setNotificationChannel(ch.id as NotificationChannelType)}
                      className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                        notificationChannel === ch.id
                          ? "border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 shadow-xs"
                          : "border-slate-200 dark:border-slate-800 text-slate-500 bg-slate-50 dark:bg-slate-800/30"
                      }`}
                    >
                      <ch.Icon className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                      <span className="truncate">{ch.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                  Destino / Endpoint / Emails
                </label>
                <input
                  type="text"
                  required
                  value={channelTarget}
                  onChange={(e) => setChannelTarget(e.target.value)}
                  placeholder={
                    notificationChannel === "EMAIL"
                      ? "alertas@empresa.com, lead@empresa.com"
                      : "https://outlook.office.com/webhook/..."
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                />
              </div>

              {/* Botón de Test y Resultado */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting || !channelTarget}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <IconSend className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                  <span>{isTesting ? "Enviando Prueba..." : "Probar Conexión Ahora"}</span>
                </button>

                {testResult && (
                  <div
                    className={`mt-2 p-3 rounded-xl border text-xs flex items-start gap-2 ${
                      testResult.success
                        ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
                        : "border-red-200 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
                    }`}
                  >
                    {testResult.success ? (
                      <IconCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <IconAlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-bold block">
                        {testResult.success ? "Prueba Exitosa" : "Fallo de Prueba"} (HTTP {testResult.httpStatusCode || 200})
                      </span>
                      <span>{testResult.responseMessage}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Botones de Navegación del Wizard */}
          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as any)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer shadow-xs"
              >
                Anterior
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s + 1) as any)}
                  disabled={!name || !scopeValue}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 transition cursor-pointer shadow-xs disabled:opacity-50"
                >
                  Siguiente
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSaving || !channelTarget}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSaving ? "Guardando..." : "Guardar Regla de Alerta"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal de Inspección de Prueba / Payload Preview ───
interface TestModalProps {
  rule: SelfServiceAlertRule | null;
  onClose: () => void;
  tenantId: string;
}

function TestResultModal({ rule, onClose, tenantId }: TestModalProps) {
  const t = useTranslations("SelfServiceAlerts");
  const { instance, accounts } = useMsal();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AlertTestResult | null>(null);

  React.useEffect(() => {
    if (!rule) {
      setResult(null);
      return;
    }
    const runTest = async () => {
      setLoading(true);
      try {
        const isMock = isMockTenant(tenantId);
        const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);
        const res = await fetch(`/api/analytics/self-service-alerts/test?tenantId=${encodeURIComponent(tenantId)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(rule),
        });
        const data = await res.json();
        setResult(data);
      } catch (err: any) {
        setResult({
          success: false,
          responseMessage: `Error: ${err.message}`,
          testedAt: new Date().toISOString(),
        });
      } finally {
        setLoading(false);
      }
    };
    runTest();
  }, [rule, tenantId, instance, accounts]);

  if (!rule) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 z-[100] space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <IconSend className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              Prueba de Entrega: {rule.name}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Canal Destino:</span>
            <span className="font-bold text-[#0054A6]">{rule.notificationChannel}</span>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 text-xs">
            <span className="text-slate-400 block mb-1">Endpoint / Destinatarios:</span>
            <span className="font-mono text-slate-700 dark:text-slate-200 break-all">
              {rule.channelConfig.channelTarget || rule.channelConfig.webhookUrl || "No configurado"}
            </span>
          </div>

          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <IconRotateClockwise className="w-4 h-4 animate-spin text-[#0078D4]" />
              <span>Despachando payload de prueba al destino...</span>
            </div>
          ) : result ? (
            <div className="space-y-3">
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  result.success
                    ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
                    : "border-red-200 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
                }`}
              >
                {result.success ? (
                  <IconCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <IconAlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <span className="font-bold block">
                    {result.success ? "Entrega Exitosa" : "Fallo de Envío"} (HTTP {result.httpStatusCode || 200})
                  </span>
                  <span>{result.responseMessage}</span>
                </div>
              </div>

              {result.payloadPreview && (
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                    <IconCode className="w-3.5 h-3.5 text-[#0078D4]" />
                    Payload Estructurado Enviado:
                  </span>
                  <pre className="p-3 text-[11px] font-mono rounded-xl bg-slate-900 text-slate-100 overflow-x-auto max-h-48 leading-relaxed border border-slate-800">
                    {JSON.stringify(result.payloadPreview, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer shadow-xs"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function SelfServiceAlertsPanel() {
  const t = useTranslations("SelfServiceAlerts");
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

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock, t), [instance, accounts, isMock, t]);
  const apiUrl = `/api/analytics/self-service-alerts?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<SelfServiceAlertsPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<SelfServiceAlertRule | null>(null);
  const [testingRule, setTestingRule] = useState<SelfServiceAlertRule | null>(null);

  // Filtros y Búsqueda
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<string>("MOST_FIRED");

  const metrics = data?.metrics;
  const rawRules = useMemo(() => metrics?.rules || [], [metrics]);

  // Filtrado y Orden
  const filteredRules = useMemo(() => {
    return rawRules
      .filter((r) => {
        if (typeFilter !== "ALL" && r.alertType !== typeFilter) return false;
        if (channelFilter !== "ALL" && r.notificationChannel !== channelFilter) return false;
        if (statusFilter === "ACTIVE" && !r.isEnabled) return false;
        if (statusFilter === "PAUSED" && r.isEnabled) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const matchName = r.name.toLowerCase().includes(q);
          const matchScope = r.scopeValue.toLowerCase().includes(q);
          const matchChannel = r.notificationChannel.toLowerCase().includes(q);
          if (!matchName && !matchScope && !matchChannel) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "MOST_FIRED") return (b.fireCount || 0) - (a.fireCount || 0);
        if (sortBy === "NAME") return a.name.localeCompare(b.name);
        if (sortBy === "THRESHOLD") return b.thresholdValue - a.thresholdValue;
        if (sortBy === "LAST_TRIGGERED") {
          const tA = a.lastFiredTimestamp ? new Date(a.lastFiredTimestamp).getTime() : 0;
          const tB = b.lastFiredTimestamp ? new Date(b.lastFiredTimestamp).getTime() : 0;
          return tB - tA;
        }
        return 0;
      });
  }, [rawRules, typeFilter, channelFilter, statusFilter, searchTerm, sortBy]);

  const { paged, page, totalPages, pageSize, setPage, setPageSize, total } = usePagination(filteredRules, 15);

  const handleToggleState = async (rule: SelfServiceAlertRule) => {
    try {
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      const nextState = !rule.isEnabled;

      // Optimistic update
      mutate(
        (prev) => {
          if (!prev) return prev;
          const updated = prev.metrics.rules.map((r) => (r.id === rule.id ? { ...r, isEnabled: nextState } : r));
          return {
            ...prev,
            metrics: {
              ...prev.metrics,
              activeRulesCount: updated.filter((r) => r.isEnabled).length,
              pausedRulesCount: updated.filter((r) => !r.isEnabled).length,
              rules: updated,
            },
          };
        },
        false
      );

      await fetch(`/api/analytics/self-service-alerts?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "TOGGLE_STATE", ruleId: rule.id, isEnabled: nextState }),
      });

      mutate();
    } catch (err) {
      console.error("Error cambiando estado:", err);
      mutate();
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!window.confirm("¿Seguro que deseas eliminar esta regla de alerta?")) return;
    try {
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      await fetch(
        `/api/analytics/self-service-alerts?tenantId=${encodeURIComponent(tenantId)}&ruleId=${encodeURIComponent(
          ruleId
        )}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      mutate();
    } catch (err) {
      console.error("Error eliminando regla:", err);
    }
  };

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado y Acciones Principales ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconBellRinging className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>Alertas Self-Service</span>
            </h1>
            <InfoTooltip content={t("pageTooltip")} />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {isMock ? "Entorno Demo" : "Producción Live"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Gobernanza de notificaciones financieras hacia Microsoft Teams, Slack, Webhooks, Email y ServiceNow
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
            title="Recargar reglas"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
            <span>{t("refresh")}</span>
          </button>

          <button
            onClick={() => {
              setEditingRule(null);
              setIsModalOpen(true);
            }}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconPlus className="w-4 h-4" />
            <span>{t("newRule")}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 flex items-start gap-3">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── 4 KPI Cards Superiores ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Reglas Configuradas",
            tip: "Total de reglas de alerta creadas para este tenant.",
            value: `${metrics?.totalRulesCount ?? 0} reglas`,
            sub: `${metrics?.activeRulesCount ?? 0} Activas · ${metrics?.pausedRulesCount ?? 0} Pausadas`,
            Icon: IconBellRinging,
          },
          {
            label: "Disparos en los Últimos 30 Días",
            tip: "Total acumulado de notificaciones y webhooks emitidos.",
            value: `${metrics?.totalFiredEventsLast30Days ?? 0} eventos`,
            sub: "Eventos de alerta despachados",
            Icon: IconFlame,
          },
          {
            label: "Canales Integrados",
            tip: "Número de canales únicos de notificación conectados (Teams, Slack, Webhook, Email, ServiceNow).",
            value: `${metrics?.uniqueChannelsCount ?? 0} canales`,
            sub: "Teams, Slack, Webhook, Email, ServiceNow",
            Icon: IconShare,
          },
          {
            label: "Cobertura de Presupuesto",
            tip: "Porcentaje de reglas activas orientadas al cumplimiento presupuestario.",
            value: `${metrics?.budgetCoveragePercentage ?? 0}%`,
            sub: "Protección contra sobrecostos",
            Icon: IconShieldCheck,
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
              <div className="text-2xl font-extrabold truncate text-[#1B2A41] dark:text-slate-100" title={c.value}>
                {c.value}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{c.sub}</div>
            </div>
            <c.Icon className="w-8 h-8 text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Barra de Herramientas y Filtros (Ancho 100%) ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Buscador */}
          <div className="relative flex-1 min-w-[200px]">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" stroke={1.5} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
            />
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200 focus:outline-none focus:border-[#0054A6]"
            >
              <option value="ALL">{t("filterTypeAll")}</option>
              <option value="BUDGET">{t("filterBudget")}</option>
              <option value="FIXED_THRESHOLD">{t("typeFixed")}</option>
              <option value="ANOMALY_PERCENT">{t("filterAnomalies")}</option>
              <option value="FORECAST_OVERRUN">Forecast EOM</option>
            </select>

            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200 focus:outline-none focus:border-[#0054A6]"
            >
              <option value="ALL">{t("filterChannelAll")}</option>
              <option value="TEAMS">Microsoft Teams</option>
              <option value="SLACK">Slack</option>
              <option value="EMAIL">{t("channelEmail")}</option>
              <option value="SERVICENOW">ServiceNow</option>
              <option value="WEBHOOK">Webhook</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200 focus:outline-none focus:border-[#0054A6]"
            >
              <option value="ALL">{t("filterStatusAll")}</option>
              <option value="ACTIVE">{t("statusActive")}</option>
              <option value="PAUSED">{t("statusPaused")}</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-200 focus:outline-none focus:border-[#0054A6]"
            >
              <option value="MOST_FIRED">{t("sortMostTriggered")}</option>
              <option value="LAST_TRIGGERED">{t("sortLastFired")}</option>
              <option value="NAME">{t("sortName")}</option>
              <option value="THRESHOLD">{t("sortThreshold")}</option>
            </select>
          </div>
        </div>
      </div>

      {/* ─── Tabla "Reglas de Alerta Self-Service" (Estándar CMP & macOS Scroll) ─── */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconAdjustmentsHorizontal className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">{t("tableTitle")}</h2>
            <InfoTooltip content={t("tableTooltip")} />
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900">
            {filteredRules.length} Reglas Registradas
          </span>
        </div>

        <div className={`overflow-x-auto ${VISIBLE_SCROLLBAR}`}>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/30">
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[200px]">{t("colRuleScope")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[130px]">{t("colType")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[140px]">{t("colThreshold")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[140px]">{t("colChannel")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[120px]">{t("colStatus")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[130px]">{t("colLastFired")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 min-w-[100px]">{t("colTriggers")}</th>
                <th className="py-3 px-4 font-bold text-[#1B2A41] dark:text-slate-200 text-right min-w-[200px]">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    {t("emptyFiltered")}
                  </td>
                </tr>
              ) : (
                paged.map((rule) => {
                  const badge = getTypeBadge(rule.alertType);
                  const ChannelIcon = getChannelIcon(rule.notificationChannel);

                  return (
                    <tr key={rule.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                          <IconBellRinging className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span>{rule.name}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pl-5">
                          {rule.scopeType}: {rule.scopeValue}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-lg border ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-bold text-[#1B2A41] dark:text-slate-100">{rule.formattedThreshold}</span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <ChannelIcon className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            {rule.notificationChannel}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[140px]" title={rule.channelConfig.channelTarget}>
                          {rule.channelConfig.channelTarget || rule.channelConfig.webhookUrl || "—"}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleState(rule)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                            rule.isEnabled
                              ? "border-emerald-500 text-emerald-600 bg-white dark:bg-slate-900"
                              : "border-slate-300 dark:border-slate-700 text-slate-400 bg-white dark:bg-slate-900"
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              rule.isEnabled ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          />
                          <span>{rule.isEnabled ? "Activa" : "Pausada"}</span>
                        </button>
                      </td>

                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        {rule.lastFiredTimestamp
                          ? new Date(rule.lastFiredTimestamp).toLocaleDateString("es-ES")
                          : "—"}
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                        {rule.fireCount} veces
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setTestingRule(rule)}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1 cursor-pointer shadow-xs"
                            title={t("testDispatch")}
                          >
                            <IconSend className="w-3 h-3 text-[#0078D4]" />
                            <span>Probar</span>
                          </button>

                          <button
                            onClick={() => {
                              setEditingRule(rule);
                              setIsModalOpen(true);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                            title="Editar regla"
                          >
                            <span>Editar</span>
                          </button>

                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="p-1 text-slate-400 hover:text-red-600 transition cursor-pointer"
                            title="Eliminar regla"
                          >
                            <IconTrash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación CMP */}
        <div className="pt-2">
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

      {/* ─── Modales ─── */}
      <CreateOrEditRuleModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingRule(null);
        }}
        onSaved={() => mutate()}
        tenantId={tenantId}
        initialRule={editingRule}
      />

      <TestResultModal
        rule={testingRule}
        onClose={() => setTestingRule(null)}
        tenantId={tenantId}
      />
    </div>
  );
}

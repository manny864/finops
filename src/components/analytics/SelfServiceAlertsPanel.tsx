"use client";
import { useTranslations, useLocale } from "next-intl";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useSubscription } from "@/components/SubscriptionProvider";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
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
  IconCopy,
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

/**
 * El resultado del test viene del servidor, que no conoce el locale del
 * usuario: manda `messageKey` + `messageParams` y `responseMessage` en
 * castellano como fallback (que es ademas lo que se loguea). Misma convencion
 * que `nameKey` / `scopeValueKey`.
 */
function testResultMessage(
  result: AlertTestResult,
  t: (k: string, v?: Record<string, string | number>) => string
) {
  return result.messageKey ? t(result.messageKey, result.messageParams) : result.responseMessage;
}

/**
 * El umbral se re-formatea en el panel en vez de mostrar `formattedThreshold`.
 * Esa cadena la arma `formatAlertThreshold()` del servicio y sale en castellano
 * a proposito: viaja en los payloads de Teams/Slack/ServiceNow/email, no solo
 * por pantalla. Traducirla en el servicio cambiaria tambien lo que se despacha.
 */
function formatThresholdLabel(rule: SelfServiceAlertRule, t: (k: string, v?: Record<string, string>) => string) {
  const pct = (rule.thresholdValue || 0).toFixed(1);
  switch (rule.alertType) {
    case "BUDGET":
      return t("thrBudget", { pct });
    case "ANOMALY_PERCENT":
      return t("thrAnomaly", { pct });
    case "FORECAST_OVERRUN":
      return t("thrForecast", { pct });
    default:
      return rule.formattedThreshold;
  }
}

function getTypeBadge(type: AlertRuleType, t: (k: string) => string) {
  switch (type) {
    case "BUDGET":
      return {
        label: t("badgeBudget"),
        className: "border-[#0078D4] text-[#0078D4] bg-white dark:bg-slate-900",
      };
    case "FIXED_THRESHOLD":
      return {
        label: t("badgeFixed"),
        className: "border-[#2563EB] text-[#2563EB] bg-white dark:bg-slate-900",
      };
    case "ANOMALY_PERCENT":
      return {
        label: t("badgeAnomaly"),
        className: "border-[#0284C7] text-[#0284C7] bg-white dark:bg-slate-900",
      };
    case "FORECAST_OVERRUN":
      return {
        label: t("badgeForecast"),
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
  const locale = useLocale();
  const { instance, accounts } = useMsal();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<AlertTestResult | null>(null);

  const [name, setName] = useState(initialRule?.name || "");
  const [alertType, setAlertType] = useState<AlertRuleType>(initialRule?.alertType || "BUDGET");
  const [scopeType, setScopeType] = useState<AlertScopeType>(initialRule?.scopeType || "TENANT");
  const [scopeValue, setScopeValue] = useState(initialRule?.scopeValue || t("scopeTenant"));
  const [thresholdValue, setThresholdValue] = useState<number>(initialRule?.thresholdValue || 80);
  const [thresholdUnit, setThresholdUnit] = useState<"PERCENT" | "USD">(initialRule?.thresholdUnit || "PERCENT");
  const [notificationChannel, setNotificationChannel] = useState<NotificationChannelType>(
    initialRule?.notificationChannel || "TEAMS"
  );
  const [channelTarget, setChannelTarget] = useState(
    initialRule?.channelConfig?.channelTarget ||
      initialRule?.channelConfig?.webhookUrl ||
      (initialRule?.channelConfig?.recipients ? initialRule.channelConfig.recipients.join(", ") : "") ||
      initialRule?.channelConfig?.serviceNowEndpoint ||
      ""
  );
  // Un guardado que falla no puede quedar mudo: antes el modal se quedaba
  // abierto sin decir nada y parecia que el boton no hacia nada.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState(false);

  const canAdvanceStep1 = Boolean(name.trim() && (scopeType === "TENANT" || Boolean(scopeValue)));
  const canAdvanceStep2 = thresholdValue !== undefined && thresholdValue !== null && !isNaN(thresholdValue);
  const isFormValid = Boolean(canAdvanceStep1 && canAdvanceStep2 && channelTarget.trim());

  const { subscriptions, selectedSubscription } = useSubscription();
  const subQuery =
    selectedSubscription && selectedSubscription !== "All"
      ? `&subscriptionId=${encodeURIComponent(selectedSubscription)}`
      : "";
  // Los RG y centros de costos salen de Azure ARG y de la DB; las suscripciones
  // ya las tiene el provider con nombre, sin pegarle otra vez a Azure.
  //
  // Con el MISMO fetcher que el resto del panel: un `fetch` pelado no manda el
  // bearer y la ruta contesta 401, que se veia en la UI como "no hay valores
  // para este tipo de alcance" en vez de como un error.
  const fetcherConToken = useMemo(
    () => buildFetcher(instance, accounts, isMockTenant(tenantId), () => "scope-options"),
    [instance, accounts, tenantId]
  );
  const { data: scopeData, error: scopeError, isLoading: scopeLoading } = useSWR<{ resourceGroups?: string[]; costCenters?: string[] }>(
    tenantId ? `/api/analytics/self-service-alerts/scope-options?tenantId=${encodeURIComponent(tenantId)}${subQuery}` : null,
    fetcherConToken,
    { revalidateOnFocus: false }
  );

  const opcionesDeAlcance = useMemo(() => {
    const lista = (nombres: string[] = []) => nombres.map((n) => ({ valor: n, etiqueta: n }));
    if (scopeType === "SUBSCRIPTION") {
      // El valor guardado es el id --es lo que identifica la suscripcion-- pero
      // se muestra el nombre, que es lo unico que el usuario reconoce.
      return subscriptions.map((s) => ({ valor: s.id, etiqueta: s.name || s.id }));
    }
    if (scopeType === "RESOURCE_GROUP") return lista(scopeData?.resourceGroups);
    if (scopeType === "TAG") return lista(scopeData?.costCenters);
    return [];
  }, [scopeType, subscriptions, scopeData]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const isMock = isMockTenant(tenantId);
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);

      const syntheticRule: Partial<SelfServiceAlertRule> = {
        id: initialRule?.id || "test-preview",
        name: name || t("testRuleName"),
        alertType,
        scopeType,
        scopeValue,
        thresholdValue,
        thresholdUnit,
        formattedThreshold: `${thresholdValue} ${thresholdUnit}`,
        notificationChannel,
        channelConfig: { channelTarget, webhookUrl: channelTarget },
      };

      const res = await fetch(
        `/api/analytics/self-service-alerts/test?tenantId=${encodeURIComponent(tenantId)}&locale=${encodeURIComponent(locale)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(syntheticRule),
        }
      );

      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        success: false,
        responseMessage: `Error: ${err.message || t("testFailedFallback")}`,
        testedAt: new Date().toISOString(),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopyTarget = async () => {
    if (!channelTarget) return;
    try {
      await navigator.clipboard.writeText(channelTarget);
      setCopiedTarget(true);
      setTimeout(() => setCopiedTarget(false), 2000);
    } catch (err) {
      console.error("Error copiando destino:", err);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isFormValid || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const isMock = isMockTenant(tenantId);
      const token = isMock ? "demo" : await getFreshIdToken(instance, accounts[0], ["User.Read"]);

      const payload = {
        name: name.trim(),
        alertType,
        scopeType,
        scopeValue,
        thresholdValue,
        thresholdUnit,
        notificationChannel,
        channelTarget: channelTarget.trim(),
      };

      // Editar es PUT sobre la regla: con POST se creaba una segunda regla
      // identica en vez de modificar la que se estaba editando.
      const esEdicion = Boolean(initialRule?.id);
      const url = esEdicion
        ? `/api/analytics/self-service-alerts?tenantId=${encodeURIComponent(tenantId)}&ruleId=${encodeURIComponent(initialRule!.id)}`
        : `/api/analytics/self-service-alerts?tenantId=${encodeURIComponent(tenantId)}`;

      const res = await fetch(url, {
        method: esEdicion ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const detalle = await res.json().catch(() => null);
        setSaveError(detalle?.error || t("saveFailed"));
      }
    } catch (err) {
      console.error("Error guardando regla:", err);
      setSaveError(errorMessage(err) || t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 z-[100] space-y-6"
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <IconBellRinging className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
            <div>
              <h3 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">
                {initialRule ? t("modalEditTitle") : t("modalNewTitle")}
              </h3>
              <p className="text-xs text-slate-500">{t("stepHeader", { step })}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Indicador de Pasos Interactivo */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { n: 1, label: t("step1") },
            { n: 2, label: t("step2") },
            { n: 3, label: t("step3") },
          ].map((s) => {
            const isCurrent = step === s.n;
            // En modo edición siempre se puede saltar directamente a cualquier paso.
            // En modo creación se permite navegar a pasos anteriores o si los campos previos están completos.
            const canNavigate =
              Boolean(initialRule) ||
              s.n <= step ||
              (s.n === 2 && canAdvanceStep1) ||
              (s.n === 3 && canAdvanceStep1 && canAdvanceStep2);

            return (
              <button
                key={s.n}
                type="button"
                disabled={!canNavigate}
                onClick={() => setStep(s.n as 1 | 2 | 3)}
                aria-current={isCurrent ? "step" : undefined}
                className={`py-2 px-3 rounded-xl text-xs font-semibold text-center border transition flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                  isCurrent
                    ? "border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/30 shadow-xs font-bold ring-1 ring-[#0054A6]/20"
                    : canNavigate
                    ? "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-[#0078D4] hover:text-[#0078D4] bg-slate-50 dark:bg-slate-800/30"
                    : "border-slate-200 dark:border-slate-800 text-slate-400 bg-slate-50 dark:bg-slate-800/30"
                }`}
              >
                <span>{s.n}.</span>
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>

        <form
          onSubmit={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault();
            }
          }}
          className="space-y-4"
        >
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
                  placeholder={t("ruleNamePlaceholder")}
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
                    {t("scopeLabel")}
                  </label>
                  <select
                    value={scopeType}
                    onChange={(e) => {
                      const tipo = e.target.value as AlertScopeType;
                      setScopeType(tipo);
                      setScopeValue(tipo === "TENANT" ? t("scopeTenant") : "");
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                  >
                    <option value="TENANT">{t("scopeTenant")}</option>
                    <option value="SUBSCRIPTION">{t("scopeSubscription")}</option>
                    <option value="RESOURCE_GROUP">{t("scopeRg")}</option>
                    <option value="TAG">{t("scopeCostCenter")}</option>
                  </select>
                </div>
              </div>

              {scopeType !== "TENANT" && (
                <div>
                  <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200 mb-1">
                    {t("scopeValue")}
                  </label>
                  <select
                    required
                    value={scopeValue}
                    onChange={(e) => setScopeValue(e.target.value)}
                    disabled={(scopeType !== "SUBSCRIPTION" && scopeLoading) || opcionesDeAlcance.length === 0}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6] disabled:opacity-60"
                  >
                    <option value="">
                      {scopeType !== "SUBSCRIPTION" && scopeLoading
                        ? t("scopeOptionsLoading")
                        : t("scopeValuePlaceholder")}
                    </option>
                    {opcionesDeAlcance.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.etiqueta}
                      </option>
                    ))}
                  </select>
                  {scopeType !== "SUBSCRIPTION" && scopeLoading ? (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                      <IconRotateClockwise className="w-3.5 h-3.5 animate-spin text-[#0078D4]" />
                      {t("scopeOptionsLoading")}
                    </p>
                  ) : (
                    opcionesDeAlcance.length === 0 && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {scopeError ? t("scopeOptionsError") : t("scopeNoOptions")}
                      </p>
                    )
                  )}
                </div>
              )}
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
                  {t.rich("conditionPreviewText", { scope: scopeValue, threshold: thresholdUnit === "PERCENT" ? `${thresholdValue}%` : `$${thresholdValue.toFixed(2)} USD`, type: alertType, b: (c) => <strong>{c}</strong> })}
                  
                    
                  
                  
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
                    { id: "EMAIL", label: t("channelEmail"), Icon: IconMail },
                    { id: "SERVICENOW", label: "ServiceNow", Icon: IconServer },
                    { id: "WEBHOOK", label: "Custom Webhook", Icon: IconWebhook },
                  ].map((ch) => (
                    <button
                      type="button"
                      key={ch.id}
                      onClick={() => setNotificationChannel(ch.id as NotificationChannelType)}
                      className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                        notificationChannel === ch.id
                          ? "border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs"
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                    {t("destinationLabel")}
                  </label>
                  {channelTarget.trim() && (
                    <button
                      type="button"
                      onClick={handleCopyTarget}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0054A6] dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition cursor-pointer px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40"
                      title={t("copy")}
                    >
                      {copiedTarget ? (
                        <>
                          <IconCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{t("copied")}</span>
                        </>
                      ) : (
                        <>
                          <IconCopy className="w-3.5 h-3.5" />
                          <span>{t("copy")}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={channelTarget}
                    onChange={(e) => setChannelTarget(e.target.value)}
                    placeholder={
                      notificationChannel === "EMAIL"
                        ? t("emailPlaceholder")
                        : "https://outlook.office.com/webhook/..."
                    }
                    className="w-full px-3 py-2 pr-10 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#1B2A41] dark:text-slate-100 focus:outline-none focus:border-[#0054A6]"
                  />
                  {channelTarget.trim() && (
                    <button
                      type="button"
                      onClick={handleCopyTarget}
                      title={copiedTarget ? t("copied") : t("copy")}
                      aria-label={copiedTarget ? t("copied") : t("copy")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-[#0054A6] dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                    >
                      {copiedTarget ? (
                        <IconCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <IconCopy className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Botón de Test y Resultado */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting || !channelTarget}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <IconSend className="w-3.5 h-3.5 text-[#0078D4]" stroke={1.5} />
                  <span>{isTesting ? t("testingNow") : t("testConnection")}</span>
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
                        {testResult.success ? t("testSuccess") : t("testFailure")} (HTTP {testResult.httpStatusCode || 200})
                      </span>
                      <span>{testResultMessage(testResult, t)}</span>
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
                key="btn-prev"
                type="button"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer shadow-xs"
              >
                {t("prev")}
              </button>
            ) : (
              <button
                key="btn-cancel"
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer shadow-xs"
              >
                {t("cancel")}
              </button>
            )}

            <div className="flex items-center gap-2">
              {saveError && (
                <span className="text-[11px] font-semibold text-red-600 dark:text-red-400 max-w-[240px] text-right">
                  {saveError}
                </span>
              )}

              {/* En modo edición: botón directo de Guardar Cambios accesible desde cualquier paso */}
              {initialRule ? (
                <>
                  <button
                    key="btn-save-direct"
                    type="button"
                    onClick={() => handleSave()}
                    disabled={isSaving || !isFormValid}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {isSaving ? t("saving") : t("saveChanges")}
                  </button>

                  {step < 3 && (
                    <button
                      key="btn-next"
                      type="button"
                      onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
                      disabled={step === 1 ? !canAdvanceStep1 : !canAdvanceStep2}
                      className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {t("next")}
                    </button>
                  )}
                </>
              ) : (
                /* En modo creación */
                step < 3 ? (
                  <button
                    key="btn-next"
                    type="button"
                    onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
                    disabled={step === 1 ? !canAdvanceStep1 : !canAdvanceStep2}
                    className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {t("next")}
                  </button>
                ) : (
                  <button
                    key="btn-create-rule"
                    type="submit"
                    disabled={isSaving || !isFormValid}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    {isSaving ? t("saving") : t("saveRule")}
                  </button>
                )
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
  const locale = useLocale();
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
        const res = await fetch(
          `/api/analytics/self-service-alerts/test?tenantId=${encodeURIComponent(tenantId)}&locale=${encodeURIComponent(locale)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(rule),
          }
        );
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
              {t("deliveryTestTitle", { name: rule.nameKey ? t(rule.nameKey) : rule.name })}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{t("targetChannel")}</span>
            <span className="font-bold text-[#0054A6]">{rule.notificationChannel}</span>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 text-xs">
            <span className="text-slate-400 block mb-1">{t("endpointRecipients")}</span>
            <span className="font-mono text-slate-700 dark:text-slate-200 break-all">
              {rule.channelConfig.channelTarget || rule.channelConfig.webhookUrl || t("notConfigured")}
            </span>
          </div>

          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <IconRotateClockwise className="w-4 h-4 animate-spin text-[#0078D4]" />
              <span>{t("dispatchingTest")}</span>
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
                    {result.success ? t("deliverySuccess") : t("deliveryFailure")} (HTTP {result.httpStatusCode || 200})
                  </span>
                  <span>{testResultMessage(result, t)}</span>
                </div>
              </div>

              {result.payloadPreview && (
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                    <IconCode className="w-3.5 h-3.5 text-[#0078D4]" />
                    {t("payloadSent")}
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
  const locale = useLocale();
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
    if (!window.confirm(t("confirmDelete"))) return;
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
              <span>{t("pageTitle")}</span>
            </h1>
            <InfoTooltip content={t("pageTooltip")} />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {isMock ? t("demoEnv") : t("liveProd")}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
            title={t("refreshTitle")}
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
            label: t("kpiRules"),
            tip: t("kpiRulesTip"),
            value: t("kpiRulesValue", { n: metrics?.totalRulesCount ?? 0 }),
            sub: t("kpiRulesSub", {
              active: metrics?.activeRulesCount ?? 0,
              paused: metrics?.pausedRulesCount ?? 0,
            }),
            Icon: IconBellRinging,
          },
          {
            label: t("kpiFires"),
            tip: t("kpiFiresTip"),
            value: t("kpiFiresValue", { n: metrics?.totalFiredEventsLast30Days ?? 0 }),
            sub: t("kpiFiresSub"),
            Icon: IconFlame,
          },
          {
            label: t("kpiChannels"),
            tip: t("kpiChannelsTip"),
            value: t("kpiChannelsValue", { n: metrics?.uniqueChannelsCount ?? 0 }),
            sub: "Teams, Slack, Webhook, Email, ServiceNow",
            Icon: IconShare,
          },
          {
            label: t("kpiBudgetCoverage"),
            tip: t("kpiBudgetCoverageTip"),
            value: `${metrics?.budgetCoveragePercentage ?? 0}%`,
            sub: t("kpiBudgetCoverageSub"),
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
              <option value="FORECAST_OVERRUN">{t("badgeForecast")}</option>
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
            {t("rulesRegistered", { n: filteredRules.length })}
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
                  const badge = getTypeBadge(rule.alertType, t);
                  const ChannelIcon = getChannelIcon(rule.notificationChannel);

                  return (
                    <tr key={rule.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                          <IconBellRinging className="w-4 h-4 text-[#0078D4] shrink-0" stroke={1.5} />
                          <span>{rule.nameKey ? t(rule.nameKey) : rule.name}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 pl-5">
                          {rule.scopeType}: {rule.scopeValueKey ? t(rule.scopeValueKey) : rule.scopeValue}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-lg border ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-bold text-[#1B2A41] dark:text-slate-100">{formatThresholdLabel(rule, t)}</span>
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
                              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900"
                              : "border-slate-300 dark:border-slate-700 text-slate-400 bg-white dark:bg-slate-900"
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              rule.isEnabled ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          />
                          <span>{rule.isEnabled ? t("statusActive") : t("statusPaused")}</span>
                        </button>
                      </td>

                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        {rule.lastFiredTimestamp
                          ? new Date(rule.lastFiredTimestamp).toLocaleDateString(locale)
                          : "—"}
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                        {t("firesCount", { n: rule.fireCount })}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setTestingRule(rule)}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50/50 transition flex items-center gap-1 cursor-pointer shadow-xs"
                            title={t("testDispatch")}
                          >
                            <IconSend className="w-3 h-3 text-[#0078D4]" />
                            <span>{t("test")}</span>
                          </button>

                          <button
                            onClick={() => {
                              setEditingRule(rule);
                              setIsModalOpen(true);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                            title={t("editRuleTitle")}
                          >
                            <span>{t("edit")}</span>
                          </button>

                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="p-1 text-slate-400 hover:text-red-600 transition cursor-pointer"
                            title={t("deleteRuleTitle")}
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
      {/* Montado solo mientras esta abierto: el modal inicializa su estado con
          useState(initialRule?...), que en React corre una unica vez por
          montaje. Estando siempre montado, abrir "editar" mostraba el
          formulario vacio y guardaba como si fuera una regla nueva. */}
      {isModalOpen && (
        <CreateOrEditRuleModal
          key={editingRule?.id || "nueva"}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingRule(null);
          }}
          onSaved={() => mutate()}
          tenantId={tenantId}
          initialRule={editingRule}
        />
      )}

      <TestResultModal
        rule={testingRule}
        onClose={() => setTestingRule(null)}
        tenantId={tenantId}
      />
    </div>
  );
}

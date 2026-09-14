/**
 * Servicio Azure FinOps: Motor de Gestión de Alertas y Notificaciones Self-Service
 * Maneja el formateo riguroso de umbrales, métricas de resumen, motor de pruebas de entrega
 * hacia Webhooks / Teams / Slack / ServiceNow / Email y datasets sintéticos deterministas.
 */

import Decimal from "decimal.js";
import {
  AlertRuleType,
  AlertScopeType,
  NotificationChannelType,
  SelfServiceAlertRule,
  AlertsSummaryMetrics,
  SelfServiceAlertsPayload,
  AlertTestResult,
} from "@/types/azureSelfServiceAlerts.types";
import { sendEmailStrict, getAlertTestEmailHtml, getNoReplyDisclaimer } from "@/lib/emailHelper";

/**
 * Formateo Riguroso y Estandarizado de Umbrales
 */
export function formatAlertThreshold(
  alertType: AlertRuleType,
  thresholdValue: number,
  thresholdUnit: "PERCENT" | "USD",
  locale: string = "es"
): string {
  const dec = new Decimal(thresholdValue || 0);
  const loc = (locale || "es").toLowerCase();
  const isEn = loc.startsWith("en");
  const isPt = loc.startsWith("pt");

  switch (alertType) {
    case "BUDGET":
      return isEn
        ? `${dec.toFixed(1)}% of Budget`
        : isPt
        ? `${dec.toFixed(1)}% do Orçamento`
        : `${dec.toFixed(1)}% del Presupuesto`;
    case "FIXED_THRESHOLD":
      return `$${dec.toNumber().toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} USD`;
    case "ANOMALY_PERCENT":
      return isEn
        ? `+${dec.toFixed(1)}% Daily Deviation`
        : isPt
        ? `+${dec.toFixed(1)}% Desvio Diário`
        : `+${dec.toFixed(1)}% Desvío Diario`;
    case "FORECAST_OVERRUN":
      return `${dec.toFixed(1)}% Forecast EOM`;
    default:
      return thresholdUnit === "PERCENT"
        ? `${dec.toFixed(1)}%`
        : `$${dec.toFixed(2)} USD`;
  }
}

/**
 * Textos localizados para el despacho multicanal de alertas (Teams, Slack, ServiceNow, Email, Webhook)
 */
export function getAlertPayloadI18n(locale: string = "es") {
  const loc = (locale || "es").toLowerCase();
  const alertSender = process.env.AZURE_SENDER_EMAIL_ALERTS || process.env.AZURE_SENDER_EMAIL || "alerts@cscloudsolutions.com.ar";
  const disclaimer = getNoReplyDisclaimer(loc);
  if (loc.startsWith("en")) {
    return {
      titlePrefix: "🚨 FinOps Alert",
      slackHeader: "🚨 *FinOps Alert (CSCloudSolutions)*",
      serviceNowShort: "FinOps Cost Alert",
      serviceNowDesc: "Automated alert triggered by CSCloudSolutions FinOps Platform",
      webhookEvent: "FINOPS_ALERT_TRIGGERED",
      webhookMessage: "Automated FinOps alert notification",
      ruleLabel: "Alert Rule",
      typeLabel: "Alert Type",
      scopeLabel: "Scope",
      thresholdLabel: "Configured Threshold",
      detectedLabel: "Detected Value",
      detectedValue: "Exceeded (Test)",
      timestampLabel: "Timestamp",
      statusLabel: "Status",
      statusValue: "Connectivity Test Succeeded",
      noticeLabel: "Notice",
      entireTenant: "Entire Tenant",
      disclaimer,
      testEmailSubject: "🚨 [FinOps Alert Test]",
      testEmailSent: `Test email successfully sent to: {dest} (Sender: ${alertSender}).`,
      noValidRecipient: "No valid email address was specified in the destination.",
      endpointNotConfigured: "No valid URL or destination was configured for channel {channel}.",
      simulatedDemo: "[DEMO SIMULATION] Successful delivery to {channel} ({target}).",
    };
  }
  if (loc.startsWith("pt")) {
    return {
      titlePrefix: "🚨 Alerta FinOps",
      slackHeader: "🚨 *Alerta FinOps (CSCloudSolutions)*",
      serviceNowShort: "Alerta de Custos FinOps",
      serviceNowDesc: "Alerta automático gerado pela plataforma CSCloudSolutions FinOps",
      webhookEvent: "FINOPS_ALERT_TRIGGERED",
      webhookMessage: "Notificação automática de alerta FinOps",
      ruleLabel: "Regra de Alerta",
      typeLabel: "Tipo de Alerta",
      scopeLabel: "Escopo",
      thresholdLabel: "Limite Configurado",
      detectedLabel: "Valor Detectado",
      detectedValue: "Excedido (Teste)",
      timestampLabel: "Data de Emissão",
      statusLabel: "Status",
      statusValue: "Teste de Conectividade Bem-Sucedido",
      noticeLabel: "Aviso",
      entireTenant: "Tenant Completo",
      disclaimer,
      testEmailSubject: "🚨 [Teste de Alerta FinOps]",
      testEmailSent: `E-mail de teste enviado com sucesso para: {dest} (Remitente: ${alertSender}).`,
      noValidRecipient: "Nenhum endereço de e-mail válido foi especificado no destino.",
      endpointNotConfigured: "Nenhuma URL ou destino válido foi configurado para o canal {channel}.",
      simulatedDemo: "[SIMULAÇÃO DEMO] Entrega bem-sucedida para {channel} ({target}).",
    };
  }
  return {
    titlePrefix: "🚨 Alerta FinOps",
    slackHeader: "🚨 *Alerta FinOps (CSCloudSolutions)*",
    serviceNowShort: "Alerta de Costos FinOps",
    serviceNowDesc: "Alerta automático generado por la plataforma CSCloudSolutions FinOps",
    webhookEvent: "FINOPS_ALERT_TRIGGERED",
    webhookMessage: "Notificación automática de alerta FinOps",
    ruleLabel: "Regla de Alerta",
    typeLabel: "Tipo de Alerta",
    scopeLabel: "Alcance",
    thresholdLabel: "Umbral Configurado",
    detectedLabel: "Valor Detectado",
    detectedValue: "Excedido (Prueba)",
    timestampLabel: "Fecha de Emisión",
    statusLabel: "Estado",
    statusValue: "Prueba de Conectividad Exitosa",
    noticeLabel: "Aviso",
    entireTenant: "Tenant Completo",
    disclaimer,
    testEmailSubject: "🚨 [Prueba de Alerta FinOps]",
    testEmailSent: `Correo de prueba enviado exitosamente a: {dest} (Remitente: ${alertSender}).`,
    noValidRecipient: "No se especificó ninguna dirección de correo válida en el destino.",
    endpointNotConfigured: "No se configuró una URL o destino válido para el canal {channel}.",
    simulatedDemo: "[SIMULACIÓN DEMO] Entrega exitosa hacia {channel} ({target}).",
  };
}

/**
 * Calcula las métricas de resumen a partir de las reglas configuradas
 */
export function computeAlertsSummaryMetrics(
  rules: SelfServiceAlertRule[]
): AlertsSummaryMetrics {
  const totalRulesCount = rules.length;
  const activeRulesCount = rules.filter((r) => r.isEnabled).length;
  const pausedRulesCount = totalRulesCount - activeRulesCount;

  const totalFiredEventsLast30Days = rules.reduce(
    (acc, r) => acc + (r.fireCount || 0),
    0
  );

  const uniqueChannels = new Set(rules.map((r) => r.notificationChannel));
  const uniqueChannelsCount = uniqueChannels.size;

  const budgetRules = rules.filter((r) => r.alertType === "BUDGET" && r.isEnabled);
  const budgetCoveragePercentage =
    totalRulesCount === 0
      ? 0
      : Math.min(100, Math.round((budgetRules.length / Math.max(1, totalRulesCount)) * 100));

  return {
    totalRulesCount,
    activeRulesCount,
    pausedRulesCount,
    totalFiredEventsLast30Days,
    uniqueChannelsCount,
    budgetCoveragePercentage,
    rules,
  };
}

/**
 * Genera el payload de prueba simulado para la regla y canal respectivo en el idioma solicitado
 */
export function generateAlertTestPayloadPreview(
  rule: SelfServiceAlertRule,
  locale = "es"
): Record<string, any> {
  const timestamp = new Date().toISOString();
  const i18n = getAlertPayloadI18n(locale);
  const scopeDesc = rule.scopeValue || i18n.entireTenant;

  switch (rule.notificationChannel) {
    case "TEAMS":
      return {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                {
                  type: "TextBlock",
                  text: `${i18n.titlePrefix}: ${rule.name}`,
                  weight: "Bolder",
                  size: "Medium",
                  color: "Attention",
                },
                {
                  type: "FactSet",
                  facts: [
                    { title: `${i18n.typeLabel}:`, value: rule.alertType },
                    { title: `${i18n.scopeLabel}:`, value: `${rule.scopeType} (${scopeDesc})` },
                    { title: `${i18n.thresholdLabel}:`, value: rule.formattedThreshold },
                    { title: `${i18n.detectedLabel}:`, value: i18n.detectedValue },
                    { title: `${i18n.timestampLabel}:`, value: timestamp },
                  ],
                },
              ],
            },
          },
        ],
      };

    case "SLACK":
      return {
        text: `${i18n.slackHeader}: ${rule.name}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${i18n.ruleLabel}:* ${rule.name}\n*${i18n.typeLabel}:* ${rule.alertType}\n*${i18n.scopeLabel}:* ${rule.scopeType} - ${scopeDesc}\n*${i18n.thresholdLabel}:* ${rule.formattedThreshold}\n*${i18n.statusLabel}:* ${i18n.statusValue}`,
            },
          },
        ],
      };

    case "SERVICENOW":
      return {
        short_description: `${i18n.serviceNowShort}: ${rule.name}`,
        description: `${i18n.serviceNowDesc} for scope ${rule.scopeType}:${scopeDesc} surpassing threshold ${rule.formattedThreshold}.`,
        urgency: "2",
        impact: "2",
        category: "Cloud Cost Management",
        assigned_group: "FinOps-Ops",
      };

    case "EMAIL": {
      const target = rule.channelConfig?.channelTarget || "";
      const recipients = rule.channelConfig?.recipients?.length
        ? rule.channelConfig.recipients
        : target ? [target] : ["finops-alerts@empresa.com"];
      const fromSender = process.env.AZURE_SENDER_EMAIL_ALERTS || process.env.AZURE_SENDER_EMAIL || "alerts@cscloudsolutions.com.ar";

      return {
        from: fromSender,
        to: recipients,
        subject: `[${i18n.titlePrefix.replace(/[🚨\s]+/g, "")}] ${rule.name} - ${rule.formattedThreshold}`,
        bodyText: `${i18n.webhookMessage} (${rule.scopeType}: ${scopeDesc}). ${i18n.disclaimer}`,
        disclaimer: i18n.disclaimer,
      };
    }

    case "WEBHOOK":
    default:
      return {
        event: i18n.webhookEvent,
        ruleId: rule.id,
        ruleName: rule.name,
        alertType: rule.alertType,
        locale: locale || "es",
        message: `${i18n.webhookMessage}: ${rule.name}`,
        scope: {
          type: rule.scopeType,
          value: rule.scopeValue,
        },
        threshold: {
          value: rule.thresholdValue,
          unit: rule.thresholdUnit,
          formatted: rule.formattedThreshold,
        },
        timestamp,
        isTest: true,
      };
  }
}

/**
 * Motor de Prueba de Entrega (Test Payload Engine) multilingüe y con soporte de canales
 */
export async function testAlertRuleDelivery(
  rule: SelfServiceAlertRule,
  isMock = false,
  locale = "es"
): Promise<AlertTestResult> {
  const testedAt = new Date().toISOString();
  const i18n = getAlertPayloadI18n(locale);
  const payloadPreview = generateAlertTestPayloadPreview(rule, locale);

  if (isMock) {
    // El guion es el placeholder cuando la regla no trae destino: cualquier
    // texto ahi seria castellano viajando como parametro al catalogo.
    const target = rule.channelConfig.channelTarget || rule.channelConfig.webhookUrl || "—";
    return {
      success: true,
      httpStatusCode: 200,
      responseMessage: i18n.simulatedDemo.replace("{channel}", rule.notificationChannel).replace("{target}", target),
      messageKey: "testDemoSuccess",
      messageParams: { channel: rule.notificationChannel, target },
      testedAt,
      payloadPreview,
    };
  }

  // 1. Si es canal EMAIL, enviar correo de prueba real mediante Microsoft Graph
  if (rule.notificationChannel === "EMAIL") {
    const rawTargets: string[] = [];
    if (Array.isArray(rule.channelConfig?.recipients) && rule.channelConfig.recipients.length > 0) {
      rawTargets.push(...rule.channelConfig.recipients);
    }
    if (rule.channelConfig?.channelTarget) {
      rawTargets.push(rule.channelConfig.channelTarget);
    }
    if (rule.channelConfig?.webhookUrl && !rule.channelConfig.webhookUrl.startsWith("http")) {
      rawTargets.push(rule.channelConfig.webhookUrl);
    }

    const recipients = Array.from(
      new Set(
        rawTargets
          .flatMap((r) => (r || "").split(/[,;\s]+/))
          .map((r) => r.trim())
          .filter((r) => r.includes("@"))
      )
    );

    if (recipients.length === 0) {
      return {
        success: false,
        httpStatusCode: 400,
        responseMessage: i18n.noValidRecipient,
        messageKey: "testEndpointError",
        messageParams: { status: 400, statusText: i18n.noValidRecipient },
        testedAt,
        payloadPreview,
      };
    }

    try {
      const subject = `${i18n.testEmailSubject} ${rule.name || "Regla de Alerta"} - ${rule.formattedThreshold}`;
      const emailHtml = getAlertTestEmailHtml({
        ruleName: rule.name || "Regla de Alerta",
        alertType: rule.alertType,
        scopeType: rule.scopeType,
        scopeValue: rule.scopeValue,
        threshold: rule.formattedThreshold,
        testedAt,
        locale,
      });

      for (const recipient of recipients) {
        await sendEmailStrict(subject, emailHtml, recipient);
      }

      const destList = recipients.join(", ");
      return {
        success: true,
        httpStatusCode: 200,
        responseMessage: i18n.testEmailSent.replace("{dest}", destList),
        messageKey: "testDeliveryConfirmed",
        messageParams: { status: 200 },
        testedAt,
        payloadPreview: {
          ...payloadPreview,
          to: recipients,
        },
      };
    } catch (err: any) {
      const detail = err.message || "Error al enviar correo vía Microsoft Graph";
      console.error("[SelfServiceAlerts:testAlertRuleDelivery] Fallo de envío Graph:", detail);
      return {
        success: false,
        httpStatusCode: 500,
        responseMessage: `Fallo al enviar correo vía Microsoft Graph: ${detail}`,
        messageKey: "testConnectionFailed",
        messageParams: { error: detail },
        testedAt,
        payloadPreview,
      };
    }
  }

  // 2. Si es un Webhook real o Teams/Slack URL, ejecutar el dispatch HTTP
  const targetUrl = rule.channelConfig.webhookUrl || rule.channelConfig.channelTarget;

  if (targetUrl && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CSCloudSolutions-FinOps-Alerts/1.0",
        },
        body: JSON.stringify(payloadPreview),
        signal: AbortSignal.timeout(6000),
      });

      return {
        success: response.ok,
        httpStatusCode: response.status,
        responseMessage: response.ok
          ? `Entrega confirmada (HTTP ${response.status} OK)`
          : `El endpoint respondió con error HTTP ${response.status}: ${response.statusText}`,
        messageKey: response.ok ? "testDeliveryConfirmed" : "testEndpointError",
        messageParams: response.ok
          ? { status: response.status }
          : { status: response.status, statusText: response.statusText },
        testedAt,
        payloadPreview,
      };
    } catch (err: any) {
      const detail = err.message || "Timeout";
      return {
        success: false,
        httpStatusCode: 504,
        responseMessage: `Fallo de conexión al destino: ${detail}`,
        messageKey: "testConnectionFailed",
        messageParams: { error: detail },
        testedAt,
        payloadPreview,
      };
    }
  }

  // Para otros canales sin URL HTTP o destino directo
  return {
    success: false,
    httpStatusCode: 400,
    responseMessage: i18n.endpointNotConfigured.replace("{channel}", rule.notificationChannel),
    messageKey: "testEndpointError",
    messageParams: { status: 400, statusText: "Destino no configurado" },
    testedAt,
    payloadPreview,
  };
}

/**
 * Dataset sintético determinista para modo demo.
 */
export function getMockSelfServiceAlertsPayload(
  tenantId: string
): SelfServiceAlertsPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const mockRules: SelfServiceAlertRule[] = [
    {
      id: "rule-mock-01",
      name: "Consumo Presupuesto General > 80%",
      nameKey: "ruleMock01_name",
      alertType: "BUDGET",
      scopeType: "TENANT",
      scopeValue: "Tenant Completo",
      scopeValueKey: "scopeTenant",
      thresholdValue: 80,
      thresholdUnit: "PERCENT",
      formattedThreshold: formatAlertThreshold("BUDGET", 80, "PERCENT"),
      notificationChannel: "TEAMS",
      channelConfig: {
        channelTarget: "https://outlook.office.com/webhook/teams-finops-channel",
        webhookUrl: "https://outlook.office.com/webhook/teams-finops-channel",
      },
      isEnabled: true,
      lastFiredTimestamp: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
      fireCount: 4,
      createdAt: new Date(Date.now() - 3600000 * 24 * 60).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    },
    {
      id: "rule-mock-02",
      name: "Tope Diario Landing Zone ($500 USD)",
      nameKey: "ruleMock02_name",
      alertType: "FIXED_THRESHOLD",
      scopeType: "SUBSCRIPTION",
      scopeValue: "CSCS-LandingZone-Prod",
      thresholdValue: 500,
      thresholdUnit: "USD",
      formattedThreshold: formatAlertThreshold("FIXED_THRESHOLD", 500, "USD"),
      notificationChannel: "SLACK",
      channelConfig: {
        channelTarget: "https://hooks.slack.com/services/T00/B00/XXXXX",
        webhookUrl: "https://hooks.slack.com/services/T00/B00/XXXXX",
      },
      isEnabled: true,
      lastFiredTimestamp: new Date(Date.now() - 3600000 * 24 * 5).toISOString(),
      fireCount: 7,
      createdAt: new Date(Date.now() - 3600000 * 24 * 45).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 24 * 5).toISOString(),
    },
    {
      id: "rule-mock-03",
      name: "Anomalía Estadística ML (+25% Desvío)",
      nameKey: "ruleMock03_name",
      alertType: "ANOMALY_PERCENT",
      scopeType: "RESOURCE_GROUP",
      scopeValue: "rg-finops-analytics",
      thresholdValue: 25,
      thresholdUnit: "PERCENT",
      formattedThreshold: formatAlertThreshold("ANOMALY_PERCENT", 25, "PERCENT"),
      notificationChannel: "EMAIL",
      channelConfig: {
        recipients: ["finops-alerts@cscloudsolutions.com", "lead-arch@cscloudsolutions.com"],
        channelTarget: "finops-alerts@cscloudsolutions.com",
      },
      isEnabled: true,
      lastFiredTimestamp: new Date(Date.now() - 3600000 * 24 * 1).toISOString(),
      fireCount: 9,
      createdAt: new Date(Date.now() - 3600000 * 24 * 30).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 24 * 1).toISOString(),
    },
    {
      id: "rule-mock-04",
      name: "Forecast Fin de Mes Supera 110%",
      nameKey: "ruleMock04_name",
      alertType: "FORECAST_OVERRUN",
      scopeType: "TENANT",
      scopeValue: "Tenant Completo",
      scopeValueKey: "scopeTenant",
      thresholdValue: 110,
      thresholdUnit: "PERCENT",
      formattedThreshold: formatAlertThreshold("FORECAST_OVERRUN", 110, "PERCENT"),
      notificationChannel: "SERVICENOW",
      channelConfig: {
        serviceNowEndpoint: "https://instance.service-now.com/api/now/table/incident",
        channelTarget: "https://instance.service-now.com/api/now/table/incident",
      },
      isEnabled: isBusiness,
      lastFiredTimestamp: isBusiness ? new Date(Date.now() - 3600000 * 24 * 12).toISOString() : null,
      fireCount: isBusiness ? 2 : 0,
      createdAt: new Date(Date.now() - 3600000 * 24 * 20).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 24 * 12).toISOString(),
    },
  ];

  if (isEnterprise) {
    mockRules.push({
      id: "rule-mock-05",
      name: "Desborde de Costo en Cluster AKS Producción",
      nameKey: "ruleMock05_name",
      alertType: "FIXED_THRESHOLD",
      scopeType: "RESOURCE_GROUP",
      scopeValue: "rg-aks-production-eastus",
      thresholdValue: 2500,
      thresholdUnit: "USD",
      formattedThreshold: formatAlertThreshold("FIXED_THRESHOLD", 2500, "USD"),
      notificationChannel: "WEBHOOK",
      channelConfig: {
        webhookUrl: "https://api.cscloudsolutions.com/webhooks/ops-escalation",
        channelTarget: "https://api.cscloudsolutions.com/webhooks/ops-escalation",
      },
      isEnabled: true,
      lastFiredTimestamp: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
      fireCount: 3,
      createdAt: new Date(Date.now() - 3600000 * 24 * 15).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
    });
  }

  const metrics = computeAlertsSummaryMetrics(mockRules);

  return {
    metrics,
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Ensambla el estado en vivo para tenants conectados reales.
 */
export function assembleLiveSelfServiceAlerts(
  rules: SelfServiceAlertRule[]
): SelfServiceAlertsPayload {
  const metrics = computeAlertsSummaryMetrics(rules);

  return {
    metrics,
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}

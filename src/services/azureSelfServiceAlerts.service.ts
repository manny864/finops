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

/**
 * Formateo Riguroso y Estandarizado de Umbrales
 */
export function formatAlertThreshold(
  alertType: AlertRuleType,
  thresholdValue: number,
  thresholdUnit: "PERCENT" | "USD"
): string {
  const dec = new Decimal(thresholdValue || 0);

  switch (alertType) {
    case "BUDGET":
      return `${dec.toFixed(1)}% del Presupuesto`;
    case "FIXED_THRESHOLD":
      return `$${dec.toNumber().toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} USD`;
    case "ANOMALY_PERCENT":
      return `+${dec.toFixed(1)}% Desvío Diario`;
    case "FORECAST_OVERRUN":
      return `${dec.toFixed(1)}% Forecast EOM`;
    default:
      return thresholdUnit === "PERCENT"
        ? `${dec.toFixed(1)}%`
        : `$${dec.toFixed(2)} USD`;
  }
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
 * Genera el payload de prueba simulado para la regla y canal respectivo
 */
export function generateAlertTestPayloadPreview(
  rule: SelfServiceAlertRule
): Record<string, any> {
  const timestamp = new Date().toISOString();

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
                  text: `🚨 Alerta FinOps: ${rule.name}`,
                  weight: "Bolder",
                  size: "Medium",
                  color: "Attention",
                },
                {
                  type: "FactSet",
                  facts: [
                    { title: "Tipo de Alerta:", value: rule.alertType },
                    { title: "Alcance:", value: `${rule.scopeType} (${rule.scopeValue})` },
                    { title: "Umbral Configurado:", value: rule.formattedThreshold },
                    { title: "Valor Detectado:", value: "Excedido (Prueba)" },
                    { title: "Fecha de Emisión:", value: timestamp },
                  ],
                },
              ],
            },
          },
        ],
      };

    case "SLACK":
      return {
        text: `🚨 *Alerta FinOps (CSCloudSolutions)*: ${rule.name}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Regla:* ${rule.name}\n*Tipo:* ${rule.alertType}\n*Alcance:* ${rule.scopeType} - ${rule.scopeValue}\n*Umbral:* ${rule.formattedThreshold}\n*Estado:* Prueba de Conectividad Exitosa`,
            },
          },
        ],
      };

    case "SERVICENOW":
      return {
        short_description: `FinOps Cost Alert: ${rule.name}`,
        description: `Automated alert triggered by CSCloudSolutions FinOps Platform for scope ${rule.scopeType}:${rule.scopeValue} surpassing threshold ${rule.formattedThreshold}.`,
        urgency: "2",
        impact: "2",
        category: "Cloud Cost Management",
        assigned_group: "FinOps-Ops",
      };

    case "EMAIL":
      return {
        to: rule.channelConfig.recipients || ["finops-alerts@empresa.com"],
        subject: `[Alerta FinOps] ${rule.name} - ${rule.formattedThreshold}`,
        bodyText: `Notificación automática de costo cloud para el alcance ${rule.scopeType}: ${rule.scopeValue}.`,
      };

    case "WEBHOOK":
    default:
      return {
        event: "FINOPS_ALERT_TRIGGERED",
        ruleId: rule.id,
        ruleName: rule.name,
        alertType: rule.alertType,
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
 * Motor de Prueba de Entrega (Test Payload Engine)
 */
export async function testAlertRuleDelivery(
  rule: SelfServiceAlertRule,
  isMock = false
): Promise<AlertTestResult> {
  const testedAt = new Date().toISOString();
  const payloadPreview = generateAlertTestPayloadPreview(rule);

  if (isMock) {
    return {
      success: true,
      httpStatusCode: 200,
      responseMessage: `[SIMULACIÓN DEMO] Entrega exitosa hacia ${rule.notificationChannel} (${rule.channelConfig.channelTarget || rule.channelConfig.webhookUrl || "Canal configurado"}).`,
      testedAt,
      payloadPreview,
    };
  }

  // Si es un Webhook real o Teams/Slack URL, ejecutar el dispatch HTTP
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
        testedAt,
        payloadPreview,
      };
    } catch (err: any) {
      return {
        success: false,
        httpStatusCode: 504,
        responseMessage: `Fallo de conexión al destino: ${err.message || "Timeout / Red Inalcanzable"}`,
        testedAt,
        payloadPreview,
      };
    }
  }

  // Para Email u otros canales sin URL HTTP directa
  return {
    success: true,
    httpStatusCode: 200,
    responseMessage: `Notificación de prueba generada correctamente para ${rule.notificationChannel}.`,
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

/**
 * Tipos TypeScript para el Subsistema de Alertas Self-Service en Azure FinOps
 * Incluye tipos de reglas, alcances, canales de notificación, métricas de resumen y resultados de pruebas.
 */

export type AlertRuleType =
  | "BUDGET"
  | "FIXED_THRESHOLD"
  | "ANOMALY_PERCENT"
  | "FORECAST_OVERRUN";

export type AlertScopeType =
  | "TENANT"
  | "SUBSCRIPTION"
  | "RESOURCE_GROUP"
  | "TAG";

export type NotificationChannelType =
  | "EMAIL"
  | "WEBHOOK"
  | "TEAMS"
  | "SLACK"
  | "SERVICENOW";

export interface AlertChannelConfig {
  webhookUrl?: string;
  recipients?: string[];
  serviceNowEndpoint?: string;
  channelTarget?: string;
}

export interface SelfServiceAlertRule {
  id: string;
  name: string;
  alertType: AlertRuleType;
  scopeType: AlertScopeType;
  scopeValue: string;
  thresholdValue: number;
  thresholdUnit: "PERCENT" | "USD";
  formattedThreshold: string;
  notificationChannel: NotificationChannelType;
  channelConfig: AlertChannelConfig;
  isEnabled: boolean;
  lastFiredTimestamp?: string | null;
  fireCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlertsSummaryMetrics {
  totalRulesCount: number;
  activeRulesCount: number;
  pausedRulesCount: number;
  totalFiredEventsLast30Days: number;
  uniqueChannelsCount: number;
  budgetCoveragePercentage: number;
  rules: SelfServiceAlertRule[];
}

export interface SelfServiceAlertsPayload {
  metrics: AlertsSummaryMetrics;
  source: "live" | "mock";
  lastUpdated: string;
}

export interface AlertTestResult {
  success: boolean;
  httpStatusCode?: number;
  responseMessage: string;
  testedAt: string;
  payloadPreview?: Record<string, any>;
}

export interface AlertRuleAction {
  id: string;
  ruleId: string;
  actionType: "TOGGLE_STATE" | "TEST_DELIVERY" | "UPDATE" | "DELETE";
  payload?: Partial<SelfServiceAlertRule>;
}

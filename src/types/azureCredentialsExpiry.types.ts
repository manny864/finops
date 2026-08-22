/**
 * Contratos TypeScript — Credenciales por Expirar (Entra ID).
 *
 * El estado se deriva de `daysRemaining`, no se guarda: una credencial cambia
 * de "vigente" a "por vencer" sin que nadie la toque, y persistir el estado
 * dejaría el tablero mostrando ayer.
 */

export type CredentialType = "Secret" | "Certificate";

export type CredentialStatus = "HEALTHY" | "EXPIRING_SOON" | "EXPIRED";

/** Umbral en días por debajo del cual una credencial se considera en riesgo. */
export const EXPIRING_SOON_THRESHOLD_DAYS = 30;

export const STATUS_LABELS_ES: Record<CredentialStatus, string> = {
  HEALTHY: "Vigente",
  EXPIRING_SOON: "Próximo a Vencer",
  EXPIRED: "Expirado",
};

export type NotificationChannel = "EMAIL" | "TEAMS" | "SLACK" | "WEBHOOK";

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  EMAIL: "Email",
  TEAMS: "Teams",
  SLACK: "Slack",
  WEBHOOK: "Webhook",
};

/** Vigencias ofrecidas al rotar un secreto. */
export const VALIDITY_OPTIONS = [
  { months: 6, days: 180, label: "6 meses (180 días)" },
  { months: 12, days: 365, label: "12 meses (365 días)" },
  { months: 24, days: 730, label: "24 meses (730 días)" },
];

export interface CredentialItem {
  id: string;
  keyId: string;
  applicationId: string;
  applicationDisplayName: string;
  appId: string;
  credentialType: CredentialType;
  status: CredentialStatus;
  startDateTime: string;
  endDateTime: string;
  formattedExpiryDate: string;
  daysRemaining: number;
  hint?: string;
  thumbprint?: string;
}

export interface CredentialAlertRuleItem {
  id: string;
  ruleName: string;
  warningThresholdsDays: number[];
  notificationChannels: NotificationChannel[];
  recipients: string[];
  isEnabled: boolean;
  lastTriggeredAt?: string;
}

export interface CredentialsSummaryMetrics {
  expiredCount: number;
  expiringSoonCount: number;
  healthyCount: number;
  totalTrackedCredentialsCount: number;
  totalApplicationsCount: number;
  credentials: CredentialItem[];
  alertRules: CredentialAlertRuleItem[];
}

export interface CredentialsPayload {
  summary: CredentialsSummaryMetrics;
  source: "live" | "mock";
  lastUpdated: string;
  /** Aviso no bloqueante: p. ej. Graph caído y se sirve el snapshot en MySQL. */
  warning?: string;
}

export interface RotateSecretPayload {
  applicationId: string;
  validityMonths: number;
  description?: string;
}

export interface TableColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  minWidth: number;
}

export const CREDENTIAL_COLUMNS: TableColumnConfig[] = [
  { id: "application", label: "Aplicación", visible: true, minWidth: 220 },
  { id: "type", label: "Tipo", visible: true, minWidth: 120 },
  { id: "status", label: "Estado", visible: true, minWidth: 150 },
  { id: "expiry", label: "Fecha de Vencimiento", visible: true, minWidth: 170 },
  { id: "days", label: "Días Restantes", visible: true, minWidth: 140 },
  { id: "appId", label: "App ID / Client ID", visible: true, minWidth: 250 },
  { id: "actions", label: "Acciones", visible: true, minWidth: 240 },
];

export const ALERT_RULE_COLUMNS: TableColumnConfig[] = [
  { id: "name", label: "Nombre de la Alerta", visible: true, minWidth: 200 },
  { id: "thresholds", label: "Umbrales de Disparo", visible: true, minWidth: 200 },
  { id: "channels", label: "Canales Notificados", visible: true, minWidth: 180 },
  { id: "recipients", label: "Destinatarios / Webhook", visible: true, minWidth: 220 },
  { id: "enabled", label: "Estado", visible: true, minWidth: 120 },
  { id: "actions", label: "Acciones", visible: true, minWidth: 140 },
];

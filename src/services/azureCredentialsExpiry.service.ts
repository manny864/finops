/**
 * Credenciales por Expirar (Entra ID) — capa de dominio.
 *
 * La obtención desde Microsoft Graph ya vive en `credentialExpiryService.ts`
 * (token de aplicación + paginado de `/applications`) y no se duplica. Acá se
 * traduce al contrato del módulo, se derivan los estados y se gestionan las
 * reglas de alerta en MySQL.
 *
 * Permisos Graph mínimos: `Application.Read.All` para la auditoría;
 * `Application.ReadWrite.OwnedBy` (o `Application.ReadWrite.All`) sólo para
 * rotar un secreto.
 */

import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  EXPIRING_SOON_THRESHOLD_DAYS,
  type CredentialAlertRuleItem,
  type CredentialItem,
  type CredentialStatus,
  type CredentialType,
  type CredentialsPayload,
  type CredentialsSummaryMetrics,
  type NotificationChannel,
} from "@/types/azureCredentialsExpiry.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

export function toCredentialType(raw: unknown): CredentialType {
  const s = String(raw || "").toLowerCase();
  // `credentialExpiryService` usa "password"/"certificate"; Graph los llama
  // passwordCredentials y keyCredentials.
  return s.includes("cert") || s.includes("key") ? "Certificate" : "Secret";
}

/**
 * Días completos que faltan para el vencimiento. Se usa `ceil` para que una
 * credencial que vence en dos horas cuente como 1 día y no como 0: mostrar 0
 * la haría indistinguible de una que vence hoy a la medianoche.
 */
export function calcDaysRemaining(endDateTime: unknown, now: Date = new Date()): number {
  const end = new Date(String(endDateTime || ""));
  if (Number.isNaN(end.getTime())) return 0;
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function deriveStatus(daysRemaining: number): CredentialStatus {
  if (daysRemaining < 0) return "EXPIRED";
  if (daysRemaining <= EXPIRING_SOON_THRESHOLD_DAYS) return "EXPIRING_SOON";
  return "HEALTHY";
}

/** `2026-08-22T09:00:00Z` → `22/08/2026`. */
export function formatExpiryDate(endDateTime: unknown): string {
  const d = new Date(String(endDateTime || ""));
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Fila cruda de `credentialExpiryService.CredItem`. */
export interface RawCredential {
  appId?: unknown;
  displayName?: unknown;
  credentialType?: unknown;
  credentialId?: unknown;
  expiresAt?: unknown;
  startsAt?: unknown;
  daysTillExpiry?: unknown;
  applicationObjectId?: unknown;
  hint?: unknown;
  thumbprint?: unknown;
}

export function mapCredential(row: RawCredential, now: Date = new Date()): CredentialItem {
  const endDateTime = String(row.expiresAt || "");
  // Se recalcula en vez de confiar en `daysTillExpiry` de la fila: ese valor se
  // computó cuando se generó el snapshot y puede tener horas o días de atraso.
  const daysRemaining = calcDaysRemaining(endDateTime, now);
  const keyId = String(row.credentialId || "");
  const appId = String(row.appId || "");
  return {
    id: `${appId}::${keyId}`,
    keyId,
    applicationId: String(row.applicationObjectId || appId),
    applicationDisplayName: String(row.displayName || "").trim() || appId || "Aplicación sin nombre",
    appId,
    credentialType: toCredentialType(row.credentialType),
    status: deriveStatus(daysRemaining),
    startDateTime: String(row.startsAt || ""),
    endDateTime,
    formattedExpiryDate: formatExpiryDate(endDateTime),
    daysRemaining,
    hint: row.hint ? String(row.hint) : undefined,
    thumbprint: row.thumbprint ? String(row.thumbprint) : undefined,
  };
}

export function buildCredentialsSummary(input: {
  credentials: CredentialItem[];
  alertRules: CredentialAlertRuleItem[];
}): CredentialsSummaryMetrics {
  const { credentials, alertRules } = input;
  return {
    expiredCount: credentials.filter((c) => c.status === "EXPIRED").length,
    expiringSoonCount: credentials.filter((c) => c.status === "EXPIRING_SOON").length,
    healthyCount: credentials.filter((c) => c.status === "HEALTHY").length,
    totalTrackedCredentialsCount: credentials.length,
    // Una aplicación con tres secretos es una sola identidad auditada.
    totalApplicationsCount: new Set(credentials.map((c) => c.appId)).size,
    credentials: [...credentials].sort((a, b) => a.daysRemaining - b.daysRemaining),
    alertRules,
  };
}

export function assembleLiveCredentials(input: {
  credentials: CredentialItem[];
  alertRules: CredentialAlertRuleItem[];
  warning?: string;
}): CredentialsPayload {
  try {
    return {
      summary: buildCredentialsSummary(input),
      source: "live",
      lastUpdated: new Date().toISOString(),
      warning: input.warning,
    };
  } catch (error) {
    console.error("[azureCredentialsExpiry] assembleLiveCredentials:", errorMessage(error));
    return {
      summary: buildCredentialsSummary({ credentials: [], alertRules: [] }),
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas de alerta (MySQL)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_CHANNELS: NotificationChannel[] = ["EMAIL", "TEAMS", "SLACK", "WEBHOOK"];

export function parseChannels(raw: unknown): NotificationChannel[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = raw.split(",");
    }
  }
  const out = arr
    .map((c) => String(c).trim().toUpperCase())
    .filter((c): c is NotificationChannel => VALID_CHANNELS.includes(c as NotificationChannel));
  // Sin canal válido la regla no puede notificar a nadie; se cae a EMAIL en vez
  // de guardar una alerta que parece activa y nunca avisa.
  return out.length > 0 ? Array.from(new Set(out)) : ["EMAIL"];
}

export function parseRecipients(raw: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : raw.split(",");
    } catch {
      arr = raw.split(",");
    }
  }
  return arr.map((r) => String(r).trim()).filter(Boolean);
}

/** "60,30,7" → [60, 30, 7], ordenado de mayor a menor y sin duplicados. */
export function parseThresholds(raw: unknown): number[] {
  const parts = String(raw ?? "")
    .split(",")
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 3650);
  const unique = Array.from(new Set(parts)).sort((a, b) => b - a);
  return unique.length > 0 ? unique : [EXPIRING_SOON_THRESHOLD_DAYS];
}

export function serializeThresholds(days: number[]): string {
  return parseThresholds(days.join(",")).join(",");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapAlertRule(row: any): CredentialAlertRuleItem {
  return {
    id: String(row.id),
    ruleName: String(row.rule_name || "Alerta sin nombre"),
    warningThresholdsDays: parseThresholds(row.warning_thresholds_days),
    notificationChannels: parseChannels(row.notification_channels),
    recipients: parseRecipients(row.recipients),
    isEnabled: Boolean(row.is_enabled),
    lastTriggeredAt: row.last_triggered_at ? new Date(row.last_triggered_at).toISOString() : undefined,
  };
}

export async function listAlertRules(tenantId: string): Promise<CredentialAlertRuleItem[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows]: any = await pool.query(
      `SELECT * FROM CredentialAlertRules WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((rows as any[]) || []).map(mapAlertRule);
  } catch (e) {
    console.warn("[azureCredentialsExpiry] lectura de CredentialAlertRules falló:", errorMessage(e));
    return [];
  }
}

export async function upsertAlertRule(
  tenantId: string,
  payload: {
    id?: string;
    ruleName: string;
    warningThresholdsDays: number[];
    notificationChannels: NotificationChannel[];
    recipients: string[];
    isEnabled: boolean;
  },
  user: string
): Promise<void> {
  const id = payload.id || crypto.randomUUID();
  await pool.query(
    `INSERT INTO CredentialAlertRules
      (id, tenant_id, rule_name, warning_thresholds_days, notification_channels, recipients, is_enabled, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      rule_name = VALUES(rule_name),
      warning_thresholds_days = VALUES(warning_thresholds_days),
      notification_channels = VALUES(notification_channels),
      recipients = VALUES(recipients),
      is_enabled = VALUES(is_enabled)`,
    [
      id,
      tenantId,
      payload.ruleName.slice(0, 255),
      serializeThresholds(payload.warningThresholdsDays),
      JSON.stringify(parseChannels(payload.notificationChannels)),
      JSON.stringify(parseRecipients(payload.recipients)),
      payload.isEnabled ? 1 : 0,
      user || "admin",
    ]
  );
}

export async function deleteAlertRule(tenantId: string, id: string): Promise<void> {
  await pool.query(`DELETE FROM CredentialAlertRules WHERE tenant_id = ? AND id = ?`, [tenantId, id]);
}

export async function toggleAlertRule(tenantId: string, id: string, enabled: boolean): Promise<void> {
  await pool.query(`UPDATE CredentialAlertRules SET is_enabled = ? WHERE tenant_id = ? AND id = ?`, [
    enabled ? 1 : 0,
    tenantId,
    id,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotación de secretos (Microsoft Graph)
// ─────────────────────────────────────────────────────────────────────────────

export interface RotateSecretResult {
  secretText: string;
  keyId: string;
  endDateTime: string;
  displayName: string;
}

/**
 * Crea un secreto nuevo vía `POST /applications/{id}/addPassword`.
 *
 * Deliberadamente NO borra el anterior: rotar es agregar y después migrar los
 * consumidores. Revocar en el mismo paso dejaría fuera de servicio a todo lo
 * que todavía usa el secreto viejo, que es justo el incidente que este módulo
 * intenta prevenir.
 */
export async function rotateApplicationSecret(
  graphToken: string,
  applicationObjectId: string,
  validityMonths: number,
  description?: string
): Promise<RotateSecretResult> {
  const months = [6, 12, 24].includes(validityMonths) ? validityMonths : 12;
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + months);

  const res = await fetch(`https://graph.microsoft.com/v1.0/applications/${encodeURIComponent(applicationObjectId)}/addPassword`, {
    method: "POST",
    headers: { Authorization: `Bearer ${graphToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      passwordCredential: {
        displayName: (description || `Rotado desde CSCloudSolutions ${new Date().toISOString().slice(0, 10)}`).slice(0, 100),
        endDateTime: endDate.toISOString(),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      res.status === 403
        ? "El Service Principal no tiene el permiso Application.ReadWrite.OwnedBy sobre esta aplicación."
        : `Microsoft Graph rechazó la rotación (${res.status}): ${text.slice(0, 300)}`
    );
  }

  const data = await res.json();
  return {
    secretText: String(data.secretText || ""),
    keyId: String(data.keyId || ""),
    endDateTime: String(data.endDateTime || endDate.toISOString()),
    displayName: String(data.displayName || ""),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset demo
// ─────────────────────────────────────────────────────────────────────────────

function tierOf(tenantId: string): "Professional" | "Business" | "Enterprise" {
  if (tenantId.includes("4444") || tenantId.includes("enterprise")) return "Enterprise";
  if (tenantId.includes("2222") || tenantId.includes("business")) return "Business";
  return "Professional";
}

interface DemoCredSeed {
  app: string;
  days: number;
  type: CredentialType;
  hint?: string;
}

const DEMO_CREDS: DemoCredSeed[] = [
  { app: "legacy-etl-sp", days: -14, type: "Secret", hint: "8Qn" },
  { app: "finops-onboarding-sp", days: 2, type: "Secret", hint: "kR4" },
  { app: "github-actions-cicd", days: 12, type: "Certificate" },
  { app: "data-ingest-job", days: 28, type: "Secret", hint: "pW9" },
  { app: "monitoring-sp", days: 65, type: "Certificate" },
  { app: "powerbi-gateway-sp", days: 155, type: "Secret", hint: "mZ2" },
  { app: "backup-orchestrator", days: 355, type: "Secret", hint: "vT7" },
  { app: "sentinel-connector", days: 721, type: "Certificate" },
  { app: "cost-exporter-sp", days: 480, type: "Secret", hint: "aB3" },
];

const TIER_CRED_COUNT: Record<string, number> = { Professional: 4, Business: 7, Enterprise: 9 };

const DEMO_RULES: CredentialAlertRuleItem[] = [
  {
    id: "rule-produccion",
    ruleName: "Identidades de producción",
    warningThresholdsDays: [60, 30, 7],
    notificationChannels: ["EMAIL", "TEAMS"],
    recipients: ["cloudops@cscloudsolutions.com.ar", "seguridad@cscloudsolutions.com.ar"],
    isEnabled: true,
    lastTriggeredAt: "2026-08-20T07:00:00.000Z",
  },
  {
    id: "rule-cicd",
    ruleName: "Pipelines de CI/CD",
    warningThresholdsDays: [30, 7],
    notificationChannels: ["SLACK", "WEBHOOK"],
    recipients: ["#devops-alerts", "https://hooks.slack.com/services/T000/B000/XXXX"],
    isEnabled: true,
    lastTriggeredAt: "2026-08-10T07:00:00.000Z",
  },
  {
    id: "rule-legacy",
    ruleName: "Service Principals heredados",
    warningThresholdsDays: [14],
    notificationChannels: ["EMAIL"],
    recipients: ["legacy-owners@cscloudsolutions.com.ar"],
    isEnabled: false,
  },
];

export function getMockCredentialsPayload(tenantId: string, now: Date = new Date()): CredentialsPayload {
  const tier = tierOf(tenantId);
  const seeds = DEMO_CREDS.slice(0, TIER_CRED_COUNT[tier]);
  const day = 24 * 60 * 60 * 1000;

  const credentials = seeds.map((s, i) => {
    const appId = `a1b2c3d4-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    // Las fechas son relativas a "ahora" para que la demo nunca se vea vencida
    // en bloque: un dataset con fechas fijas envejece y a los meses muestra
    // todo expirado.
    const end = new Date(now.getTime() + s.days * day);
    const start = new Date(end.getTime() - 365 * day);
    return mapCredential(
      {
        appId,
        applicationObjectId: `obj-${appId}`,
        displayName: s.app,
        credentialType: s.type === "Certificate" ? "certificate" : "password",
        credentialId: `kid-${String(i + 1).padStart(3, "0")}`,
        expiresAt: end.toISOString(),
        startsAt: start.toISOString(),
        hint: s.hint,
        thumbprint: s.type === "Certificate" ? `A1B2C3${String(i).padStart(2, "0")}D4E5F6` : undefined,
      },
      now
    );
  });

  const rules = tier === "Professional" ? DEMO_RULES.slice(0, 1) : tier === "Business" ? DEMO_RULES.slice(0, 2) : DEMO_RULES;

  return {
    summary: buildCredentialsSummary({ credentials, alertRules: rules }),
    source: "mock",
    lastUpdated: now.toISOString(),
  };
}

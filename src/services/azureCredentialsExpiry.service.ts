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

/**
 * Las reglas viven en `AlertRules` con `rule_type='credential_expiry'`, que es
 * la tabla que lee el cron `/api/cron/credential-expiry-alerts`. Antes se
 * guardaban en `CredentialAlertRules`, que no tiene ningun lector: las alertas
 * creadas desde el panel no se disparaban nunca.
 *
 * `AlertRules` guarda UN umbral y UN destino por fila, y el panel ofrece varios
 * de cada uno por regla, asi que una regla de la UI se expande a N filas y se
 * reagrupa por `rule_name` al leer. El nombre alcanza como identidad porque el
 * formulario ya lo trataba como unico por tenant.
 */

const CHANNEL_TO_DB: Record<NotificationChannel, string> = {
  EMAIL: "email",
  TEAMS: "teams",
  SLACK: "slack",
  WEBHOOK: "webhook",
};

const CHANNEL_FROM_DB: Record<string, NotificationChannel> = {
  email: "EMAIL",
  teams: "TEAMS",
  slack: "SLACK",
  webhook: "WEBHOOK",
  servicenow: "WEBHOOK",
};

/**
 * Tope de filas por regla. Sin el, tres umbrales por cuatro canales por veinte
 * destinatarios generan 240 filas que el cron evalua una por una.
 */
export const MAX_ALERT_ROWS = 40;

/**
 * Un destinatario sirve para email si es una direccion y para los demas canales
 * si es una URL. El formulario ofrece una sola lista para todos los canales, y
 * sin este filtro una regla con email + webhook terminaba mandando el correo a
 * `https://hooks.slack.com/...`.
 */
export function targetsFor(channel: NotificationChannel, recipients: string[]): string[] {
  return channel === "EMAIL"
    ? recipients.filter((r) => r.includes("@"))
    : recipients.filter((r) => /^https?:\/\//i.test(r));
}

export interface ExpandedAlertRow {
  thresholdDays: number;
  channel: string;
  target: string;
}

/** Producto umbral x canal x destinatario valido, acotado a MAX_ALERT_ROWS. */
export function expandAlertRule(rule: {
  warningThresholdsDays: number[];
  notificationChannels: NotificationChannel[];
  recipients: string[];
}): ExpandedAlertRow[] {
  const out: ExpandedAlertRow[] = [];
  for (const thresholdDays of parseThresholds(rule.warningThresholdsDays.join(","))) {
    for (const channel of parseChannels(rule.notificationChannels)) {
      for (const target of targetsFor(channel, parseRecipients(rule.recipients))) {
        if (out.length >= MAX_ALERT_ROWS) return out;
        out.push({ thresholdDays, channel: CHANNEL_TO_DB[channel], target });
      }
    }
  }
  return out;
}

/** Reagrupa las filas de AlertRules en las reglas que muestra el panel. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function groupAlertRules(rows: any[]): CredentialAlertRuleItem[] {
  const porNombre = new Map<string, CredentialAlertRuleItem>();
  for (const row of rows || []) {
    const ruleName = String(row.rule_name || "Alerta sin nombre");
    const actual: CredentialAlertRuleItem = porNombre.get(ruleName) ?? {
      id: ruleName,
      ruleName,
      warningThresholdsDays: [],
      notificationChannels: [],
      recipients: [],
      // Basta con que una fila del grupo este activa para que la regla avise.
      isEnabled: false,
      reminderFrequencyHours: row.reminder_frequency_hours ?? null,
      firstRowId: String(row.id),
    };
    const dias = Number(row.threshold_value);
    if (Number.isFinite(dias) && !actual.warningThresholdsDays.includes(dias)) {
      actual.warningThresholdsDays.push(dias);
    }
    const canal = CHANNEL_FROM_DB[String(row.channel || "").toLowerCase()];
    if (canal && !actual.notificationChannels.includes(canal)) actual.notificationChannels.push(canal);
    const destino = String(row.channel_target || "").trim();
    if (destino && !actual.recipients.includes(destino)) actual.recipients.push(destino);
    if (row.enabled) actual.isEnabled = true;
    // La ultima vez que aviso la regla es la mas reciente de sus filas.
    if (row.last_triggered_at) {
      const iso = new Date(row.last_triggered_at).toISOString();
      if (!actual.lastTriggeredAt || iso > actual.lastTriggeredAt) actual.lastTriggeredAt = iso;
    }
    porNombre.set(ruleName, actual);
  }
  for (const regla of porNombre.values()) {
    regla.warningThresholdsDays.sort((a, b) => b - a);
  }
  return Array.from(porNombre.values());
}

export async function listAlertRules(tenantId: string): Promise<CredentialAlertRuleItem[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows]: any = await pool.query(
      `SELECT id, rule_name, threshold_value, channel, channel_target,
              reminder_frequency_hours, enabled, last_triggered_at
         FROM AlertRules
        WHERE tenant_id = ? AND rule_type = 'credential_expiry'
        ORDER BY rule_name, id`,
      [tenantId]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return groupAlertRules((rows as any[]) || []);
  } catch (e) {
    console.warn("[azureCredentialsExpiry] lectura de AlertRules falló:", errorMessage(e));
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
    reminderFrequencyHours?: number | null;
  },
  user: string
): Promise<void> {
  const ruleName = payload.ruleName.trim().slice(0, 255);
  const filas = expandAlertRule(payload);
  if (filas.length === 0) {
    // Guardar cero filas dejaria la regla invisible y el usuario creeria que
    // quedo activa: se corta acá con un mensaje que dice qué falta.
    throw new Error(
      "Ningún destinatario sirve para los canales elegidos: email necesita una dirección y los webhooks una URL."
    );
  }

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    // Reemplazo completo: el formulario edita la regla entera, no fila por fila.
    // `id` trae el nombre anterior cuando se está renombrando.
    const anterior = payload.id ? String(payload.id) : ruleName;
    await conexion.query(
      `DELETE FROM AlertRules WHERE tenant_id = ? AND rule_type = 'credential_expiry' AND rule_name IN (?, ?)`,
      [tenantId, anterior, ruleName]
    );
    const enabled = payload.isEnabled ? 1 : 0;
    const recurrencia = payload.reminderFrequencyHours ?? null;
    for (const fila of filas) {
      await conexion.query(
        `INSERT INTO AlertRules
           (tenant_id, rule_name, rule_type, threshold_value, threshold_unit,
            channel, channel_target, reminder_frequency_hours, enabled, trigger_count, created_by)
         VALUES (?, ?, 'credential_expiry', ?, 'days', ?, ?, ?, ?, 0, ?)`,
        [tenantId, ruleName, fila.thresholdDays, fila.channel, fila.target, recurrencia, enabled, user || "admin"]
      );
    }
    await conexion.commit();
  } catch (e) {
    await conexion.rollback();
    throw e;
  } finally {
    conexion.release();
  }
}

export async function deleteAlertRule(tenantId: string, ruleName: string): Promise<void> {
  await pool.query(
    `DELETE FROM AlertRules WHERE tenant_id = ? AND rule_type = 'credential_expiry' AND rule_name = ?`,
    [tenantId, ruleName]
  );
}

export async function toggleAlertRule(tenantId: string, ruleName: string, enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE AlertRules SET enabled = ? WHERE tenant_id = ? AND rule_type = 'credential_expiry' AND rule_name = ?`,
    [enabled ? 1 : 0, tenantId, ruleName]
  );
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
 * Traduce un App ID (client ID) al object ID de la App Registration usando la
 * clave alterna de Graph. Ambos son GUID y no se distinguen por su forma, así
 * que sólo se llama cuando `/applications/{id}` ya devolvió 404.
 *
 * Hace falta porque el listado del módulo se arma desde `appId`: el fetch de
 * Graph no pide `id`, y el snapshot en MySQL (`ExpiringCredentials`) tampoco lo
 * guarda. Resolverlo acá arregla la rotación para las dos procedencias sin
 * migrar la tabla.
 */
async function resolveApplicationObjectId(graphToken: string, appId: string): Promise<string | null> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/applications(appId='${encodeURIComponent(appId)}')?$select=id`,
    { headers: { Authorization: `Bearer ${graphToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const id = data && typeof data.id === "string" ? data.id : "";
  return id && id !== appId ? id : null;
}

/**
 * Crea un secreto nuevo vía `POST /applications/{id}/addPassword`.
 *
 * Deliberadamente NO borra el anterior: rotar es agregar y después migrar los
 * consumidores. Revocar en el mismo paso dejaría fuera de servicio a todo lo
 * que todavía usa el secreto viejo, que es justo el incidente que este módulo
 * intenta prevenir.
 *
 * Acepta el object ID o el App ID: si Graph responde 404 se resuelve el object
 * ID por clave alterna y se reintenta una vez.
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

  const payload = JSON.stringify({
    passwordCredential: {
      displayName: (description || `Rotado desde CSCloudSolutions ${new Date().toISOString().slice(0, 10)}`).slice(0, 100),
      endDateTime: endDate.toISOString(),
    },
  });
  const addPassword = (id: string) =>
    fetch(`https://graph.microsoft.com/v1.0/applications/${encodeURIComponent(id)}/addPassword`, {
      method: "POST",
      headers: { Authorization: `Bearer ${graphToken}`, "Content-Type": "application/json" },
      body: payload,
    });

  let res = await addPassword(applicationObjectId);

  if (res.status === 404) {
    const objectId = await resolveApplicationObjectId(graphToken, applicationObjectId);
    if (objectId) res = await addPassword(objectId);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // El status viaja con el error para que la ruta no devuelva 502 en un
    // problema de permisos: un 403 de Graph es un 403, no un bad gateway.
    throw Object.assign(
      new Error(
        res.status === 403
          ? "El Service Principal no tiene consentido `Application.ReadWrite.OwnedBy` en Entra ID, o no figura como owner de esta App Registration. Es un permiso que hay que otorgar en el portal: sin él la rotación no puede crear el secreto."
          : res.status === 404
            ? "Entra ID no encuentra esta App Registration, o el Service Principal no la tiene entre las aplicaciones que puede administrar (`Application.ReadWrite.OwnedBy` sólo alcanza a las propias)."
            : `Microsoft Graph rechazó la rotación (${res.status}): ${text.slice(0, 300)}`
      ),
      { status: res.status }
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

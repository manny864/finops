/**
 * Soporte (mesa de ayuda multi-tenant) — capa de dominio.
 *
 * Traduce las filas de `SupportTickets` / `SupportTicketMessages` /
 * `SupportTicketAttachments` al contrato de `types/supportTickets.types.ts`,
 * calcula el SLA de primera respuesta y arma los resúmenes de las dos vistas
 * (usuario y cola global de superadmin).
 *
 * Todo acá es función pura sobre filas ya leídas: el SQL vive en las rutas, que
 * son el límite de seguridad por tenant. Así el cálculo de SLA y el mapeo de
 * enums se testean sin base de datos.
 *
 * RBAC: no consulta nada. Las notas internas se filtran con
 * `stripInternalNotes` antes de responder a un usuario de tenant.
 */

import {
    SLA_BREACH_RISK_MINUTES,
    type GlobalSupportSummaryMetrics,
    type SupportTicketItem,
    type TicketAttachmentItem,
    type TicketCategory,
    type TicketMessageItem,
    type TicketPriority,
    type TicketSenderRole,
    type TicketStatus,
    type UserSupportSummaryMetrics,
} from "@/types/supportTickets.types";

// ─────────────────────────────────────────────────────────────────────────────
// Traducción de enums: MySQL (minúsculas, nombres heredados) ↔ dominio
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_FROM_DB: Record<string, TicketCategory> = {
    question: "CONSULTA",
    billing: "FACTURACION_AZURE",
    technical: "INCIDENCIA_TECNICA",
    feature_request: "SOLICITUD_FEATURE",
};

const CATEGORY_TO_DB: Record<TicketCategory, string> = {
    CONSULTA: "question",
    FACTURACION_AZURE: "billing",
    // `CONEXION_TENANT` no tiene valor propio en el ENUM de MySQL: es una
    // incidencia técnica de onboarding. Se distingue en la UI por
    // `relatedModule`, no por un ALTER del ENUM sobre datos vivos.
    CONEXION_TENANT: "technical",
    INCIDENCIA_TECNICA: "technical",
    SOLICITUD_FEATURE: "feature_request",
};

const PRIORITY_FROM_DB: Record<string, TicketPriority> = {
    urgent: "CRITICAL",
    high: "HIGH",
    medium: "MEDIUM",
    low: "LOW",
};

const PRIORITY_TO_DB: Record<TicketPriority, string> = {
    CRITICAL: "urgent",
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
};

const STATUS_FROM_DB: Record<string, TicketStatus> = {
    open: "OPEN",
    in_progress: "IN_PROGRESS",
    waiting_customer: "WAITING_USER",
    resolved: "RESOLVED",
    closed: "CLOSED",
};

const STATUS_TO_DB: Record<TicketStatus, string> = {
    OPEN: "open",
    IN_PROGRESS: "in_progress",
    WAITING_USER: "waiting_customer",
    RESOLVED: "resolved",
    CLOSED: "closed",
};

const ROLE_FROM_DB: Record<string, TicketSenderRole> = {
    user: "USER",
    support: "SUPPORT_AGENT",
    system: "SYSTEM",
};

/** Fail-closed: una categoría desconocida cae en consulta general, no rompe la vista. */
export function toCategory(raw: unknown): TicketCategory {
    return CATEGORY_FROM_DB[String(raw || "").toLowerCase()] || "CONSULTA";
}

/** Fail-closed hacia la prioridad más baja: nunca inventa urgencia. */
export function toPriority(raw: unknown): TicketPriority {
    return PRIORITY_FROM_DB[String(raw || "").toLowerCase()] || "LOW";
}

/** Fail-closed a OPEN: un estado ilegible deja el ticket visible en la cola. */
export function toStatus(raw: unknown): TicketStatus {
    return STATUS_FROM_DB[String(raw || "").toLowerCase()] || "OPEN";
}

export function toSenderRole(raw: unknown): TicketSenderRole {
    return ROLE_FROM_DB[String(raw || "").toLowerCase()] || "USER";
}

export function categoryToDb(category: TicketCategory): string {
    return CATEGORY_TO_DB[category] || "question";
}

export function priorityToDb(priority: TicketPriority): string {
    return PRIORITY_TO_DB[priority] || "medium";
}

export function statusToDb(status: TicketStatus): string {
    return STATUS_TO_DB[status] || "open";
}

// ─────────────────────────────────────────────────────────────────────────────
// SLA de primera respuesta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vencimiento del SLA = creación + horas del plan. Se calcula desde
 * `created_at` en vez de guardarlo al insertar para que un ticket creado antes
 * de que existiera la columna también tenga deadline, y para que un cambio de
 * tier se refleje sin reescribir filas.
 */
export function computeSlaDeadline(createdAt: unknown, slaHours: number): string {
    const created = new Date(String(createdAt || ""));
    if (Number.isNaN(created.getTime())) return new Date().toISOString();
    const hours = Number.isFinite(slaHours) && slaHours > 0 ? slaHours : 4;
    return new Date(created.getTime() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Minutos que faltan para vencer el SLA, con piso en 0: un SLA vencido no
 * devuelve negativos porque la UI muestra "Vencido", no "-320 min".
 */
export function calcSlaRemainingMinutes(slaDeadlineIso: unknown, now: Date = new Date()): number {
    const end = new Date(String(slaDeadlineIso || ""));
    if (Number.isNaN(end.getTime())) return 0;
    return Math.max(0, Math.floor((end.getTime() - now.getTime()) / (1000 * 60)));
}

/**
 * Riesgo de incumplimiento: sólo aplica a tickets que todavía esperan primera
 * respuesta del equipo. Un ticket resuelto o esperando al cliente no está en
 * riesgo aunque el reloj siga corriendo.
 */
export function isSlaBreachRisk(status: TicketStatus, slaRemainingMinutes: number, firstRespondedAt?: unknown): boolean {
    if (firstRespondedAt) return false;
    if (status !== "OPEN" && status !== "IN_PROGRESS") return false;
    return slaRemainingMinutes < SLA_BREACH_RISK_MINUTES;
}

/** `135` → `2h 15m`; `0` → `Vencido`. Formato del badge de cuenta regresiva. */
export function formatSlaRemaining(minutes: number): string {
    if (minutes <= 0) return "Vencido";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de filas
// ─────────────────────────────────────────────────────────────────────────────

export interface RawTicketRow {
    id?: unknown;
    tenant_id?: unknown;
    tenant_name?: unknown;
    subject?: unknown;
    category?: unknown;
    status?: unknown;
    priority?: unknown;
    created_by_email?: unknown;
    created_by_name?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    last_message_at?: unknown;
    message_count?: unknown;
    sla_deadline?: unknown;
    first_responded_at?: unknown;
    resolved_at?: unknown;
    assigned_admin_email?: unknown;
    related_module?: unknown;
    last_message_snippet?: unknown;
}

export interface RawMessageRow {
    id?: unknown;
    ticket_id?: unknown;
    author_email?: unknown;
    author_name?: unknown;
    author_role?: unknown;
    body?: unknown;
    is_internal_note?: unknown;
    created_at?: unknown;
}

export interface RawAttachmentRow {
    id?: unknown;
    message_id?: unknown;
    original_name?: unknown;
    mime_type?: unknown;
    size_bytes?: unknown;
    created_at?: unknown;
}

function iso(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    const s = String(value || "");
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function mapAttachment(row: RawAttachmentRow): TicketAttachmentItem {
    const id = String(row.id ?? "");
    return {
        id,
        fileName: String(row.original_name || "adjunto"),
        fileSizeBytes: Number(row.size_bytes || 0),
        contentType: String(row.mime_type || "application/octet-stream"),
        // El blob nunca se expone directo: se sirve por la ruta autenticada, que
        // revalida el tenant antes de devolver bytes.
        storageBlobUrl: `/api/support/attachments/${id}`,
        createdAt: iso(row.created_at),
    };
}

export function mapMessage(row: RawMessageRow, attachments: TicketAttachmentItem[] = []): TicketMessageItem {
    const email = String(row.author_email || "");
    return {
        id: String(row.id ?? ""),
        ticketId: String(row.ticket_id ?? ""),
        // El esquema guarda el email como identidad del autor; no hay columna de
        // OID. Se expone el email también como id para no inventar un GUID.
        senderUserId: email,
        senderEmail: email,
        senderName: String(row.author_name || "").trim() || email,
        senderRole: toSenderRole(row.author_role),
        messageText: String(row.body || ""),
        isInternalNote: Boolean(Number(row.is_internal_note || 0)),
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: iso(row.created_at),
    };
}

export function mapTicket(
    row: RawTicketRow,
    opts: { slaHours: number; now?: Date; tenantDisplayName?: string; messages?: TicketMessageItem[] }
): SupportTicketItem {
    const now = opts.now || new Date();
    const id = String(row.id ?? "");
    const status = toStatus(row.status);
    // Si la columna tiene deadline explícito se respeta; si no, se deriva del
    // plan. Así los tickets previos a la migración también cuentan SLA.
    const slaDeadlineIso = row.sla_deadline ? iso(row.sla_deadline) : computeSlaDeadline(row.created_at, opts.slaHours);
    const slaRemainingMinutes = calcSlaRemainingMinutes(slaDeadlineIso, now);
    const assignedAdminEmail = row.assigned_admin_email ? String(row.assigned_admin_email) : undefined;

    return {
        id,
        ticketNumber: `TICK-${id}`,
        tenantId: String(row.tenant_id || ""),
        tenantDisplayName: String(opts.tenantDisplayName || row.tenant_name || row.tenant_id || ""),
        creatorUserId: String(row.created_by_email || ""),
        creatorEmail: String(row.created_by_email || ""),
        creatorName: String(row.created_by_name || "").trim() || String(row.created_by_email || ""),
        subject: String(row.subject || ""),
        category: toCategory(row.category),
        priority: toPriority(row.priority),
        status,
        relatedModule: row.related_module ? String(row.related_module) : undefined,
        slaDeadlineIso,
        slaRemainingMinutes,
        isSlaBreachRisk: isSlaBreachRisk(status, slaRemainingMinutes, row.first_responded_at),
        assignedAdminEmail,
        assignedAdminName: assignedAdminEmail ? assignedAdminEmail.split("@")[0] : undefined,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.last_message_at || row.updated_at),
        lastMessageSnippet: row.last_message_snippet ? String(row.last_message_snippet).slice(0, 160) : undefined,
        messagesCount: Number(row.message_count || 0),
        messages: opts.messages,
    };
}

/**
 * Quita las notas internas antes de responder a un usuario de tenant.
 *
 * Se aplica en la ruta, no en la UI: una nota interna que llega al navegador ya
 * está filtrada, aunque el componente decida no renderizarla.
 */
export function stripInternalNotes(messages: TicketMessageItem[]): TicketMessageItem[] {
    return messages.filter((m) => !m.isInternalNote);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resúmenes
// ─────────────────────────────────────────────────────────────────────────────

export function buildUserSupportSummary(tickets: SupportTicketItem[], planSlaHours: number): UserSupportSummaryMetrics {
    return {
        openTicketsCount: tickets.filter((t) => t.status === "OPEN" || t.status === "WAITING_USER").length,
        inProgressCount: tickets.filter((t) => t.status === "IN_PROGRESS").length,
        resolvedCount: tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length,
        planSlaHours,
        tickets,
    };
}

/**
 * `avgResolutionTimeHours` se calcula sólo sobre los tickets que efectivamente
 * se resolvieron. Incluir los abiertos daría un promedio que baja cuando entra
 * trabajo nuevo, que es lo contrario de lo que mide.
 */
export function buildGlobalSupportSummary(tickets: SupportTicketItem[], resolvedDurationsHours: number[]): GlobalSupportSummaryMetrics {
    const durations = resolvedDurationsHours.filter((h) => Number.isFinite(h) && h >= 0);
    return {
        totalTicketsCount: tickets.length,
        unassignedCount: tickets.filter((t) => !t.assignedAdminEmail).length,
        slaBreachRiskCount: tickets.filter((t) => t.isSlaBreachRisk).length,
        avgResolutionTimeHours:
            durations.length === 0 ? 0 : Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10,
        tickets,
    };
}

export function buildStatusCounts(tickets: SupportTicketItem[]): Record<TicketStatus, number> {
    const counts: Record<TicketStatus, number> = {
        OPEN: 0,
        IN_PROGRESS: 0,
        WAITING_USER: 0,
        RESOLVED: 0,
        CLOSED: 0,
    };
    for (const t of tickets) counts[t.status] += 1;
    return counts;
}

/** Horas entre creación y resolución de una fila ya leída. `null` si no aplica. */
export function resolutionHours(row: RawTicketRow): number | null {
    if (!row.resolved_at) return null;
    const start = new Date(iso(row.created_at)).getTime();
    const end = new Date(iso(row.resolved_at)).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.round(((end - start) / (1000 * 60 * 60)) * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjuntos
// ─────────────────────────────────────────────────────────────────────────────

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MIME_ALLOWLIST = ["image/jpeg", "image/png", "text/plain", "application/json"] as const;
export const ATTACHMENT_EXTENSIONS = ".jpg,.jpeg,.png,.txt,.json";

/**
 * Valida por extensión Y por tamaño. El `contentType` que manda el navegador no
 * es de fiar (se puede falsear), así que la allowlist de MIME se revalida en el
 * servidor contra la extensión real del nombre.
 */
export function isValidAttachment(file: { name: string; size: number }): boolean {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    return ["jpg", "jpeg", "png", "txt", "json"].includes(ext) && file.size > 0 && file.size <= ATTACHMENT_MAX_BYTES;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Un adjunto de imagen se previsualiza; un log se descarga. */
export function isPreviewableImage(contentType: string): boolean {
    return contentType === "image/jpeg" || contentType === "image/png";
}

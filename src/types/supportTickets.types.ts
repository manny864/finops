/**
 * Contrato del módulo de Soporte (mesa de ayuda multi-tenant).
 *
 * Los enums acá son en MAYÚSCULAS y en el dominio del negocio; la base de datos
 * los guarda en minúsculas y con otros nombres desde la migración
 * `20260706-001-create-support-tickets.sql` (`question`/`urgent`/
 * `waiting_customer`). La traducción vive en `src/services/supportTickets.service.ts`
 * y es deliberada: renombrar los ENUM de MySQL implicaría reescribir datos de
 * producción y romper el cron de notificaciones y las rutas existentes, sin
 * ganar nada funcional.
 */

export type TicketCategory =
    | "CONSULTA"
    | "FACTURACION_AZURE"
    | "CONEXION_TENANT"
    | "INCIDENCIA_TECNICA"
    | "SOLICITUD_FEATURE";

export type TicketPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_USER" | "RESOLVED" | "CLOSED";

export type TicketSenderRole = "USER" | "SUPPORT_AGENT" | "SYSTEM";

export interface TicketAttachmentItem {
    id: string;
    fileName: string;
    fileSizeBytes: number;
    contentType: string;
    storageBlobUrl: string;
    createdAt: string;
}

export interface TicketMessageItem {
    id: string;
    ticketId: string;
    senderUserId: string;
    senderEmail: string;
    senderName: string;
    senderRole: TicketSenderRole;
    messageText: string;
    /** Sólo visible para superadmins. El backend nunca la envía a un usuario de tenant. */
    isInternalNote: boolean;
    attachments?: TicketAttachmentItem[];
    createdAt: string;
}

export interface SupportTicketItem {
    id: string;
    ticketNumber: string;
    tenantId: string;
    tenantDisplayName: string;
    creatorUserId: string;
    creatorEmail: string;
    creatorName: string;
    subject: string;
    category: TicketCategory;
    priority: TicketPriority;
    status: TicketStatus;
    relatedModule?: string;
    slaDeadlineIso: string;
    slaRemainingMinutes: number;
    isSlaBreachRisk: boolean;
    assignedAdminEmail?: string;
    assignedAdminName?: string;
    createdAt: string;
    updatedAt: string;
    lastMessageSnippet?: string;
    messagesCount: number;
    messages?: TicketMessageItem[];
}

export interface UserSupportSummaryMetrics {
    openTicketsCount: number;
    inProgressCount: number;
    resolvedCount: number;
    planSlaHours: number;
    tickets: SupportTicketItem[];
}

export interface GlobalSupportSummaryMetrics {
    totalTicketsCount: number;
    unassignedCount: number;
    slaBreachRiskCount: number;
    avgResolutionTimeHours: number;
    tickets: SupportTicketItem[];
}

export interface CreateTicketPayload {
    subject: string;
    category: TicketCategory;
    priority: TicketPriority;
    messageText: string;
    relatedModule?: string;
    attachments?: File[];
}

export interface SendTicketMessagePayload {
    ticketId: string;
    messageText: string;
    isInternalNote?: boolean;
    attachments?: File[];
}

/** Payload de las rutas de listado, con la fuente del dato para el banner de demo. */
export interface UserSupportPayload {
    summary: UserSupportSummaryMetrics;
    source: "live" | "mock";
    mock?: boolean;
    quota: { monthlyLimit: number | null; usedThisMonth: number; firstResponseSlaHours: number };
    lastUpdated: string;
}

export interface GlobalSupportPayload {
    summary: GlobalSupportSummaryMetrics;
    statusCounts: Record<TicketStatus, number>;
    source: "live" | "mock";
    lastUpdated: string;
}

/** Umbral de riesgo de incumplimiento del SLA de primera respuesta, en minutos. */
export const SLA_BREACH_RISK_MINUTES = 60;

/** Módulos que un ticket puede referenciar (dropdown "Módulo afectado"). */
export const TICKET_RELATED_MODULES = [
    "Defender",
    "Zombies",
    "Allocation",
    "Alerts",
    "PowerSchedules",
    "TagGovernance",
] as const;
export type TicketRelatedModule = (typeof TICKET_RELATED_MODULES)[number];

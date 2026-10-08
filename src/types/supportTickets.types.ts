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

export const TICKET_CATEGORIES = [
    "CONSULTA",
    "FACTURACION_AZURE",
    "CONEXION_TENANT",
    "INCIDENCIA_TECNICA",
    "SOLICITUD_FEATURE",
] as const satisfies readonly TicketCategory[];
export const TICKET_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const satisfies readonly TicketPriority[];

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
    /** Nota interna generada por "Sugerir respuesta" (Fase 3b): id del borrador de IA. */
    aiDraftId?: string;
    attachments?: TicketAttachmentItem[];
    createdAt: string;
}

/**
 * Sugerencia de triaje con IA (Fase 3a). Sólo la ve el equipo de soporte y
 * nunca cambia el ticket sola: aceptarla pasa por el PATCH del ticket.
 */
export interface SupportTicketAiTriage {
    suggestedPriority: TicketPriority;
    suggestedCategory: TicketCategory;
    suggestedModule: TicketRelatedModule | null;
    productionImpact: boolean;
    rationale: string;
    /** 0 a 1. */
    confidence: number;
    status: "pending" | "accepted" | "dismissed";
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
    /** Sólo en la cola de superadmin. */
    aiTriage?: SupportTicketAiTriage;
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
    /** Ausente si no se pudieron calcular: no frenan la cola. */
    kpis?: SupportWindowKpis;
}

/**
 * KPIs de la IA de soporte (Fase 3), sobre los tickets y borradores creados en
 * los últimos `windowDays` días. Un borrador "usado" es el que el operador pasó
 * al compositor con "Usar como respuesta" y envió como respuesta pública, con o
 * sin cambios.
 */
export interface SupportWindowKpis {
    windowDays: number;
    ticketsCreated: number;
    /** null si ningún ticket de la ventana tuvo primera respuesta. */
    avgFirstResponseHours: number | null;
    slaBreaches: number;
    aiDraftsGenerated: number;
    aiDraftsUsed: number;
}

/** Por qué "Sugerir respuesta" no generó un borrador. Se traducen en Support.aiReason_*. */
export const SUPPORT_AI_UNAVAILABLE_REASONS = [
    "global_disabled",
    "feature_disabled",
    "tenant_disabled",
    "tier",
    "quota",
    "rate_limited",
    "not_configured",
    "error",
    "validation",
    "data_sharing",
    "no_sources",
] as const;
export type SupportAiUnavailableReason = (typeof SUPPORT_AI_UNAVAILABLE_REASONS)[number];

export type SupportReplyDraftResult =
    | { aiAvailable: true; messageId: string; draftId: string }
    | { aiAvailable: false; reason: SupportAiUnavailableReason };

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

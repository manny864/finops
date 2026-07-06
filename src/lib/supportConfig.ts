/**
 * Configuración del sistema de soporte interno por tier.
 *
 * Puerta de entrada: Essential (todos los tiers tienen acceso al panel).
 * La diferencia por tier es la cuota mensual de tickets y el SLA de primera
 * respuesta que se comunica en la UI.
 *
 * `monthlyTicketQuota: null` = ilimitado.
 */
export interface SupportTierConfig {
    monthlyTicketQuota: number | null;
    firstResponseSlaHours: number;
}

const SUPPORT_TIERS: Record<string, SupportTierConfig> = {
    Essential: { monthlyTicketQuota: 5, firstResponseSlaHours: 48 },
    Professional: { monthlyTicketQuota: 20, firstResponseSlaHours: 24 },
    Business: { monthlyTicketQuota: null, firstResponseSlaHours: 8 },
    Enterprise: { monthlyTicketQuota: null, firstResponseSlaHours: 4 },
};

export function getSupportConfig(tier: string): SupportTierConfig {
    const t = (tier || '').trim().toLowerCase();
    if (t === 'enterprise') return SUPPORT_TIERS.Enterprise;
    if (t === 'business') return SUPPORT_TIERS.Business;
    if (t === 'pro' || t === 'professional') return SUPPORT_TIERS.Professional;
    // Fail-closed a la cuota más restrictiva para tiers desconocidos.
    return SUPPORT_TIERS.Essential;
}

export const SUPPORT_TICKET_CATEGORIES = ['technical', 'billing', 'question', 'feature_request'] as const;
export const SUPPORT_TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const SUPPORT_TICKET_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;

export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const SUPPORT_SUBJECT_MAX = 255;
export const SUPPORT_BODY_MAX = 10000;

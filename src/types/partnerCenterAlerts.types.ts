/**
 * Tipos y contratos TypeScript para Alertas de Suscripción Microsoft Partner Center (SuperAdmin).
 */

export type PartnerAssociationStatus = "LINKED" | "APPROVED_PENDING" | "LINK_ERROR" | "UNLINKED";

export type SaaSPlanTier = "Professional" | "Business" | "Enterprise";

export interface PartnerCenterMetrics {
    linkedPalCount: number;
    approvedPendingCount: number;
    linkErrorCount: number;
    eventsLast7DaysCount: number;
}

export interface TenantPartnerAssociationItem {
    id: string;
    tenantId: string;
    organizationName: string;
    entraTenantGuid: string;
    planTier: SaaSPlanTier;
    status: PartnerAssociationStatus;
    formattedStatus: string;
    approvedByEmail: string;
    approvedAtIso: string;
    formattedDate: string;
    errorDetailsText?: string;
    partnerMpnId?: string;
}

export interface PartnerCenterStatusResponse {
    success: boolean;
    metrics: PartnerCenterMetrics;
    items: TenantPartnerAssociationItem[];
    partnerMpnConfigured: boolean;
    currentPartnerMpnId: string;
    totalCount: number;
}

export interface RelinkPartnerPayload {
    tenantId: string;
    partnerMpnId?: string;
}

export interface RelinkPartnerResponse {
    success: boolean;
    tenantId: string;
    status: PartnerAssociationStatus;
    message: string;
}

export interface ConfigureMpnPayload {
    partnerMpnId: string;
}

export interface ConfigureMpnResponse {
    success: boolean;
    partnerMpnId: string;
    message: string;
}

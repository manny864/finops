/**
 * Tipos y contratos TypeScript para la Gestión Global de Tenants (SuperAdmin).
 */

export type SaaSPlanTier = "Professional" | "Business" | "Enterprise";

export type TenantSubscriptionStatus = "ACTIVE" | "TRIAL" | "PAST_DUE" | "CANCELED";

export interface SuperAdminTenantItem {
    tenantId: string;
    entraTenantId: string;
    organizationName: string;
    subscriptionStatus: TenantSubscriptionStatus;
    planTier: SaaSPlanTier;
    salesRepName: string;
    salesCommissionPercent: number;
    paddlePriceId?: string;
    parentTenantId?: string;
    contractId?: string;
    isManualBypass: boolean;
    createdAtIso: string;
}

export interface CreateManualTenantPayload {
    entraTenantId: string;
    organizationName: string;
    initialPlanTier: SaaSPlanTier;
}

export interface UpdateCommercialDealPayload {
    tenantId: string;
    salesRepName: string;
    salesCommissionPercent: number;
}

export interface UpdateTenantTierPayload {
    tenantId: string;
    planTier: SaaSPlanTier;
    subscriptionStatus?: TenantSubscriptionStatus;
}

export interface GeneratePaddleLinkPayload {
    tenantId: string;
    paddlePriceId: string;
}

export interface GeneratePaddleLinkResponse {
    checkoutUrl: string;
    priceId: string;
    tenantId: string;
    expiresAtIso?: string;
}

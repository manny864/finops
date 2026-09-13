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
    /**
     * Fecha formal de venta, `YYYY-MM-DD`. Ausente en los tenants dados de alta
     * antes de registrarla: no se inventa una fecha retroactiva, porque el
     * devengamiento de comisiones arranca desde acá (MEJ-14).
     */
    soldAtIso?: string;
    /** Define qué regla de comisión aplica: anual liquida de una, mensual en 12. */
    contractTerm: 'annual' | 'monthly';
    paddlePriceId?: string;
    parentTenantId?: string;
    contractId?: string;
    isManualBypass: boolean;
    /** Sólo presente si el tenant está en trial. */
    trialEndsAtIso?: string;
    createdAtIso: string;
    /** MEJ-12. Los tenants anteriores a la migración traen el `created_at` del
     *  registro como aproximación del alta — no es la fecha de onboarding
     *  efectivo, que para ellos se perdió. */
    activatedAtIso?: string;
    suspendedAtIso?: string;
    canceledAtIso?: string;
    cancellationReason?: string;
}

/**
 * Plazos de trial ofrecidos en el alta manual. Cerrado a propósito: un input
 * libre deja pasar un "300" por error de tipeo y regala 10 meses de acceso.
 */
export const MANUAL_TRIAL_DAY_OPTIONS = [7, 15, 30] as const;

export type ManualTrialDays = (typeof MANUAL_TRIAL_DAY_OPTIONS)[number];

export interface CreateManualTenantPayload {
    entraTenantId: string;
    organizationName: string;
    initialPlanTier: SaaSPlanTier;
    /**
     * Días de trial. Ausente o 0 crea el tenant `ACTIVE` sin vencimiento, que es
     * el caso del cliente con contrato firmado (el alta manual original).
     */
    trialDays?: ManualTrialDays | 0;
}

export interface UpdateCommercialDealPayload {
    tenantId: string;
    salesRepName: string;
    salesCommissionPercent: number;
    /** Sólo se usa si el tenant todavía no tiene fecha registrada. */
    soldAt?: string | null;
    contractTerm?: 'annual' | 'monthly';
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

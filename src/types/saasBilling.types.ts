/**
 * Tipos y contratos TypeScript para la gestión de suscripciones SaaS, pasarelas de pago y facturación.
 */

export type SaaSPlanTier = "Professional" | "Business" | "Enterprise";

export type SaaSSubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIALING";

export interface SaaSInvoiceItem {
    id: string;
    invoiceNumber: string;
    /**
     * ISO crudo. NO viaja una fecha ya formateada: el servicio la armaba con
     * `toLocaleDateString("es-ES")` fijo, asi que la tabla mostraba la fecha en
     * castellano tambien con la UI en ingles. El formato lo pone la pantalla,
     * que es la unica que conoce el locale activo.
     */
    billingDateIso: string;
    amountUSD: number;
    status: "PAID" | "PENDING" | "FAILED";
    downloadPdfUrl?: string;
    receiptUrl?: string;
}

export interface TenantBillingDetails {
    tenantId: string;
    planTier: SaaSPlanTier;
    status: SaaSSubscriptionStatus;
    billingCycle: "MONTHLY" | "ANNUAL";
    paymentGateway: string;
    currentPeriodStartIso?: string;
    currentPeriodEndIso: string;
    cancelAtPeriodEnd: boolean;
    isEnterprise?: boolean;
    invoices: SaaSInvoiceItem[];
}

export interface CustomerPortalResponse {
    success: boolean;
    portalUrl: string;
    gateway: string;
}

export interface CancelSubscriptionResponse {
    success: boolean;
    message: string;
    effectiveDateIso: string;
}

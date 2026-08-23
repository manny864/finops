/**
 * Tipos y contratos TypeScript para la gestión de suscripciones SaaS, pasarelas de pago y facturación.
 */

export type SaaSPlanTier = "Professional" | "Business" | "Enterprise";

export type SaaSSubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIALING";

export interface SaaSInvoiceItem {
    id: string;
    invoiceNumber: string;
    billingDateIso: string;
    formattedDate: string;
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

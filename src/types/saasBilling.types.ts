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
    /** Importe en la moneda del cobro (`currency`): Paddle puede cobrar en USD o EUR. */
    amount: number;
    /** Código ISO 4217 de `amount`. */
    currency: string;
    /** REFUND_PENDING: reembolso pedido y esperando aprobación; REFUNDED: ya aprobado. */
    status: "PAID" | "PENDING" | "FAILED" | "REFUND_PENDING" | "REFUNDED";
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
    /** Hay una solicitud de cancelación esperando la aprobación de un SuperAdmin. */
    cancellationPending?: boolean;
    isEnterprise?: boolean;
    /**
     * Si el tenant tiene una suscripcion viva en Paddle. Decide a donde lleva
     * "Modificar Suscripcion": con suscripcion hay que MODIFICARLA (un checkout
     * nuevo abriria una segunda y la capacidad comprada se perderia); sin
     * suscripcion --alta manual, contrato cargado a mano-- hay que contratarla.
     */
    hasPaddleSubscription?: boolean;
    invoices: SaaSInvoiceItem[];
}

export interface CustomerPortalResponse {
    success: boolean;
    portalUrl: string;
    gateway: string;
    /**
     * `true` cuando no se pudo resolver la URL personal de la suscripción y se
     * devuelve el link genérico de Paddle. La UI lo usa para avisar que ahí hay
     * que buscar la suscripción a mano, en vez de prometer algo que no es.
     */
    generic?: boolean;
}

export interface CancelSubscriptionResponse {
    success: boolean;
    message: string;
    effectiveDateIso: string;
    /** La baja no se pudo ejecutar sola: quedó como solicitud pendiente de aprobación. */
    pendingApproval?: boolean;
}

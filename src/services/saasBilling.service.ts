/**
 * Servicio de gestión de suscripciones SaaS, pasarelas de pago y facturación recurrente.
 */

import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import {
    SaaSPlanTier,
    SaaSSubscriptionStatus,
    SaaSInvoiceItem,
    TenantBillingDetails,
    CustomerPortalResponse,
    CancelSubscriptionResponse,
} from "@/types/saasBilling.types";

/**
 * Retorna la información de suscripción y facturación sintética para tenants de demostración.
 */
function getMockBillingDetails(tenantId: string): TenantBillingDetails {
    const now = new Date();
    const oneYearLater = new Date(now.getTime() + 365 * 86400000);
    const augDate = new Date(now.getFullYear(), 7, 1);
    const julDate = new Date(now.getFullYear(), 6, 1);
    const junDate = new Date(now.getFullYear(), 5, 1);

    const invoices: SaaSInvoiceItem[] = [
        {
            id: "inv-mock-0842",
            invoiceNumber: "INV-2026-0842",
            billingDateIso: augDate.toISOString(),
            formattedDate: augDate.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }),
            amountUSD: 1200.0,
            status: "PAID",
            downloadPdfUrl: "/api/billing/invoices/mock-0842/pdf",
        },
        {
            id: "inv-mock-0742",
            invoiceNumber: "INV-2026-0742",
            billingDateIso: julDate.toISOString(),
            formattedDate: julDate.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }),
            amountUSD: 1200.0,
            status: "PAID",
            downloadPdfUrl: "/api/billing/invoices/mock-0742/pdf",
        },
        {
            id: "inv-mock-0642",
            invoiceNumber: "INV-2026-0642",
            billingDateIso: junDate.toISOString(),
            formattedDate: junDate.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }),
            amountUSD: 1200.0,
            status: "PAID",
            downloadPdfUrl: "/api/billing/invoices/mock-0642/pdf",
        },
    ];

    return {
        tenantId,
        planTier: "Enterprise",
        status: "ACTIVE",
        billingCycle: "ANNUAL",
        paymentGateway: "PADDLE",
        currentPeriodStartIso: new Date(now.getTime() - 60 * 86400000).toISOString(),
        currentPeriodEndIso: oneYearLater.toISOString(),
        cancelAtPeriodEnd: false,
        isEnterprise: true,
        invoices,
    };
}

/**
 * Obtiene el detalle de suscripción y facturas de un tenant.
 */
export async function getTenantBillingDetails(tenantId: string): Promise<TenantBillingDetails> {
    if (!tenantId) {
        throw new Error("Falta tenantId");
    }

    if (isMockTenant(tenantId)) {
        return getMockBillingDetails(tenantId);
    }

    let planTier: SaaSPlanTier = "Enterprise";
    let status: SaaSSubscriptionStatus = "ACTIVE";
    let billingCycle: "MONTHLY" | "ANNUAL" = "MONTHLY";
    let paymentGateway = "PADDLE";
    let currentPeriodEndIso = new Date(Date.now() + 30 * 86400000).toISOString();
    let cancelAtPeriodEnd = false;
    let isEnterprise = false;

    // 1. Consultar tabla TenantSaaSSubscriptions o fallback a Tenants
    try {
        const [subRows]: any = await pool.query(
            `SELECT plan_tier, status, billing_cycle, payment_gateway, current_period_end, cancel_at_period_end FROM TenantSaaSSubscriptions WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );

        if (Array.isArray(subRows) && subRows.length > 0) {
            const row = subRows[0];
            planTier = (row.plan_tier as SaaSPlanTier) || "Business";
            status = (row.status as SaaSSubscriptionStatus) || "ACTIVE";
            billingCycle = row.billing_cycle === "ANNUAL" ? "ANNUAL" : "MONTHLY";
            paymentGateway = row.payment_gateway || "PADDLE";
            currentPeriodEndIso = row.current_period_end ? new Date(row.current_period_end).toISOString() : currentPeriodEndIso;
            cancelAtPeriodEnd = Boolean(row.cancel_at_period_end);
            isEnterprise = planTier.toLowerCase() === "enterprise";
        } else {
            // Fallback a Tenants
            const [tRows]: any = await pool.query(
                `SELECT tier, subscription_status FROM Tenants WHERE id = ? LIMIT 1`,
                [tenantId]
            );
            if (Array.isArray(tRows) && tRows.length > 0) {
                const tRow = tRows[0];
                const rawTier = (tRow.tier || "Enterprise").toLowerCase();
                planTier = rawTier.includes("pro") ? "Professional" : rawTier.includes("bus") ? "Business" : "Enterprise";
                status = (tRow.subscription_status as SaaSSubscriptionStatus) || "ACTIVE";
                isEnterprise = planTier === "Enterprise";
            }
        }
    } catch {
        // Fallback resiliente
    }

    // 2. Consultar facturas reales
    const invoices: SaaSInvoiceItem[] = [];
    try {
        const [invRows]: any = await pool.query(
            `SELECT id, invoice_number, billing_date, amount_usd, status, download_pdf_url FROM SaaSInvoices WHERE tenant_id = ? ORDER BY billing_date DESC LIMIT 50`,
            [tenantId]
        );

        if (Array.isArray(invRows)) {
            for (const r of invRows) {
                const bDate = r.billing_date ? new Date(r.billing_date) : new Date();
                invoices.push({
                    id: String(r.id),
                    invoiceNumber: r.invoice_number || `INV-${r.id}`,
                    billingDateIso: bDate.toISOString(),
                    formattedDate: bDate.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }),
                    amountUSD: Number(r.amount_usd) || 0,
                    status: (r.status as any) || "PAID",
                    downloadPdfUrl: r.download_pdf_url || undefined,
                });
            }
        }
    } catch {
        /* noop */
    }

    return {
        tenantId,
        planTier,
        status,
        billingCycle,
        paymentGateway,
        currentPeriodEndIso,
        cancelAtPeriodEnd,
        isEnterprise,
        invoices,
    };
}

/**
 * Genera la URL para que el usuario acceda al portal de pagos del cliente.
 */
export async function getCustomerPortalUrl(tenantId: string): Promise<CustomerPortalResponse> {
    if (!tenantId) {
        throw new Error("Falta tenantId");
    }

    if (isMockTenant(tenantId)) {
        return {
            success: true,
            portalUrl: "https://sandbox-checkout.paddle.com/portal-demo",
            gateway: "PADDLE",
        };
    }

    // En producción, consulta el external_customer_id o genera la sesión con Paddle/Stripe
    const portalUrl = process.env.PADDLE_PORTAL_URL || "https://checkout.paddle.com/portal";
    return {
        success: true,
        portalUrl,
        gateway: "PADDLE",
    };
}

/**
 * Programa la cancelación de la suscripción al final del período actual.
 */
export async function cancelTenantSubscription(
    tenantId: string,
    userEmail?: string
): Promise<CancelSubscriptionResponse> {
    if (!tenantId) {
        throw new Error("Falta tenantId");
    }

    const effectiveDate = new Date(Date.now() + 30 * 86400000);

    if (isMockTenant(tenantId)) {
        return {
            success: true,
            message: "Suscripción de prueba cancelada programada para el final del período.",
            effectiveDateIso: effectiveDate.toISOString(),
        };
    }

    try {
        await pool.query(
            `UPDATE TenantSaaSSubscriptions SET cancel_at_period_end = TRUE WHERE tenant_id = ?`,
            [tenantId]
        );
    } catch {
        try {
            await pool.query(
                `UPDATE Tenants SET subscription_status = 'CANCELED_PENDING' WHERE id = ?`,
                [tenantId]
            );
        } catch {
            /* noop */
        }
    }

    // Registro en auditoría
    try {
        await pool.query(
            `INSERT INTO SecurityAuditTrail (tenant_id, event_type, user_email, description) VALUES (?, ?, ?, ?)`,
            [
                tenantId,
                "SUBSCRIPTION_CANCEL_REQUESTED",
                userEmail || "admin@cscloudsolutions.com",
                "Cancelación de suscripción SaaS programada para fin de período.",
            ]
        );
    } catch {
        /* noop */
    }

    return {
        success: true,
        message: "Tu suscripción se cancelará al final del período de facturación actual.",
        effectiveDateIso: effectiveDate.toISOString(),
    };
}

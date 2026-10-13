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
import { azurePlanToBillingCycle } from "@/lib/marketplace/planMapping";
import { getPaddleBaseUrl } from "@/lib/paddleTierMap";
import { cancelarSuscripcion } from "@/lib/paddleSubscriptions";
import { registrarAuditoria } from "@/lib/auditTrail";
import { crearSolicitud, tieneSolicitudPendiente, type MotivoSolicitud } from "@/services/cancellationRequests.service";
import { normalizeTier } from "@/lib/tierLogic";

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
            amountUSD: 1200.0,
            status: "PAID",
        },
        {
            id: "inv-mock-0742",
            invoiceNumber: "INV-2026-0742",
            billingDateIso: julDate.toISOString(),
            amountUSD: 1200.0,
            status: "PAID",
        },
        {
            id: "inv-mock-0642",
            invoiceNumber: "INV-2026-0642",
            billingDateIso: junDate.toISOString(),
            amountUSD: 1200.0,
            status: "PAID",
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

    // El default NO es Enterprise: si la lectura falla, mostrar el tier MAS ALTO
    // le promete al cliente capacidades que no tiene ("suscripciones ilimitadas",
    // "soporte 24/7") y esconde el boton de cambiar plan. Professional es el
    // mismo default que usa `requireTenantTier` cuando no encuentra el tier.
    let planTier: SaaSPlanTier = "Professional";
    let status: SaaSSubscriptionStatus = "ACTIVE";
    let billingCycle: "MONTHLY" | "ANNUAL" = "MONTHLY";
    let paymentGateway = "PADDLE";
    let currentPeriodEndIso = new Date(Date.now() + 30 * 86400000).toISOString();
    let cancelAtPeriodEnd = false;
    let isEnterprise = false;
    let hasPaddleSubscription = false;

    // 1. El tier sale de `Tenants`, que es la fuente que usa el resto de la app
    //    para AUTORIZAR (`requireTenantTier`, cuotas, marketplace). Mostrar otra
    //    cosa aca es prometer un plan distinto del que realmente se aplica.
    //
    //    BUG QUE ARREGLA (2026-09-13): esto consultaba `TenantSaaSSubscriptions`,
    //    una tabla que NO EXISTE --no tiene DDL en el repo y nadie mas la toca--,
    //    asi que la query tiraba "Table doesn't exist", el catch se la tragaba y
    //    los valores quedaban en el inicializador. Y el fallback tampoco servia:
    //    filtraba por `WHERE id = ?` cuando la clave es `tenant_id` (`Tenants.id`
    //    es un INT autoincrement, asi que comparar un GUID daba cero filas).
    //    Resultado: TODO tenant real veia "Enterprise" en Mi cuenta, sin importar
    //    lo que pagara.
    try {
        const [tRows]: any = await pool.query(
            `SELECT tier, subscription_status, marketplace_plan_id, marketplace_source, paddle_subscription_id
               FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );

        if (Array.isArray(tRows) && tRows.length > 0) {
            const tRow = tRows[0];
            planTier = (normalizeTier(tRow.tier) as SaaSPlanTier) || "Professional";
            status = (tRow.subscription_status as SaaSSubscriptionStatus) || "ACTIVE";
            isEnterprise = planTier === "Enterprise";
            hasPaddleSubscription = Boolean(tRow.paddle_subscription_id);

            // Los tenants que entran por Azure Marketplace no tienen suscripcion de
            // Paddle: el ciclo se deriva de `marketplace_plan_id`, que es el unico
            // lugar donde sobrevive (`azurePlanToTier()` lo descarta al quedarse
            // con el tier). Sin esto el panel le decia "mensual, cobrado por
            // Paddle" a alguien que compro anual y le factura Microsoft.
            if (tRow.marketplace_source === "azure_marketplace" || tRow.marketplace_plan_id) {
                billingCycle = azurePlanToBillingCycle(tRow.marketplace_plan_id);
                paymentGateway = "AZURE_MARKETPLACE";
            }
        }
    } catch (e) {
        console.warn("[saasBilling] No se pudo leer el plan del tenant:", (e as Error)?.message);
    }

    // La cancelacion programada vive en su propia columna (migracion 005). Va
    // aparte porque es la unica que puede no existir todavia en un entorno sin
    // migrar, y no debe llevarse puesto el tier si falta.
    try {
        const [cRows]: any = await pool.query(
            `SELECT cancel_at_period_end FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        cancelAtPeriodEnd = Boolean(cRows?.[0]?.cancel_at_period_end);
    } catch {
        /* entorno sin migrar: no hay cancelacion programada que mostrar */
    }

    // Una solicitud de cancelación que espera la aprobación de un SuperAdmin: el cliente la ve «en revisión».
    let cancellationPending = false;
    try {
        cancellationPending = await tieneSolicitudPendiente(tenantId);
    } catch {
        /* entorno sin migrar */
    }

    // 2. Historial de cobros. Sale de `BillingTransactions` (lo que Paddle cobró de verdad):
    // `SaaSInvoices` no existe en ninguna migración y la lista llegaba siempre vacía.
    // Paddle no nos manda un número de factura ni un PDF propios, así que el «número» es el id de la
    // transacción y `downloadPdfUrl` queda vacío: la pantalla cae a /api/billing/invoices/[id]/pdf,
    // que arma el documento con estos mismos datos. Sólo USD porque `amountUSD` y el PDF lo dan por hecho.
    const invoices: SaaSInvoiceItem[] = [];
    try {
        const [invRows]: any = await pool.query(
            `SELECT id, paddle_transaction_id, amount, COALESCE(billed_at, created_at) AS billed_on
               FROM BillingTransactions
              WHERE tenant_id = ? AND status = 'completed' AND currency = 'USD'
              ORDER BY billed_at DESC, created_at DESC
              LIMIT 50`,
            [tenantId]
        );

        if (Array.isArray(invRows)) {
            for (const r of invRows) {
                invoices.push({
                    id: String(r.id),
                    invoiceNumber: r.paddle_transaction_id || String(r.id),
                    billingDateIso: new Date(r.billed_on).toISOString(),
                    amountUSD: Number(r.amount) || 0,
                    status: "PAID",
                });
            }
        }
    } catch (e) {
        console.warn("[saasBilling] No se pudo leer el historial de cobros:", (e as Error)?.message);
    }

    return {
        tenantId,
        planTier,
        status,
        billingCycle,
        paymentGateway,
        currentPeriodEndIso,
        cancelAtPeriodEnd,
        cancellationPending,
        isEnterprise,
        hasPaddleSubscription,
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

    // La URL del portal es PERSONAL de cada suscripción: Paddle Billing la
    // devuelve en `management_urls` de GET /subscriptions/{id}, firmada y ya
    // apuntada a la suscripción del cliente.
    //
    // Antes esto devolvía `PADDLE_PORTAL_URL` o un link fijo a
    // checkout.paddle.com/portal, igual para todos: el cliente aterrizaba en una
    // página genérica a buscar su propia suscripción.
    const [rows]: any = await pool.query(
        "SELECT paddle_subscription_id FROM Tenants WHERE tenant_id = ? LIMIT 1",
        [tenantId]
    );
    const subscriptionId = rows?.[0]?.paddle_subscription_id;
    const apiKey = process.env.PADDLE_API_KEY;

    if (subscriptionId && apiKey) {
        try {
            const resp = await fetch(`${getPaddleBaseUrl()}/subscriptions/${subscriptionId}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            const json: any = await resp.json();
            if (resp.ok) {
                // `update_payment_method` es la que sirve para gestionar el medio
                // de pago; `cancel` es la de baja. Se prefiere la primera porque
                // es a lo que viene el usuario desde "Gestionar suscripción".
                const urls = json?.data?.management_urls;
                const url = urls?.update_payment_method || urls?.cancel;
                if (typeof url === "string" && url.startsWith("https://")) {
                    return { success: true, portalUrl: url, gateway: "PADDLE" };
                }
            }
            console.warn(`[saasBilling] Paddle no devolvió management_urls para ${subscriptionId} (status ${resp.status}).`);
        } catch (e) {
            console.warn("[saasBilling] No se pudo pedir el portal a Paddle:", (e as Error)?.message);
        }
    }

    // Sin suscripción (alta manual) o con Paddle caído: el link genérico es lo
    // único que queda. No es bueno, pero es mejor que un botón que no lleva a
    // ningún lado.
    const portalUrl = process.env.PADDLE_PORTAL_URL || "https://checkout.paddle.com/portal";
    return {
        success: true,
        portalUrl,
        gateway: "PADDLE",
        generic: true,
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

    // ¿Esta baja se puede ejecutar SOLA? Sí si el tenant tiene una suscripción de Paddle y Paddle la acepta. Se pide a PADDLE antes de
    // marcar nada: antes sólo se marcaba `cancel_at_period_end` y Paddle seguía cobrando todos los meses. En los demás casos (sin
    // suscripción de Paddle, factura por el marketplace de Azure, o Paddle la rechaza o no responde) no hay nada que la ejecute, y
    // antes quedaba una marca que nadie veía: ahora queda una SOLICITUD que se le avisa al SuperAdmin para que la apruebe. El pedido
    // del cliente nunca se pierde ni se rechaza con un error.
    const [tenantRows]: any = await pool.query("SELECT paddle_subscription_id, marketplace_source FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
    const tenantRow = Array.isArray(tenantRows) ? tenantRows[0] : null;
    if (!tenantRow) {
        throw new Error("No se pudo registrar la cancelación: el tenant no existe.");
    }
    const paddleSubscriptionId: string | null = tenantRow.paddle_subscription_id ?? null;

    let motivo: MotivoSolicitud | null = null;
    let detalle: string | null = null;
    if (tenantRow.marketplace_source === "azure_marketplace") {
        motivo = "azure-marketplace";
    } else if (!paddleSubscriptionId) {
        motivo = "no-paddle-subscription";
    } else {
        try {
            const r = await cancelarSuscripcion(paddleSubscriptionId, "next_billing_period");
            if (!r.ok) {
                motivo = "paddle-rejected";
                detalle = r.detail ? `Paddle: ${r.detail}` : `Paddle contestó HTTP ${r.status}.`;
            }
        } catch (e) {
            motivo = "paddle-rejected";
            detalle = `No se pudo contactar a Paddle: ${(e as Error)?.message || "error de red"}`;
        }
    }

    if (motivo) {
        await crearSolicitud({ tenantId, requestedBy: userEmail || "desconocido", reasonCode: motivo, detail: detalle });
        return {
            success: true,
            pendingApproval: true,
            message: "Recibimos tu solicitud de cancelación. Nuestro equipo la revisa y te avisamos; mientras tanto tu suscripción sigue activa.",
            effectiveDateIso: effectiveDate.toISOString(),
        };
    }

    // Antes esto escribia en `TenantSaaSSubscriptions` (tabla inexistente) y
    // caia a un fallback que filtraba por `WHERE id = ?` y seteaba
    // 'CANCELED_PENDING', un valor que el ENUM de la columna no admite. O sea:
    // no persistia NADA y la funcion devolvia success igual. El cliente pedia la
    // baja, la app le decia "listo" y no quedaba registro en ningun lado.
    const [res]: any = await pool.query(
        `UPDATE Tenants SET cancel_at_period_end = TRUE WHERE tenant_id = ?`,
        [tenantId]
    );
    if (!res?.affectedRows) {
        throw new Error("No se pudo registrar la cancelación: el tenant no existe.");
    }

    // Registro en auditoría
    await registrarAuditoria(
        tenantId,
        "SUBSCRIPTION_CANCEL_REQUESTED",
        userEmail || "admin@cscloudsolutions.com",
        "Cancelación de suscripción SaaS programada para fin de período."
    );

    return {
        success: true,
        message: "Tu suscripción se cancelará al final del período de facturación actual.",
        effectiveDateIso: effectiveDate.toISOString(),
    };
}

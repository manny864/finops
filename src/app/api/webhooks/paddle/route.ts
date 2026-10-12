import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/modules/storage/db";
import { recordTenantLifecycleTransition } from "@/services/tenantLifecycle.service";
import { resolveAddonQuantities, applyAddonCapacity } from "@/lib/paddleAddons";
import { priceIdToTier, TierName } from "@/lib/paddleTierMap";
import { notifyInternalCancellation } from "@/lib/billingAlerts";
import { errorMessage } from "@/lib/apiErrors";
import { applyTierChange } from "@/services/providerLifecycleService";

/**
 * Tier actual del tenant ANTES de escribir el nuevo. Lo recibe
 * `applyTierChange`, que hoy es no-op — la plataforma es Azure-only y no hay
 * proveedor secundario que archivar o restaurar. Se mantiene el par
 * (previousTier, nextTier) porque es el único momento en que ambos valores
 * están disponibles a la vez.
 */
async function readCurrentTier(connection: any, tenantId: string): Promise<string | null> {
  const [rows] = await connection.query("SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
  return (rows as Array<{ tier?: string }>)[0]?.tier ?? null;
}

/**
 * Resuelve el tier de una suscripción de Paddle. Prioridad:
 * 1. El precio, vía `priceIdToTier`: mapeo fijo por env vars para los planes self-service (Professional/Business).
 * 2. Enterprise, que usa un Price a medida por cliente sin mapeo fijo: sólo si `custom_data.tier` lo pide Y el precio
 *    pagado es el que un SuperAdmin REGISTRÓ para ESTE tenant (`TenantSubscriptions.paddle_price_id`, ver
 *    `generatePaddleCheckoutLink`).
 *
 * Por qué no alcanza con `custom_data.tier`: quien abre un checkout con Paddle.js elige su `customData`, y el token de
 * cliente y Paddle.js son públicos. Con `custom_data.tier` en primer lugar, `Paddle.Checkout.open({ items: [plan
 * Professional], customData: { tenant_id, tier: "Enterprise" } })` desde la consola del navegador pagaba el precio de
 * Professional y activaba Enterprise. Ahora el tier sale del precio pagado o de un registro del lado del servidor, nunca de
 * un dato que mande el comprador. `custom_data.tier` con "Professional" o "Business" ya no cuenta: el precio decide.
 *
 * Devuelve null si no se puede resolver, en vez de asumir "Professional": un evento con un priceId no mapeado NO debe
 * degradar silenciosamente el tier de un tenant existente.
 */
async function resolveTier(payload: any, tenantId?: string): Promise<TierName | null> {
  const priceId: string | undefined = payload.data?.items?.[0]?.price?.id;
  const porPrecio = priceId ? priceIdToTier(priceId) : null;
  if (porPrecio) return porPrecio;
  if (payload.data?.custom_data?.tier === "Enterprise" && tenantId && priceId && (await esDealEnterpriseRegistrado(tenantId, priceId))) {
    return "Enterprise";
  }
  return null;
}

/** ¿Un SuperAdmin registró este precio como el deal Enterprise de este tenant? Sin try/catch: si la base falla, 500 y Paddle reintenta. */
async function esDealEnterpriseRegistrado(tenantId: string, priceId: string): Promise<boolean> {
  const [rows] = await pool.query("SELECT 1 FROM TenantSubscriptions WHERE tenant_id = ? AND paddle_price_id = ? LIMIT 1", [tenantId, priceId]);
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Fin del período YA PAGADO por el tenant (Paddle current_billing_period.
 * ends_at), independiente de si la suscripción sigue activa o fue
 * cancelada. Al cancelar (ya sea de inmediato o "al final del período"),
 * Paddle no vuelve a facturar, pero el acceso debe seguir vigente hasta
 * esta fecha — no antes. Devuelve null si el payload no la trae (ej. un
 * evento sin ese campo), en cuyo caso no se pisa el valor ya guardado.
 */
function resolveAccessUntil(payload: any): Date | null {
  const endsAt = payload.data?.current_billing_period?.ends_at;
  if (!endsAt) return null;
  const date = new Date(endsAt);
  return Number.isNaN(date.getTime()) ? null : date;
}
import { minorUnitsToDecimalString } from "@/lib/money";
import { devengarComision, revertirComision } from "@/services/affiliates.service";
import { devengarComisionComercial, cancelarComisionesPorChurn } from "@/services/commissions.service";

const REPLAY_WINDOW_SECONDS = 5 * 60; // 5 minutes

/**
 * Paddle webhook signature verification & handling
 * Supports: subscription.created, subscription.updated, subscription.canceled, subscription.past_due,
 *           transaction.completed, transaction.payment_failed, adjustment.created, adjustment.updated
 * (los reembolsos y contracargos llegan como adjustments: Paddle Billing no tiene un `transaction.refunded`)
 */
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!secret) {
      console.error("[Webhooks] PADDLE_WEBHOOK_SECRET is not set.");
      return NextResponse.json({ error: "Webhook secret is not configured" }, { status: 500 });
    }

    // Verify signature
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("paddle-signature") || "";

    // paddle-signature format: ts=1671552777;h1=1a2b3c...
    const parts = signatureHeader.split(";");
    const tsPart = parts.find((p) => p.startsWith("ts="));
    const h1Part = parts.find((p) => p.startsWith("h1="));

    if (!tsPart || !h1Part) {
      return NextResponse.json({ error: "Invalid signature format" }, { status: 401 });
    }

    const ts = tsPart.split("=")[1];
    const h1 = h1Part.split("=")[1];
    const timestamp = Number(ts);

    if (!Number.isFinite(timestamp)) {
      return NextResponse.json({ error: "Invalid signature timestamp" }, { status: 401 });
    }

    // Check replay window
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) {
      return NextResponse.json({ error: "Stale webhook signature timestamp" }, { status: 401 });
    }

    // Verify HMAC
    const payloadToSign = `${ts}:${rawBody}`;
    const hmac = crypto.createHmac("sha256", secret);
    const digestHex = hmac.update(payloadToSign).digest("hex");
    const received = Buffer.from(h1, "hex");
    const expected = Buffer.from(digestHex, "hex");

    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      console.error("[Webhooks] Invalid HMAC signature for Paddle.");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse payload
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const eventType = payload.event_type;
    const tenantId = payload.data?.custom_data?.tenant_id;

    console.log(`[Webhooks] Processing event ${eventType} for Tenant ID: ${tenantId}`);

    // Route by event type
    switch (eventType) {
      case "subscription.created":
        return handleSubscriptionCreated(payload, tenantId);
      case "subscription.updated":
        return handleSubscriptionUpdated(payload, tenantId);
      case "subscription.canceled":
        return handleSubscriptionCanceled(payload, tenantId);
      case "subscription.past_due":
        return handleSubscriptionPastDue(payload, tenantId);
      case "transaction.completed":
        return handleTransactionCompleted(payload, tenantId);
      case "transaction.payment_failed":
        return handleTransactionPaymentFailed(payload, tenantId);
      case "adjustment.created":
      case "adjustment.updated":
        return handleAdjustment(payload);
      default:
        console.log(`[Webhooks] Ignoring event type: ${eventType}`);
        return NextResponse.json({ success: true, message: "Event ignored" });
    }
  } catch (error) {
    console.error("[Webhooks] Error interno:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}


/**
 * Capacidad comprada como add-on (slots de tenant y de suscripción).
 *
 * Se llama en `subscription.created` y `subscription.updated` —NO en
 * `transaction.completed`— porque los add-ons son mensuales: `completed`
 * dispara en cada renovación y sumar ahí acumularía capacidad para siempre.
 * Los ítems de la suscripción son la cantidad VIGENTE, así que fijarla desde
 * ahí es idempotente y además baja la capacidad cuando el add-on se cancela.
 *
 * Best-effort: si esto falla, el plan del cliente igual quedó actualizado. Se
 * loguea fuerte porque significa capacidad pagada y no acreditada.
 */
async function syncAddonCapacity(payload: any, tenantId: string): Promise<void> {
  try {
    const quantities = resolveAddonQuantities(payload?.data?.items);
    await applyAddonCapacity(tenantId, quantities);
  } catch (e) {
    console.error(`[Webhooks] No se pudo acreditar la capacidad de add-ons para ${tenantId}:`, errorMessage(e));
  }
}

/**
 * Una suscripción de ADD-ON no es el plan del tenant.
 *
 * El marketplace vende módulos con suscripción mensual propia, y esa alta llega
 * por `subscription.created` con el mismo `tenant_id`. Sin este corte, el
 * handler del plan la trataba como si fuera la suscripción principal:
 *
 *  - `resolveTier` no mapea el price de un módulo, así que caía en la rama que
 *    igual PISA `Tenants.paddle_subscription_id` -- el tenant quedaba apuntando
 *    a la suscripción del módulo en vez de a la de su plan.
 *  - y `syncAddonCapacity` FIJA la capacidad desde los ítems de ese payload, que
 *    no tiene ninguno de slots: le ponía en CERO los tenants y suscripciones
 *    adicionales que el cliente estaba pagando.
 */
function esSuscripcionDeAddon(payload: any): boolean {
  return Boolean(payload?.data?.custom_data?.addon_key);
}

async function handleSubscriptionCreated(payload: any, tenantId?: string) {
  if (esSuscripcionDeAddon(payload)) {
    console.log(
      `[Webhooks] ${payload.event_type} de un add-on (${payload.data.custom_data.addon_key}): no toca el plan del tenant ${tenantId}.`
    );
    return NextResponse.json({ success: true, message: "Addon subscription: plan untouched" });
  }

  if (!tenantId) {
    console.warn("[Webhooks] No tenant_id in custom_data for subscription.created");
    return NextResponse.json({ success: true, message: "Ignored: No tenantId" });
  }

  try {
    const subscriptionId = payload.data?.id;
    const status = payload.data?.status;
    const trialEndsAt = payload.data?.trial_ends_at;
    const tier = await resolveTier(payload, tenantId);
    const accessUntil = resolveAccessUntil(payload);

    // Map Paddle status to internal status
    let internalStatus = "ACTIVE";
    if (status === "trialing") {
      internalStatus = "TRIAL";
    } else if (status === "past_due") {
      internalStatus = "PAST_DUE";
    } else if (status === "canceled") {
      internalStatus = "CANCELED";
    }

    const connection = await pool.getConnection();
    let previousTier: string | null = null;
    try {
      previousTier = await readCurrentTier(connection, tenantId);
      if (tier) {
        await connection.execute(
          `UPDATE Tenants
           SET paddle_subscription_id = ?, subscription_status = ?, tier = ?, trial_ends_at = ?,
               access_until = COALESCE(?, access_until)
           WHERE tenant_id = ?`,
          [subscriptionId, internalStatus, tier, trialEndsAt ? new Date(trialEndsAt) : null, accessUntil, tenantId]
        );
        console.log(
          `[Webhooks] Subscription created for tenant ${tenantId}: tier=${tier}, status=${internalStatus}`
        );
      } else {
        // priceId sin mapeo y sin custom_data.tier: no adivinamos el tier.
        // Igual guardamos el subscription_id/status para no perder el evento.
        await connection.execute(
          `UPDATE Tenants
           SET paddle_subscription_id = ?, subscription_status = ?, trial_ends_at = ?,
               access_until = COALESCE(?, access_until)
           WHERE tenant_id = ?`,
          [subscriptionId, internalStatus, trialEndsAt ? new Date(trialEndsAt) : null, accessUntil, tenantId]
        );
        console.warn(
          `[Webhooks] Subscription created for tenant ${tenantId} but tier could not be resolved (no custom_data.tier, priceId not mapped). Tier left unchanged.`
        );
      }
    } finally {
      connection.release();
    }

    if (tier && previousTier) {
      // Fuera del `finally`: applyTierChange toma su propia conexión del pool.
      await applyTierChange({ tenantId, previousTier, nextTier: tier, actor: "paddle-webhook" });
    }

    await syncAddonCapacity(payload, tenantId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhooks] Error in subscription.created:", error);
    return NextResponse.json({ error: "Failed to process subscription.created" }, { status: 500 });
  }
}

async function handleSubscriptionUpdated(payload: any, tenantId?: string) {
  if (esSuscripcionDeAddon(payload)) {
    console.log(
      `[Webhooks] ${payload.event_type} de un add-on (${payload.data.custom_data.addon_key}): no toca el plan del tenant ${tenantId}.`
    );
    return NextResponse.json({ success: true, message: "Addon subscription: plan untouched" });
  }

  if (!tenantId) {
    console.warn("[Webhooks] No tenant_id in custom_data for subscription.updated");
    return NextResponse.json({ success: true, message: "Ignored: No tenantId" });
  }

  try {
    const status = payload.data?.status;
    const trialEndsAt = payload.data?.trial_ends_at;
    const tier = await resolveTier(payload, tenantId);
    const accessUntil = resolveAccessUntil(payload);

    // Map Paddle status to internal status
    let internalStatus = "ACTIVE";
    if (status === "trialing") {
      internalStatus = "TRIAL";
    } else if (status === "past_due") {
      internalStatus = "PAST_DUE";
    } else if (status === "canceled") {
      internalStatus = "CANCELED";
    }

    const connection = await pool.getConnection();
    let previousTier: string | null = null;
    try {
      previousTier = await readCurrentTier(connection, tenantId);
      if (tier) {
        await connection.execute(
          `UPDATE Tenants
           SET subscription_status = ?, tier = ?, trial_ends_at = ?,
               access_until = COALESCE(?, access_until)
           WHERE tenant_id = ?`,
          [internalStatus, tier, trialEndsAt ? new Date(trialEndsAt) : null, accessUntil, tenantId]
        );
        console.log(
          `[Webhooks] Subscription updated for tenant ${tenantId}: tier=${tier}, status=${internalStatus}`
        );
      } else {
        await connection.execute(
          `UPDATE Tenants
           SET subscription_status = ?, trial_ends_at = ?,
               access_until = COALESCE(?, access_until)
           WHERE tenant_id = ?`,
          [internalStatus, trialEndsAt ? new Date(trialEndsAt) : null, accessUntil, tenantId]
        );
        console.warn(
          `[Webhooks] Subscription updated for tenant ${tenantId} but tier could not be resolved. Tier left unchanged.`
        );
      }
    } finally {
      connection.release();
    }

    if (tier && previousTier) {
      await applyTierChange({ tenantId, previousTier, nextTier: tier, actor: "paddle-webhook" });
    }

    // Acá es donde de verdad cambia la cantidad del add-on: sumar, restar o
    // cancelar un slot llega como `subscription.updated`.
    await syncAddonCapacity(payload, tenantId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhooks] Error in subscription.updated:", error);
    return NextResponse.json({ error: "Failed to process subscription.updated" }, { status: 500 });
  }
}

async function handleSubscriptionCanceled(payload: any, tenantId?: string) {
  if (!tenantId) {
    console.warn("[Webhooks] No tenant_id in custom_data for subscription.canceled");
    return NextResponse.json({ success: true, message: "Ignored: No tenantId" });
  }

  try {
    // El tenant sigue teniendo acceso hasta el final del período que ya
    // pagó (ver access_until / /api/cron/subscription-expiry) — cancelar
    // NO revoca acceso de inmediato. accessUntil normalmente ya quedó
    // guardado por un subscription.updated previo (ej. cuando el cliente
    // programa la cancelación "al final del período"); acá lo volvemos a
    // leer por si este es el único evento que llega (cancelación inmediata).
    const accessUntil = resolveAccessUntil(payload);

    let finalAccessUntil: Date | null = accessUntil;
    const connection = await pool.getConnection();
    try {
      // MEJ-12: el estado y la fecha de baja los escribe
      // `recordTenantLifecycleTransition` (estampa `canceled_at` y deja el
      // evento en el historial). Acá queda sólo `access_until`, que es
      // específico de Paddle y no parte del ciclo de vida.
      await connection.execute(
        `UPDATE Tenants
         SET access_until = COALESCE(?, access_until)
         WHERE tenant_id = ?`,
        [accessUntil, tenantId]
      );
      if (!finalAccessUntil) {
        const [rows]: any = await connection.query(
          "SELECT access_until FROM Tenants WHERE tenant_id = ? LIMIT 1",
          [tenantId]
        );
        finalAccessUntil = rows?.[0]?.access_until ? new Date(rows[0].access_until) : null;
      }
      console.log(`[Webhooks] Subscription canceled for tenant ${tenantId}, access_until=${finalAccessUntil?.toISOString() || '(desconocido)'}`);
    } finally {
      connection.release();
    }

    await recordTenantLifecycleTransition(tenantId, "CANCELED", {
      actor: "paddle-webhook",
      reason: "voluntary_churn",
      metadata: { accessUntil: finalAccessUntil?.toISOString() ?? null },
    });

    // MEJ-14: se cortan las cuotas que todavía no eran exigibles. Las vencidas
    // y las pagadas quedan: el comercial ya se las ganó, y descontarlas sería
    // un saldo negativo retroactivo que la regla prohíbe explícitamente.
    await cancelarComisionesPorChurn(tenantId);

    await notifyInternalCancellation(tenantId, "Paddle", finalAccessUntil);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhooks] Error in subscription.canceled:", error);
    return NextResponse.json({ error: "Failed to process subscription.canceled" }, { status: 500 });
  }
}

async function handleSubscriptionPastDue(payload: any, tenantId?: string) {
  if (!tenantId) {
    console.warn("[Webhooks] No tenant_id in custom_data for subscription.past_due");
    return NextResponse.json({ success: true, message: "Ignored: No tenantId" });
  }

  try {
    const connection = await pool.getConnection();
    try {
      // MEJ-12: la transición la aplica el servicio de ciclo de vida (estampa
      // `suspended_at` y registra el evento).
      await recordTenantLifecycleTransition(tenantId, "SUSPENDED", {
        actor: "paddle-webhook",
        reason: "payment_delinquency",
      });
      console.log(`[Webhooks] Subscription past due for tenant ${tenantId}`);
    } finally {
      connection.release();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhooks] Error in subscription.past_due:", error);
    return NextResponse.json({ error: "Failed to process subscription.past_due" }, { status: 500 });
  }
}

async function handleTransactionCompleted(payload: any, tenantId?: string) {
  try {
    const transactionId = payload.data?.id;
    const subscriptionId = payload.data?.subscription_id;
    const amount = payload.data?.details?.totals?.subtotal;
    const currency = payload.data?.currency_code;
    const billedAt = payload.data?.billed_at;

    // If no tenantId, try to find it via subscription_id (less reliable but better than nothing)
    let tenant = tenantId;
    if (!tenant && subscriptionId) {
      const [rows]: any = await pool.query(
        "SELECT tenant_id FROM Tenants WHERE paddle_subscription_id = ? LIMIT 1",
        [subscriptionId]
      );
      if (Array.isArray(rows) && rows[0]) {
        tenant = rows[0].tenant_id;
      }
    }

    if (!tenant) {
      console.warn("[Webhooks] Could not determine tenant_id for transaction.completed");
      return NextResponse.json({ success: true, message: "Transaction logged without tenant association" });
    }

    const connection = await pool.getConnection();
    try {
      await connection.execute(
        `INSERT INTO BillingTransactions 
         (tenant_id, paddle_transaction_id, paddle_subscription_id, amount, currency, status, billed_at, raw_event)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenant,
          transactionId,
          subscriptionId,
          // Paddle envía montos en unidad menor; conversión exacta sin floats.
          minorUnitsToDecimalString(amount, currency),
          currency,
          "completed",
          billedAt ? new Date(billedAt) : null,
          JSON.stringify(payload),
        ]
      );
      console.log(`[Webhooks] Transaction completed logged for tenant ${tenant}: ${transactionId}`);
    } catch (insertErr: any) {
      // `BillingTransactions.paddle_transaction_id` es UNIQUE, asi que una
      // reentrega del mismo evento choca aca. Antes se propagaba y el handler
      // devolvia 500, con lo cual Paddle volvia a reintentar en loop sobre un
      // evento que ya estaba procesado. Un duplicado es exito, no error.
      if (insertErr?.code !== "ER_DUP_ENTRY") throw insertErr;
      console.log(`[Webhooks] transaction.completed duplicada, ya estaba registrada: ${transactionId}`);
    } finally {
      connection.release();
    }

    // Comision del afiliado que trajo a este tenant, si hay alguno. El referido
    // se resuelve por tenant_id contra AffiliateReferrals: no viene en el
    // custom_data del checkout. Es best-effort e idempotente por
    // paddle_transaction_id, asi que una reentrega no paga dos veces.
    const baseDeComision = {
      tenantId: tenant,
      transactionId,
      subscriptionId,
      baseAmount: minorUnitsToDecimalString(amount, currency),
      currency,
      billedAt: billedAt ? new Date(billedAt) : null,
    };
    await devengarComision(baseDeComision);

    // MEJ-14: y la cuota del comercial que vendió el tenant. Las dos pueden
    // existir sobre el MISMO cobro --un tenant traído por un afiliado y cerrado
    // por un comercial paga las dos-- y son dos filas distintas del libro.
    await devengarComisionComercial(baseDeComision);

    // MEJ-13: acreditar el add-on comprado en el Marketplace.
    //
    // Antes esto exigía `addon_type === "pass"`, y el marketplace vende las dos
    // formas: pase temporal Y suscripción mensual. El que compraba la mensual
    // pagaba y NO recibía el módulo -- la transacción se cobraba, el add-on no
    // se acreditaba en ningún lado y el acceso nunca se abría.
    const customData = payload.data?.custom_data;
    const addonType = customData?.addon_type === "recurring" ? "recurring" : "pass";
    if (customData?.addon_key) {
      try {
        const { TenantAddonsService } = await import("@/services/tenantAddons.service");
        await TenantAddonsService.purchaseAddon(
          tenant,
          String(customData.addon_key),
          addonType,
          Number(customData.months || 1),
          transactionId
        );
        console.log(`[Webhooks] Add-on acreditado para tenant ${tenant}: ${customData.addon_key} (${addonType}, ${customData.months || 1}m)`);
      } catch (addonErr) {
        console.error(`[Webhooks] Error acreditando add-on:`, addonErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhooks] Error in transaction.completed:", error);
    return NextResponse.json({ error: "Failed to process transaction.completed" }, { status: 500 });
  }
}

/**
 * Devolución de plata al cliente. En Paddle Billing llega como un *adjustment* (`adjustment.created` y `adjustment.updated`):
 * no existe un evento `transaction.refunded`, que era de Paddle Classic. `created` llega para TODOS los ajustes y `updated`
 * cuando un reembolso pendiente se aprueba o rechaza; en sandbox Paddle aprueba todos cada diez minutos, y un reembolso que
 * cumple los criterios de aprobación automática nace ya `approved`.
 *
 * Revierte las comisiones del cobro sólo si el ajuste devuelve plata (`refund` o `chargeback`), está `approved` y es TOTAL.
 * Un crédito no devuelve plata; uno pendiente o rechazado todavía no (o nunca) la devolvió; el aviso de contracargo, su
 * reversión y la reversión de un crédito se deciden a mano. Uno PARCIAL no se revierte solo: la comisión se calculó sobre el
 * cobro entero y reducirla en proporción es una decisión contable, no del webhook; queda en el log para revisarlo.
 *
 * Es idempotente: `created` y `updated` del mismo ajuste dan la misma reversión, y `revertirComision` sólo toca lo que
 * todavía no se pagó. Responde 200 siempre: si no había comisión que revertir, tampoco hay nada que Paddle deba reintentar.
 */
async function handleAdjustment(payload: any) {
  const ajuste = payload?.data;
  const devuelvePlata = ajuste?.action === "refund" || ajuste?.action === "chargeback";
  if (!devuelvePlata || ajuste?.status !== "approved" || !ajuste?.transaction_id) {
    return NextResponse.json({ success: true, message: "Ajuste sin efecto sobre las comisiones" });
  }
  if (ajuste.type !== "full") {
    console.warn(
      `[Webhooks] ${payload.event_type}: ${ajuste.action} PARCIAL ${ajuste.id} de la txn ${ajuste.transaction_id}; la comisión no se toca, revisarla a mano.`
    );
    return NextResponse.json({ success: true, message: "Devolución parcial: la comisión se revisa a mano" });
  }
  const { revertidas } = await revertirComision(ajuste.transaction_id);
  return NextResponse.json({ success: true, reversedCommissions: revertidas });
}

async function handleTransactionPaymentFailed(payload: any, tenantId?: string) {
  try {
    const transactionId = payload.data?.id;
    const subscriptionId = payload.data?.subscription_id;

    // If no tenantId, try to find it via subscription_id
    let tenant = tenantId;
    if (!tenant && subscriptionId) {
      const [rows]: any = await pool.query(
        "SELECT tenant_id FROM Tenants WHERE paddle_subscription_id = ? LIMIT 1",
        [subscriptionId]
      );
      if (Array.isArray(rows) && rows[0]) {
        tenant = rows[0].tenant_id;
      }
    }

    if (!tenant) {
      console.warn("[Webhooks] Could not determine tenant_id for transaction.payment_failed");
      return NextResponse.json({ success: true, message: "Failed transaction logged without tenant association" });
    }

    const connection = await pool.getConnection();
    try {
      await connection.execute(
        `INSERT INTO BillingTransactions 
         (tenant_id, paddle_transaction_id, paddle_subscription_id, status, raw_event)
         VALUES (?, ?, ?, ?, ?)`,
        [tenant, transactionId, subscriptionId, "payment_failed", JSON.stringify(payload)]
      );
      console.log(
        `[Webhooks] Payment failed logged for tenant ${tenant}: ${transactionId}`
      );
    } finally {
      connection.release();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhooks] Error in transaction.payment_failed:", error);
    return NextResponse.json({ error: "Failed to process transaction.payment_failed" }, { status: 500 });
  }
}


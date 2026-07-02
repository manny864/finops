import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/modules/storage/db";
import { priceIdToTier, TierName } from "@/lib/paddleTierMap";
import { minorUnitsToDecimalString } from "@/lib/money";

const REPLAY_WINDOW_SECONDS = 5 * 60; // 5 minutes

/**
 * Paddle webhook signature verification & handling
 * Supports: subscription.created, subscription.updated, subscription.canceled, subscription.past_due,
 *           transaction.completed, transaction.payment_failed
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
      default:
        console.log(`[Webhooks] Ignoring event type: ${eventType}`);
        return NextResponse.json({ success: true, message: "Event ignored" });
    }
  } catch (error: any) {
    console.error("[Webhooks] Error interno:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

async function handleSubscriptionCreated(payload: any, tenantId?: string) {
  if (!tenantId) {
    console.warn("[Webhooks] No tenant_id in custom_data for subscription.created");
    return NextResponse.json({ success: true, message: "Ignored: No tenantId" });
  }

  try {
    const subscriptionId = payload.data?.id;
    const status = payload.data?.status;
    const items = payload.data?.items || [];
    const trialEndsAt = payload.data?.trial_ends_at;

    // Map first item price to tier
    let tier: TierName = "Essential";
    if (items.length > 0) {
      const priceId = items[0].price?.id;
      const mappedTier = priceIdToTier(priceId);
      if (mappedTier) {
        tier = mappedTier;
      }
    }

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
    try {
      await connection.execute(
        `UPDATE Tenants 
         SET paddle_subscription_id = ?, subscription_status = ?, tier = ?, trial_ends_at = ?
         WHERE tenant_id = ?`,
        [subscriptionId, internalStatus, tier, trialEndsAt ? new Date(trialEndsAt) : null, tenantId]
      );
      console.log(
        `[Webhooks] Subscription created for tenant ${tenantId}: tier=${tier}, status=${internalStatus}`
      );
    } finally {
      connection.release();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Webhooks] Error in subscription.created:", error);
    return NextResponse.json({ error: "Failed to process subscription.created" }, { status: 500 });
  }
}

async function handleSubscriptionUpdated(payload: any, tenantId?: string) {
  if (!tenantId) {
    console.warn("[Webhooks] No tenant_id in custom_data for subscription.updated");
    return NextResponse.json({ success: true, message: "Ignored: No tenantId" });
  }

  try {
    const status = payload.data?.status;
    const items = payload.data?.items || [];
    const trialEndsAt = payload.data?.trial_ends_at;

    // Map first item price to tier (might be upgrade/downgrade)
    let tier: TierName = "Essential";
    if (items.length > 0) {
      const priceId = items[0].price?.id;
      const mappedTier = priceIdToTier(priceId);
      if (mappedTier) {
        tier = mappedTier;
      }
    }

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
    try {
      await connection.execute(
        `UPDATE Tenants 
         SET subscription_status = ?, tier = ?, trial_ends_at = ?
         WHERE tenant_id = ?`,
        [internalStatus, tier, trialEndsAt ? new Date(trialEndsAt) : null, tenantId]
      );
      console.log(
        `[Webhooks] Subscription updated for tenant ${tenantId}: tier=${tier}, status=${internalStatus}`
      );
    } finally {
      connection.release();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
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
    const connection = await pool.getConnection();
    try {
      await connection.execute(
        `UPDATE Tenants 
         SET subscription_status = 'CANCELED'
         WHERE tenant_id = ?`,
        [tenantId]
      );
      console.log(`[Webhooks] Subscription canceled for tenant ${tenantId}`);
    } finally {
      connection.release();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
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
      await connection.execute(
        `UPDATE Tenants 
         SET subscription_status = 'PAST_DUE'
         WHERE tenant_id = ?`,
        [tenantId]
      );
      console.log(`[Webhooks] Subscription past due for tenant ${tenantId}`);
    } finally {
      connection.release();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
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
    } finally {
      connection.release();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Webhooks] Error in transaction.completed:", error);
    return NextResponse.json({ error: "Failed to process transaction.completed" }, { status: 500 });
  }
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
  } catch (error: any) {
    console.error("[Webhooks] Error in transaction.payment_failed:", error);
    return NextResponse.json({ error: "Failed to process transaction.payment_failed" }, { status: 500 });
  }
}


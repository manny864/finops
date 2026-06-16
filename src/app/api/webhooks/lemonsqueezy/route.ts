import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getPaymentConfig } from "@/lib/paymentConfig";
import pool from "@/modules/storage/db";

export async function POST(request: NextRequest) {
  try {
    const config = getPaymentConfig();
    const secret = config.LEMON_SQUEEZY_WEBHOOK_SECRET || process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    
    if (!secret) {
        console.warn("[Webhooks] LEMON_SQUEEZY_WEBHOOK_SECRET is not set. Webhooks will not be verified securely.");
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-signature") || "";

    if (secret) {
        const hmac = crypto.createHmac("sha256", secret);
        const digest = Buffer.from(hmac.update(rawBody).digest("hex"), "utf8");
        const signatureBuffer = Buffer.from(signature, "utf8");

        if (digest.length !== signatureBuffer.length || !crypto.timingSafeEqual(digest, signatureBuffer)) {
            console.error("[Webhooks] Firma inválida.");
            return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
        }
    }

    const payload = JSON.parse(rawBody);
    const eventName = payload.meta.event_name;
    const customData = payload.meta.custom_data || {};
    const tenantId = customData.tenant_id;

    if (!tenantId) {
        console.warn("[Webhooks] No tenantId found in custom_data. Cannot assign subscription.");
        return NextResponse.json({ success: true, message: "Ignored: No tenantId" });
    }

    console.log(`[Webhooks] Processing event ${eventName} for Tenant ID: ${tenantId}`);

    const subscriptionData = payload.data.attributes;
    const renewalDate = subscriptionData.renews_at || subscriptionData.ends_at || subscriptionData.trial_ends_at || null;
    let newStatus = 'ACTIVE';

    if (eventName === "subscription_created" || eventName === "subscription_updated") {
       console.log(`[Webhooks] Tenant ${tenantId} subscription status is now: ${subscriptionData.status}`);
       if (subscriptionData.status === 'active' || subscriptionData.status === 'trialing') {
           newStatus = 'ACTIVE';
       } else {
           newStatus = 'EXPIRED';
       }
    } else if (eventName === "subscription_cancelled" || eventName === "subscription_expired") {
       console.log(`[Webhooks] Tenant ${tenantId} subscription ended.`);
       newStatus = 'EXPIRED';
    }

    // Determine tier based on variant ID if possible (for simplicity we just maintain or assume from the event)
    // Actually the user just asked to update status and renewal date.
    
    const connection = await pool.getConnection();
    try {
        await connection.execute(
            `UPDATE Tenants 
             SET subscription_status = ?, trial_ends_at = ? 
             WHERE tenant_id = ?`,
            [newStatus, renewalDate, tenantId]
        );
        console.log(`[Webhooks] Successfully updated Tenant ${tenantId} to status ${newStatus}`);
    } catch (e: any) {
        console.error("[Webhooks] Database update error:", e);
        return NextResponse.json({ error: "Failed to update DB" }, { status: 500 });
    } finally {
        connection.release();
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("[Webhooks] Error interno:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

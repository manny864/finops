import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/modules/storage/db";

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    
    if (!secret) {
        console.warn("[Webhooks] PADDLE_WEBHOOK_SECRET is not set. Webhooks will not be verified securely.");
    }

    const rawBody = await request.text();
    const signatureHeader = request.headers.get("paddle-signature") || "";

    if (secret) {
        // paddle-signature format: ts=1671552777;h1=1a2b3c...
        const parts = signatureHeader.split(';');
        const tsPart = parts.find(p => p.startsWith('ts='));
        const h1Part = parts.find(p => p.startsWith('h1='));

        if (!tsPart || !h1Part) {
            return NextResponse.json({ error: "Invalid signature format" }, { status: 401 });
        }

        const ts = tsPart.split('=')[1];
        const h1 = h1Part.split('=')[1];

        const payloadToSign = `${ts}:${rawBody}`;
        const hmac = crypto.createHmac("sha256", secret);
        const digest = hmac.update(payloadToSign).digest("hex");

        if (digest !== h1) {
            console.error("[Webhooks] Firma inválida para Paddle.");
            return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
        }
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.event_type;
    const tenantId = payload.data?.custom_data?.tenant_id;
    const status = payload.data?.status;

    if (!tenantId) {
        console.warn("[Webhooks] No tenant_id found in custom_data. Cannot assign subscription.");
        return NextResponse.json({ success: true, message: "Ignored: No tenantId" });
    }

    console.log(`[Webhooks] Processing event ${eventType} for Tenant ID: ${tenantId}`);

    let newStatus = 'ACTIVE';

    if (eventType === "subscription.created" || eventType === "subscription.updated") {
       console.log(`[Webhooks] Tenant ${tenantId} subscription status is now: ${status}`);
       if (status === 'trialing') {
           newStatus = 'TRIAL';
       } else if (status === 'active') {
           newStatus = 'ACTIVE';
       } else {
           newStatus = 'CANCELED';
       }
    } else if (eventType === "subscription.canceled") {
       console.log(`[Webhooks] Tenant ${tenantId} subscription canceled.`);
       newStatus = 'CANCELED';
    } else {
       // For other events, we can just return success
       return NextResponse.json({ success: true });
    }
    
    const connection = await pool.getConnection();
    try {
        await connection.execute(
            `UPDATE Tenants 
             SET subscription_status = ? 
             WHERE tenant_id = ?`,
            [newStatus, tenantId]
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

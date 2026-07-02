import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { tierToPriceId, getPaddleBaseUrl } from "@/lib/paddleTierMap";

type ProrationType = "prorated_immediately" | "prorated_next_billing_period" | "do_not_bill";

export async function PATCH(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ["OWNER"]);

    const body = await request.json();
    const { newTier, billing, prorationBillingMode } = body;

    // Validate inputs
    if (!newTier || !["Essential", "Professional", "Business"].includes(newTier)) {
      return NextResponse.json({ error: "newTier inválido" }, { status: 400 });
    }

    if (!billing || !["monthly", "yearly"].includes(billing)) {
      return NextResponse.json({ error: "billing debe ser 'monthly' o 'yearly'" }, { status: 400 });
    }

    const prorationMode: ProrationType = prorationBillingMode || "prorated_immediately";
    if (!["prorated_immediately", "prorated_next_billing_period", "do_not_bill"].includes(prorationMode)) {
      return NextResponse.json({ error: "prorationBillingMode inválido" }, { status: 400 });
    }

    // Get tenant's current subscription
    const [tenantRows]: any = await pool.query(
      "SELECT paddle_subscription_id FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (!Array.isArray(tenantRows) || !tenantRows[0]?.paddle_subscription_id) {
      return NextResponse.json({ error: "Tenant no tiene suscripción activa" }, { status: 404 });
    }

    const subscriptionId = tenantRows[0].paddle_subscription_id;
    const newPriceId = tierToPriceId(newTier, billing);

    if (!newPriceId) {
      return NextResponse.json({ error: "No se pudo encontrar el ID de precio para el plan seleccionado" }, { status: 400 });
    }

    const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
    if (!PADDLE_API_KEY) {
      console.warn("[Paddle] Missing API key. Skipping update.");
      return NextResponse.json({ error: "Configuración de Paddle no disponible" }, { status: 500 });
    }

    const baseUrl = getPaddleBaseUrl();
    const updateBody = {
      items: [{ price_id: newPriceId, quantity: 1 }],
      proration_billing_mode: prorationMode,
    };

    const paddleRes = await fetch(`${baseUrl}/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${PADDLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateBody),
    });

    if (!paddleRes.ok) {
      const error = await paddleRes.json();
      console.error("[Paddle] Update subscription error:", error);
      return NextResponse.json({ error: "Fallo al actualizar suscripción en Paddle" }, { status: 502 });
    }

    const paddleData = await paddleRes.json();
    const nextTransaction = paddleData.data?.next_transaction;

    // Don't update DB here - let the webhook handle it for single source of truth
    console.log(`[Billing] Subscription update initiated for tenant ${tenantId} to tier ${newTier}`);

    return NextResponse.json({
      success: true,
      message: "Suscripción actualizada correctamente",
      proration: nextTransaction
        ? {
            amount: nextTransaction.details?.totals?.total,
            currency: nextTransaction.currency_code,
            effectiveDate: nextTransaction.billed_at,
          }
        : null,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[Billing] PATCH /subscription error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ["OWNER"]);

    const body = await request.json();
    const { effective } = body;

    const effectiveMode = effective || "immediately";
    if (!["immediately", "next_billing_period"].includes(effectiveMode)) {
      return NextResponse.json({ error: "effective debe ser 'immediately' o 'next_billing_period'" }, { status: 400 });
    }

    // Get tenant's subscription
    const [tenantRows]: any = await pool.query(
      "SELECT paddle_subscription_id FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (!Array.isArray(tenantRows) || !tenantRows[0]?.paddle_subscription_id) {
      return NextResponse.json({ error: "Tenant no tiene suscripción activa" }, { status: 404 });
    }

    const subscriptionId = tenantRows[0].paddle_subscription_id;
    const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

    if (!PADDLE_API_KEY) {
      console.warn("[Paddle] Missing API key. Mocking cancellation.");
      await pool.query("UPDATE Tenants SET subscription_status = 'CANCELED' WHERE tenant_id = ?", [tenantId]);
      return NextResponse.json({ success: true, message: "Suscripción cancelada" });
    }

    const baseUrl = getPaddleBaseUrl();
    const paddleRes = await fetch(`${baseUrl}/subscriptions/${subscriptionId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PADDLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ effective_from: effectiveMode === "immediately" ? "immediately" : "next_billing_period" }),
    });

    if (!paddleRes.ok) {
      const error = await paddleRes.json();
      console.error("[Paddle] Cancel subscription error:", error);
      return NextResponse.json({ error: "Fallo al cancelar suscripción en Paddle" }, { status: 502 });
    }

    // Don't update DB here - let webhook handle it
    console.log(`[Billing] Subscription cancellation initiated for tenant ${tenantId}`);

    return NextResponse.json({
      success: true,
      message: "Suscripción cancelada correctamente",
    });
  } catch (error: any) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[Billing] DELETE /subscription error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

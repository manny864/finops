import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { tierToPriceId, getPaddleBaseUrl } from "@/lib/paddleTierMap";

// RBAC: sólo OWNER puede previsualizar/aplicar cambios de plan (mismo scope que PATCH /subscription).
type ProrationType = "prorated_immediately" | "prorated_next_billing_period" | "do_not_bill";

/**
 * POST /api/billing/subscription/preview
 * Previsualiza el prorrateo real (cargo por upgrade / crédito por downgrade) que
 * Paddle calcularía ANTES de aplicar el cambio, sin modificar la suscripción.
 * Internamente llama a `PATCH /subscriptions/{id}/preview` (Paddle Billing).
 */
export async function POST(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ["Admin"]);

    const body = await request.json();
    const { newTier, billing, prorationBillingMode } = body;

    // Validate inputs (idéntico a PATCH /subscription)
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
      return NextResponse.json(
        { error: "No se pudo encontrar el ID de precio para el plan seleccionado" },
        { status: 400 }
      );
    }

    const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
    if (!PADDLE_API_KEY) {
      // Sin credenciales de Paddle (dev/local): el preview no está disponible,
      // pero permitimos que la UI ofrezca aplicar el cambio con prorrateo estándar.
      console.warn("[Paddle] Missing API key. Preview no disponible.");
      return NextResponse.json({ success: true, previewAvailable: false });
    }

    const baseUrl = getPaddleBaseUrl();
    const previewBody = {
      items: [{ price_id: newPriceId, quantity: 1 }],
      proration_billing_mode: prorationMode,
    };

    const paddleRes = await fetch(`${baseUrl}/subscriptions/${subscriptionId}/preview`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${PADDLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(previewBody),
    });

    if (!paddleRes.ok) {
      const err: any = await paddleRes.json().catch(() => ({}));
      console.error("[Paddle] Preview subscription error:", paddleRes.status, err);
      // Propagamos el detalle de Paddle (sin secretos) para que el usuario sepa
      // POR QUÉ falla, en vez de un 502 mudo. Causa típica: la suscripción
      // pertenece a otro entorno Paddle (sandbox vs prod) o ya no está activa.
      const detail = err?.error?.detail || err?.error?.code;
      return NextResponse.json(
        {
          error: detail
            ? `No se pudo previsualizar el cambio en Paddle: ${detail}`
            : "No se pudo previsualizar el cambio en Paddle. Verificá que la suscripción esté activa y pertenezca al entorno configurado.",
        },
        { status: 502 }
      );
    }

    const paddleData = await paddleRes.json();
    const data = paddleData.data ?? {};

    const summary = data.update_summary ?? null;
    const immediate = data.immediate_transaction ?? null;
    const next = data.next_transaction ?? null;
    const recurring = data.recurring_transaction_details ?? null;
    const currencyCode: string = data.currency_code ?? summary?.result?.currency_code ?? "USD";

    // Montos en unidad menor (centavos) como string; el formateo/display se hace en el cliente.
    const resultAction: "charge" | "credit" | "none" =
      summary?.result?.amount && summary.result.amount !== "0" ? summary.result.action : "none";

    return NextResponse.json({
      success: true,
      previewAvailable: true,
      currencyCode,
      result: {
        action: resultAction,
        amount: summary?.result?.amount ?? "0",
      },
      credit: summary?.credit?.amount ?? "0",
      charge: summary?.charge?.amount ?? "0",
      immediateTotal: immediate?.details?.totals?.grand_total ?? null,
      nextBillTotal: next?.details?.totals?.grand_total ?? null,
      nextBillDate: next?.billing_period?.starts_at ?? null,
      recurringTotal: recurring?.totals?.total ?? null,
    });
  } catch (error: any) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[Billing] POST /subscription/preview error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";

/**
 * GET /api/billing/plan?tenantId=...
 *
 * Devuelve la información del PLAN del tenant leída directamente de `Tenants`
 * (tier, estado de suscripción, fin de trial, id de Paddle, contexto de
 * marketplace). NO llama a Paddle — es la fuente para el bloque "Plan Actual"
 * de la página de Facturación.
 *
 * Antes, la UI pedía `GET /api/billing` esperando este shape, pero ese endpoint
 * devuelve la URL de actualización de pago de Paddle (y 404 si no hay
 * paddle_subscription_id), dejando Tier/Estado en "N/A" y el bloque de pago
 * deshabilitado. Este endpoint corrige esa confusión de responsabilidades.
 *
 * RBAC: OWNER (mismo scope que el resto de /api/billing/*).
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = new URL(request.url).searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ["OWNER"]);

    const [rows]: any = await pool.query(
      `SELECT tier, subscription_status, trial_ends_at, paddle_subscription_id,
              marketplace_source, marketplace_subscription_id, marketplace_plan_id
         FROM Tenants
        WHERE tenant_id = ?
        LIMIT 1`,
      [tenantId]
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
    }

    const t = rows[0];
    return NextResponse.json({
      tier: t.tier || null,
      status: t.subscription_status || null,
      trialEndsAt: t.trial_ends_at || null,
      paddleSubscriptionId: t.paddle_subscription_id || null,
      marketplaceSource: t.marketplace_source || "direct",
      marketplaceSubscriptionId: t.marketplace_subscription_id || null,
      marketplacePlanId: t.marketplace_plan_id || null,
      // Enterprise usa pricing negociado: la UI muestra "contactar ventas"
      // en lugar del flujo de cambio de plan de Paddle.
      isEnterprise: t.tier === "Enterprise",
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Billing API /plan GET Error]", error);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}

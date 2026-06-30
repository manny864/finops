import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/requestAuth";
import { tierToPriceId } from "@/lib/paddleTierMap";
import pool from "@/modules/storage/db";

export async function POST(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    const body = await request.json();
    const { tier, billing } = body;

    if (!tier || !["Essential", "Professional", "Business"].includes(tier)) {
      return NextResponse.json({ error: "tier inválido" }, { status: 400 });
    }

    if (!billing || !["monthly", "yearly"].includes(billing)) {
      return NextResponse.json({ error: "billing debe ser 'monthly' o 'yearly'" }, { status: 400 });
    }

    // Check if tenant already has a subscription
    const [tenantRows]: any = await pool.query(
      "SELECT paddle_subscription_id FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (Array.isArray(tenantRows) && tenantRows[0]?.paddle_subscription_id) {
      return NextResponse.json(
        { error: "Tenant ya tiene una suscripción activa. Usa el endpoint de upgrade para cambiar de plan." },
        { status: 400 }
      );
    }

    const priceId = tierToPriceId(tier as any, billing);
    if (!priceId) {
      return NextResponse.json({ error: "No se encontró el ID del plan" }, { status: 400 });
    }

    // Return checkout data for client-side Paddle.js integration
    // The client will handle opening the overlay via paddle.Checkout.open()
    return NextResponse.json({
      success: true,
      priceId,
      customData: { tenant_id: tenantId },
      message: "Use this data with paddle.Checkout.open() to open the checkout overlay",
    });
  } catch (error: any) {
    console.error("[Checkout] Error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}


import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { getPaddleBaseUrl } from "@/lib/paddleTierMap";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireTenantRole(request, new URL(request.url).searchParams.get("tenantId") || "", ["Admin"]);
    const tenantId = identity.tenantId;

    const [rows]: any = await pool.query(
      "SELECT paddle_subscription_id FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (!rows || rows.length === 0 || !rows[0].paddle_subscription_id) {
      return NextResponse.json({ error: "No se encontró suscripción activa." }, { status: 404 });
    }

    const subscriptionId = rows[0].paddle_subscription_id;
    const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

    if (!PADDLE_API_KEY) {
      console.warn("[Paddle] Missing API key. Mocking cancellation.");
      await pool.query(
        "UPDATE Tenants SET subscription_status = 'CANCELED' WHERE tenant_id = ?",
        [tenantId]
      );
      return NextResponse.json({ success: true });
    }

    const baseUrl = getPaddleBaseUrl();
    const res = await fetch(`${baseUrl}/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PADDLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ effective_from: 'immediately' })
    });

    if (!res.ok) {
      const errorData = await res.json();
      console.error("[Paddle] Cancel Error:", errorData);
      return NextResponse.json({ error: "Fallo en Paddle API al cancelar." }, { status: 500 });
    }

    await pool.query(
      "UPDATE Tenants SET subscription_status = 'CANCELED' WHERE tenant_id = ?",
      [tenantId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[Billing API POST Error]", error);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const tenantId = searchParams.get("tenantId");
    
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    const [rows]: any = await pool.query(
      "SELECT paddle_subscription_id FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (!rows || rows.length === 0 || !rows[0].paddle_subscription_id) {
      return NextResponse.json({ error: "No se encontró suscripción activa." }, { status: 404 });
    }

    const subscriptionId = rows[0].paddle_subscription_id;
    const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

    if (!PADDLE_API_KEY) {
      console.warn("[Paddle] Missing API key. Mocking payment update URL.");
      return NextResponse.json({ success: true, url: "https://mock.paddle.com/update-payment" });
    }

    const baseUrl = getPaddleBaseUrl();
    const res = await fetch(`${baseUrl}/subscriptions/${subscriptionId}/update-payment-method-transaction`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PADDLE_API_KEY}`
      }
    });

    if (!res.ok) {
      const errorData = await res.json();
      console.error("[Paddle] Update Payment Method Error:", errorData);
      return NextResponse.json({ error: "Fallo en Paddle API al obtener URL de pago." }, { status: 500 });
    }

    const responseData = await res.json();
    const url = responseData.data?.checkout?.url;

    if (!url) {
        return NextResponse.json({ error: "No se obtuvo URL de checkout." }, { status: 500 });
    }

    return NextResponse.json({ success: true, url });
  } catch (error: any) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[Billing API GET Error]", error);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 });
    }

    const tenantId = decoded.tid;

    const [rows]: any = await pool.query(
      "SELECT subscription_id FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (!rows || rows.length === 0 || !rows[0].subscription_id) {
      return NextResponse.json({ error: "No se encontró suscripción activa." }, { status: 404 });
    }

    const subscriptionId = rows[0].subscription_id;
    const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

    if (!PADDLE_API_KEY) {
      console.warn("[Paddle] Missing API key. Mocking cancellation.");
      await pool.query(
        "UPDATE Tenants SET subscription_status = 'CANCELED' WHERE tenant_id = ?",
        [tenantId]
      );
      return NextResponse.json({ success: true });
    }

    const res = await fetch(`https://api.paddle.com/subscriptions/${subscriptionId}/cancel`, {
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
    console.error("[Billing API POST Error]", error);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 });
    }

    const tenantId = decoded.tid;

    const [rows]: any = await pool.query(
      "SELECT subscription_id FROM Tenants WHERE tenant_id = ?",
      [tenantId]
    );

    if (!rows || rows.length === 0 || !rows[0].subscription_id) {
      return NextResponse.json({ error: "No se encontró suscripción activa." }, { status: 404 });
    }

    const subscriptionId = rows[0].subscription_id;
    const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

    if (!PADDLE_API_KEY) {
      console.warn("[Paddle] Missing API key. Mocking payment update URL.");
      return NextResponse.json({ success: true, url: "https://mock.paddle.com/update-payment" });
    }

    const res = await fetch(`https://api.paddle.com/subscriptions/${subscriptionId}/update-payment-method-transaction`, {
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
    console.error("[Billing API GET Error]", error);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getPaymentConfig } from "@/lib/paymentConfig";

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
    const body = await request.json();
    const { plan } = body;

    // TODO: Implement Paddle Checkout integration
    // With Paddle Billing, checkouts are usually opened client-side via paddle.Checkout.open()
    // or by creating a transaction on the server and returning the checkout URL.
    
    const config = getPaymentConfig();
    let priceId = config.PADDLE_PRO_PRICE_ID || process.env.PADDLE_PRO_PRICE_ID;
    if (plan === 'business') priceId = config.PADDLE_ENTERPRISE_PRICE_ID || process.env.PADDLE_ENTERPRISE_PRICE_ID;

    // For now, return a mock URL or return an error indicating Paddle migration is pending for new checkouts
    console.warn("[Checkout] Paddle checkout endpoint not fully implemented. Returning mock checkout URL.");
    return NextResponse.json({ 
        success: true, 
        checkoutUrl: `https://mock.paddle.com/checkout?tenantId=${tenantId}&plan=${plan}` 
    });

  } catch (error: any) {
    console.error("Checkout error:", error);
    return NextResponse.json({ error: "Fallo interno del servidor" }, { status: 500 });
  }
}

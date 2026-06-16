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

    // TODO: Usar el SDK de Lemon Squeezy o Fetch a la API
    // Para simplificar, hacemos un request a la API REST directamente.
    
    const config = getPaymentConfig();
    const LEMON_SQUEEZY_API_KEY = config.LEMON_SQUEEZY_API_KEY || process.env.LEMON_SQUEEZY_API_KEY;
    const STORE_ID = config.LEMON_SQUEEZY_STORE_ID || process.env.LEMON_SQUEEZY_STORE_ID;
    
    let variantId = config.LEMON_SQUEEZY_PRO_VARIANT_ID || process.env.LEMON_SQUEEZY_PRO_VARIANT_ID;
    if (plan === 'business') variantId = config.LEMON_SQUEEZY_BUSINESS_VARIANT_ID || process.env.LEMON_SQUEEZY_BUSINESS_VARIANT_ID;

    if (!LEMON_SQUEEZY_API_KEY || !STORE_ID || !variantId) {
       // Mock Mode for development if env variables are not set
       console.warn("[Lemon Squeezy] Missing API keys. Returning mock checkout URL.");
       return NextResponse.json({ 
           success: true, 
           checkoutUrl: `https://mock.lemonsqueezy.com/checkout?tenantId=${tenantId}&plan=${plan}` 
       });
    }

    const res = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': `Bearer ${LEMON_SQUEEZY_API_KEY}`
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: {
              custom: {
                tenant_id: tenantId
              }
            }
          },
          relationships: {
            store: {
              data: {
                type: "stores",
                id: STORE_ID.toString()
              }
            },
            variant: {
              data: {
                type: "variants",
                id: variantId.toString()
              }
            }
          }
        }
      })
    });

    const responseData = await res.json();

    if (!res.ok) {
        console.error("Error creating checkout:", responseData);
        return NextResponse.json({ error: "No se pudo crear la sesión de pago." }, { status: 500 });
    }

    const checkoutUrl = responseData.data?.attributes?.url;

    return NextResponse.json({ success: true, checkoutUrl });

  } catch (error: any) {
    console.error("[Checkout API Error]", error);
    return NextResponse.json({ error: "Fallo en la API de Checkout" }, { status: 500 });
  }
}

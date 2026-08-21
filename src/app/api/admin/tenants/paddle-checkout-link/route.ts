import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { getPaddleBaseUrl } from "@/lib/paddleTierMap";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

/**
 * POST /api/admin/tenants/paddle-checkout-link
 *
 * Genera un link de checkout hosteado por Paddle para un deal Enterprise
 * (Price custom creado a mano en el dashboard de Paddle para ese cliente
 * puntual — ver instrucciones en admin/tenants/page.tsx). A diferencia de
 * abrir el checkout overlay desde acá, esto devuelve una URL que se le
 * puede mandar al cliente para que la complete cuando quiera, eligiendo su
 * propio medio de pago — no requiere que el superadmin la abra en su sesión.
 *
 * `custom_data: { tenant_id, tier }` viaja en la transacción para que el
 * webhook (/api/webhooks/paddle) sepa qué tenant/tier activar al completarse
 * el pago, sin depender del mapeo fijo de priceId (que solo cubre los planes
 * self-service).
 *
 * Super-admin only.
 */
export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        const body = await request.json();
        const { tenantId, tier, priceId } = body;

        if (!tenantId || !tier || !priceId) {
            return NextResponse.json({ error: "Faltan campos requeridos: tenantId, tier, priceId" }, { status: 400 });
        }

        const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
        if (!PADDLE_API_KEY) {
            return NextResponse.json({ error: "Configuración de Paddle no disponible (falta PADDLE_API_KEY)" }, { status: 500 });
        }

        const baseUrl = getPaddleBaseUrl();
        const paddleRes = await fetch(`${baseUrl}/transactions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${PADDLE_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                items: [{ price_id: priceId, quantity: 1 }],
                collection_mode: "automatic",
                custom_data: { tenant_id: tenantId, tier },
            }),
        });

        if (!paddleRes.ok) {
            const error: any = await paddleRes.json().catch(() => ({}));
            console.error("[Paddle] Create transaction error:", paddleRes.status, error);
            const detail = error?.error?.detail || error?.error?.code;
            return NextResponse.json(
                { error: detail ? `Paddle rechazó la transacción: ${detail}` : "No se pudo crear la transacción en Paddle. Verificá que el Price ID exista en el entorno configurado." },
                { status: 502 }
            );
        }

        const paddleData = await paddleRes.json();
        const checkoutUrl = paddleData.data?.checkout?.url;

        if (!checkoutUrl) {
            console.error("[Paddle] Transaction created without checkout.url:", JSON.stringify(paddleData.data));
            return NextResponse.json({ error: "Paddle no devolvió un link de checkout para esta transacción." }, { status: 502 });
        }

        return NextResponse.json({ success: true, checkoutUrl, transactionId: paddleData.data?.id });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("[Admin Tenants] Error creating Paddle checkout link:", error);
        return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
    }
}

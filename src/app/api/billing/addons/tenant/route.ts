import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { normalizeTier, SUBSCRIPTION_LIMITS, USER_LIMITS } from "@/lib/tierLogic";
import { getPaddleBaseUrl } from "@/lib/paddleTierMap";

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const body = await request.json();
        const { tenantId, returnUrl } = body;

        if (!tenantId) {
            return NextResponse.json({ error: "Falta el identificador del tenant." }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [rows]: any = await pool.query(
            `SELECT tier, subscription_status, company_name, paddle_subscription_id, additional_tenant_slots
             FROM Tenants
             WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );

        if (!Array.isArray(rows) || rows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        const tenant = rows[0];
        const tier = normalizeTier(tenant.tier) || "Professional";

        // Precio sugerido o ID de producto adicional en Paddle (personalizable por env o custom)
        const customPriceId = process.env.PADDLE_ADDITIONAL_TENANT_PRICE_ID;
        const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

        if (!PADDLE_API_KEY || !customPriceId) {
            // Modo estándar / manual / self-service con link comercial o fallback
            return NextResponse.json({
                success: true,
                mode: "self_service",
                contractTier: tier,
                subscriptionCapacity: SUBSCRIPTION_LIMITS[tier] ?? 2,
                userCapacity: USER_LIMITS[tier] ?? 3,
                message: "Slot disponible para agregar un nuevo tenant a tu contrato.",
                canAddDirectly: true,
            });
        }

        // Si hay integración con Paddle Transactions API
        const baseUrl = getPaddleBaseUrl();
        const paddleRes = await fetch(`${baseUrl}/transactions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${PADDLE_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                items: [{ price_id: customPriceId, quantity: 1 }],
                custom_data: {
                    tenant_id: tenantId,
                    addon_type: "additional_tenant_slot",
                    tier,
                },
                checkout: {
                    url: returnUrl || undefined,
                },
            }),
        });

        const paddleJson = await paddleRes.json();
        const checkoutUrl = paddleJson?.data?.checkout?.url || paddleJson?.data?.url;

        return NextResponse.json({
            success: true,
            checkoutUrl,
            contractTier: tier,
            subscriptionCapacity: SUBSCRIPTION_LIMITS[tier] ?? 2,
            userCapacity: USER_LIMITS[tier] ?? 3,
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("API POST /api/billing/addons/tenant error:", error);
        return NextResponse.json({ error: "Fallo al generar orden de tenant adicional." }, { status: 500 });
    }
}

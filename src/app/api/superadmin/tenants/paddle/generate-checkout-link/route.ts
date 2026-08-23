/**
 * Endpoint para generar enlaces de checkout transaccionales de Paddle Billing.
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { generatePaddleCheckoutLink } from "@/services/superAdminTenants.service";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const body = await request.json().catch(() => ({}));
        const { tenantId, paddlePriceId } = body;

        if (!tenantId || !paddlePriceId) {
            return NextResponse.json(
                { success: false, error: "tenantId y paddlePriceId son requeridos." },
                { status: 400 }
            );
        }

        const result = await generatePaddleCheckoutLink({ tenantId, paddlePriceId }, isMock);
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

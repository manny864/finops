/**
 * Endpoint para Probar Normalización de Unidades FOCUS 1.1 en vivo (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { testNormalization } from "@/services/pricingUnitsNormalizer.service";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const body = await request.json().catch(() => ({}));
        const { unitOfMeasure, quantity } = body;

        const result = await testNormalization({
            unitOfMeasure: unitOfMeasure || "1 Unit",
            quantity: Number(quantity) || 1,
        });

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

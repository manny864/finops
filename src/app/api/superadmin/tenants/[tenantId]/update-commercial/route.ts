/**
 * Endpoint para actualizar los datos del deal comercial (vendedor y comisión).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { updateCommercialDeal } from "@/services/superAdminTenants.service";

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ tenantId: string }> }
) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const { tenantId } = await context.params;
        const body = await request.json().catch(() => ({}));

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "tenantId es requerido." }, { status: 400 });
        }

        const result = await updateCommercialDeal(
            {
                tenantId,
                salesRepName: body.salesRepName || "Directo",
                salesCommissionPercent: Number(body.salesCommissionPercent) || 0,
                // `soldAt` NO se acepta por esta ruta a proposito: la fecha de
                // venta es un hecho del pasado y moverla recalcularia comisiones
                // ya devengadas. Corregirla es una operacion aparte y auditada.
                contractTerm: body.contractTerm === "annual" ? "annual" : "monthly",
            },
            isMock
        );

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

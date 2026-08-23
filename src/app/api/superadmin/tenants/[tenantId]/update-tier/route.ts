/**
 * Endpoint para actualizar el Tier o Estado de Suscripción de un tenant.
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { updateTenantTierAndStatus } from "@/services/superAdminTenants.service";

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

        if (!tenantId || !body.planTier) {
            return NextResponse.json(
                { success: false, error: "tenantId y planTier son requeridos." },
                { status: 400 }
            );
        }

        const result = await updateTenantTierAndStatus(
            {
                tenantId,
                planTier: body.planTier,
                subscriptionStatus: body.subscriptionStatus,
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

/**
 * Endpoint para crear un tenant manualmente con bypass de pasarela de pago y tier inicial.
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { createManualTenant } from "@/services/superAdminTenants.service";
import { CreateManualTenantPayload } from "@/types/superAdminTenants.types";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const body = (await request.json().catch(() => ({}))) as CreateManualTenantPayload;

        if (!body.entraTenantId || !body.organizationName) {
            return NextResponse.json(
                { success: false, error: "Entra Tenant ID y Nombre de Organización son requeridos." },
                { status: 400 }
            );
        }

        const result = await createManualTenant(body, isMock);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

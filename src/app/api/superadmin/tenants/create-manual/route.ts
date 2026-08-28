/**
 * Endpoint para crear un tenant manualmente con bypass de pasarela de pago y tier inicial.
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { createManualTenant } from "@/services/superAdminTenants.service";
import {
    CreateManualTenantPayload,
    ManualTrialDays,
    MANUAL_TRIAL_DAY_OPTIONS,
} from "@/types/superAdminTenants.types";

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

        // Se rechaza en vez de caer a "sin trial": un plazo mal mandado tiene que
        // fallar visible, no crear un tenant ACTIVE de por vida sin que nadie mire.
        if (body.trialDays && !MANUAL_TRIAL_DAY_OPTIONS.includes(body.trialDays as ManualTrialDays)) {
            return NextResponse.json(
                {
                    success: false,
                    error: `Días de trial inválidos. Valores permitidos: ${MANUAL_TRIAL_DAY_OPTIONS.join(", ")}.`,
                },
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

import { NextRequest, NextResponse } from "next/server";
import { teardownTenant } from "@/services/tenantTeardownService";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { enforceMfaIfEnabled } from "@/lib/requireMfaChallenge";

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        let tenantId = searchParams.get('tenantId');

        // Fallback to body if not in URL
        if (!tenantId) {
            try {
                const body = await request.json();
                tenantId = body.tenantId;
            } catch {
                // Ignore json parse error if body is empty
            }
        }

        if (!tenantId) {
            return NextResponse.json({ error: "El parámetro tenantId es obligatorio." }, { status: 400 });
        }

        const identity = await requireSuperAdmin(request);

        // Operación sensible: exige MFA verificado si el super admin tiene 2FA activado.
        await enforceMfaIfEnabled(request, identity.email, identity.tenantId, "delete_tenant", { tenantId });

        // Execute teardown. El email queda sellado en ActionLogs como TENANT_PURGE:
        // esa bitácora ya no se borra con el tenant (migración 20260822-006).
        await teardownTenant(tenantId, identity.email);

        return NextResponse.json({ success: true, message: `Tenant ${tenantId} eliminado exitosamente.` });

    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error("Error en la ruta de eliminación de tenant:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

// Support POST method as well per requirements
export async function POST(request: NextRequest) {
    return DELETE(request);
}

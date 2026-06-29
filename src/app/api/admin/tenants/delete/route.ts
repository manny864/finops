import { NextRequest, NextResponse } from "next/server";
import { teardownTenant } from "@/services/tenantTeardownService";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        let tenantId = searchParams.get('tenantId');

        // Fallback to body if not in URL
        if (!tenantId) {
            try {
                const body = await request.json();
                tenantId = body.tenantId;
            } catch (e) {
                // Ignore json parse error if body is empty
            }
        }

        if (!tenantId) {
            return NextResponse.json({ error: "El parámetro tenantId es obligatorio." }, { status: 400 });
        }

        await requireSuperAdmin(request);

        // Execute teardown
        await teardownTenant(tenantId);

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

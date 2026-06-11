import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { teardownTenant } from "@/services/tenantTeardownService";

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

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado. Se requieren privilegios de Super Administrador." }, { status: 403 });
        }

        // Execute teardown
        await teardownTenant(tenantId);

        return NextResponse.json({ success: true, message: `Tenant ${tenantId} eliminado exitosamente.` });

    } catch (e: any) {
        console.error("Error en la ruta de eliminación de tenant:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}

// Support POST method as well per requirements
export async function POST(request: NextRequest) {
    return DELETE(request);
}

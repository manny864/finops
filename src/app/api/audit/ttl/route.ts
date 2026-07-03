import { NextRequest, NextResponse } from "next/server";
import { findExpiredResources } from "@/services/ttlService";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";


export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }



        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const expiredResources = await findExpiredResources(tenantId);
        
        return NextResponse.json({ expiredResources });

    } catch (e: unknown) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        const message = e instanceof Error ? e.message : String(e);
        const lowered = message.toLowerCase();
        const isRecoverable =
            lowered.includes("tenant no registrado en la base de datos") ||
            lowered.includes("faltan credenciales") ||
            lowered.includes("authorization") ||
            lowered.includes("accessdenied") ||
            lowered.includes("no hay suscripciones");

        if (isRecoverable) {
            return NextResponse.json({
                expiredResources: [],
                degraded: true,
                message: "No se pudieron evaluar recursos TTL por credenciales/permisos del tenant."
            });
        }

        const errorObj = (typeof e === "object" && e !== null)
            ? (e as { message?: string; code?: string; name?: string; statusCode?: number; status?: number })
            : {};
        console.error(`[TTL] ERROR capturado:`, {
            name: errorObj.name,
            code: errorObj.code,
            statusCode: errorObj.statusCode || errorObj.status,
            message: errorObj.message || message,
        });

        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

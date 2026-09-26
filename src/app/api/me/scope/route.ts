/**
 * MEJ-38 — GET /api/me/scope: el alcance asignado a quien pregunta.
 *
 * Lo necesitan dos piezas del shell: el Sidebar, para no ofrecer pantallas que
 * la API le va a negar, y el selector de Perspective, para quedar fijo en el
 * grupo asignado en vez de dejar elegir otro y devolver 403.
 *
 * Devuelve el alcance del USUARIO AUTENTICADO y de nadie más — no acepta un
 * email por parámetro, justamente para que no sirva de directorio.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { PAGINAS_CON_ALCANCE } from "@/lib/scopeAwareRoutes";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true, scope: null });

        const identidad = await requireTenantAccess(request, tenantId);
        return NextResponse.json({
            success: true,
            scope: identidad.alcance ?? null,
            pages: identidad.alcance ? PAGINAS_CON_ALCANCE : null,
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[me/scope] GET:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

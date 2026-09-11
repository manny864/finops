/**
 * GET /api/search?tenantId=&q= — Buscador de contenido del SaaS.
 *
 * RBAC: `requireTenantAccess`. Es el punto donde se decide que un usuario sólo
 * puede buscar dentro de SU entorno; sin este guard el endpoint seria la forma
 * mas comoda de leer nombres de recursos, servicios y reglas de otro cliente.
 * El filtro `tenant_id` de cada consulta es la segunda mitad del mismo control.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { searchTenantContent, type GlobalSearchResponse } from "@/services/globalSearch.service";
import { getMockSearchResults } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const q = (searchParams.get("q") || "").trim();

        if (!tenantId) {
            return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
        }
        // Un termino de una letra hace que cualquier LIKE devuelva medio tenant.
        if (q.length < 2) {
            return NextResponse.json({ results: [], sourceStatus: [] } satisfies GlobalSearchResponse);
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockSearchResults(q));
        }

        await requireTenantAccess(request, tenantId);

        return NextResponse.json(await searchTenantContent(tenantId, q));
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("[/api/search] error:", error);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

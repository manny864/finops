/**
 * GET /api/intelligence/cost-by-category — desglose jerárquico y resolutivo de costo por categoría FinOps
 * (Compute/Databases/Networking/Storage/AI & ML/Security/...).
 *
 * RBAC app: requireTenantAccess (tenant-scoped). Tier: Business (routeTiers).
 *
 * `getRealCategoryOverview` encadena, en serie, el inventario completo de ARG,
 * los costos por recurso de Cost Management, el mes amortizado entero y dos
 * consultas a MySQL. Era la unica ruta pesada de intelligence/ sin cache: cada
 * visita a la pantalla rehacia todo. Ahora va por SWR como las otras 67, con la
 * ventana de 30 min que usa el resto de la familia.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getRealCategoryOverview } from "@/services/categoryConsumptionService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const days = Math.max(1, Math.min(365, parseInt(searchParams.get("days") || "30", 10)));

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        // `days` entra en la clave: cambia el rango de la consulta y con el
        // mismo key devolveria el desglose del rango anterior.
        const overview = await getWithStaleWhileRevalidate(
            `cost-by-category:v1:${tenantId}:${days}`,
            () => getRealCategoryOverview(tenantId, days),
            1800,
            600
        );
        return NextResponse.json(overview);
    } catch (err: unknown) {
        console.error("[cost-by-category] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

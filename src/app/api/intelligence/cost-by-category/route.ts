/**
 * GET /api/intelligence/cost-by-category — desglose jerárquico y resolutivo de costo por categoría FinOps
 * (Compute/Databases/Networking/Storage/AI & ML/Security/...).
 *
 * RBAC app: requireTenantAccess (tenant-scoped). Tier: Business (routeTiers).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getRealCategoryOverview } from "@/services/categoryConsumptionService";

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

        const overview = await getRealCategoryOverview(tenantId, days);
        return NextResponse.json(overview);
    } catch (err: unknown) {
        console.error("[cost-by-category] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

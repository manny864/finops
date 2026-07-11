import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getM365Overview } from "@/modules/collectors/azure/m365UsersService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("m365_overview", tenantId));
        }

        // Cache 30 min: Graph reports (activity/MFA) se refrescan a diario y las
        // consultas de /users son pesadas — no tiene sentido recomputar por request.
        const data = await getWithStaleWhileRevalidate(
            `m365:overview:${tenantId}`,
            () => getM365Overview(tenantId),
            1800, 600
        );
        return NextResponse.json({ success: true, mock: false, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        const err = error as { status?: number; message?: string };
        if (err.status === 403) {
            return NextResponse.json({ error: "MISSING_GRAPH_PERMISSIONS", details: err.message }, { status: 403 });
        }
        console.error("[m365/overview] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

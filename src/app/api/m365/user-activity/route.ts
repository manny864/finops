import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getEnrichedUserActivity } from "@/services/m365UserActivity.service";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { respuestaAudienciaNoDelegada } from "@/lib/lighthouseAccess";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // CRITICAL: isMockTenant check BEFORE requireTenantAccess (directiva #1)
        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("m365_user_activity", tenantId));
        }

        await requireTenantAccess(request, tenantId);

        const data = await getWithStaleWhileRevalidate(
            `m365:useractivity:v2:${tenantId}`,
            () => getEnrichedUserActivity(tenantId),
            1800, 600
        );
        return NextResponse.json({ success: true, mock: false, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        const lighthouse = respuestaAudienciaNoDelegada(error);
        if (lighthouse) return lighthouse;
        const err = error as { status?: number; message?: string };
        if (err.status === 403) {
            return NextResponse.json({ error: "MISSING_GRAPH_PERMISSIONS", details: err.message }, { status: 403 });
        }
        console.error("[m365/user-activity] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

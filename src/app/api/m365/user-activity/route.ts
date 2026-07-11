import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getUserActivity } from "@/modules/collectors/azure/m365UsersService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("m365_user_activity", tenantId));
        }

        const data = await getWithStaleWhileRevalidate(
            `m365:useractivity:${tenantId}`,
            () => getUserActivity(tenantId),
            1800, 600
        );
        return NextResponse.json({ success: true, mock: false, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        const err = error as { status?: number; message?: string };
        if (err.status === 403) {
            return NextResponse.json({ error: "MISSING_GRAPH_PERMISSIONS", details: err.message }, { status: 403 });
        }
        console.error("[m365/user-activity] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

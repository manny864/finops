import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getSqlDbRightsizingRecommendations } from "@/modules/collectors/azure/sqlDbRightsizingService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        try {
            if (!isMockTenant(tenantId)) {
                await requireTenantTier(request, tenantId, "Business");
            } else {
                await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
            }
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        const data = await getWithStaleWhileRevalidate(
            `sqldb-rightsizing:v2:${tenantId}`,
            () => getSqlDbRightsizingRecommendations(tenantId),
            1800,
            600
        );

        return NextResponse.json({ success: true, mock: isMockTenant(tenantId), ...data });
    } catch (err: unknown) {
        console.error("[rightsizing/sqldb] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, mock: false, items: [], totalSavings: 0, error: "Internal server error" }, { status: 500 });
    }
}

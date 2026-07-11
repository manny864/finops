import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getCreatedByAggregation } from "@/modules/collectors/azure/resourceInventoryService";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantTier(request, tenantId, "Professional");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("resources_created_by", tenantId));
        }

        const data = await getCreatedByAggregation(tenantId);
        return NextResponse.json({ success: true, mock: false, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/created-by] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

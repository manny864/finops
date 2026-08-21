import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getLiveCreatedByAggregation, generateMockCreatedByAggregation } from "@/services/azureResourcesInventory.service";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // ORDEN CRÍTICO: isMockTenant antes de auth
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, ...generateMockCreatedByAggregation("Professional") });
        }

        await requireTenantTier(request, tenantId, "Professional");

        const data = await getWithStaleWhileRevalidate(
            `resources:created-by:v2:${tenantId}`,
            () => getLiveCreatedByAggregation(tenantId),
            3600
        );
        return NextResponse.json({ success: true, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/created-by] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

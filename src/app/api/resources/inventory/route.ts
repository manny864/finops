import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getLiveResourcesInventory, generateMockResourcesInventory } from "@/services/azureResourcesInventory.service";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // ORDEN CRÍTICO: isMockTenant antes de auth
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, ...generateMockResourcesInventory("Professional") });
        }

        await requireTenantTier(request, tenantId, "Professional");

        const data = await getWithStaleWhileRevalidate(
            `resources:inventory:v2:${tenantId}`,
            () => getLiveResourcesInventory(tenantId),
            3600
        );
        return NextResponse.json({ success: true, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/inventory] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getInventoryDistribution } from "@/modules/collectors/azure/resourceInventoryService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { tenantUsesAws } from "@/lib/tenantProviderContext";
import { getAwsInventoryDistribution } from "@/modules/collectors/aws/awsResourceInventoryService";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantTier(request, tenantId, "Professional");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("resources_inventory", tenantId));
        }

        if (await tenantUsesAws(tenantId)) {
            const awsData = await getWithStaleWhileRevalidate(
                `resources:inventory:aws:v1:${tenantId}`,
                () => getAwsInventoryDistribution(tenantId),
                3600
            );
            return NextResponse.json({ success: true, mock: false, provider: "AWS", ...awsData });
        }

        const data = await getWithStaleWhileRevalidate(
            `resources:inventory:v1:${tenantId}`,
            () => getInventoryDistribution(tenantId),
            3600
        );
        return NextResponse.json({ success: true, mock: false, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/inventory] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getCreatedByAggregation } from "@/modules/collectors/azure/resourceInventoryService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { tenantUsesAws } from "@/lib/tenantProviderContext";
import { getAwsCreatedByAggregation } from "@/modules/collectors/aws/awsResourceInventoryService";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantTier(request, tenantId, "Professional");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("resources_created_by", tenantId));
        }

        if (await tenantUsesAws(tenantId)) {
            // Mismo proxy que en Azure: el creador real vive en CloudTrail, una
            // ingesta aparte. Se deriva de la etiqueta CreatedBy/Owner.
            const awsData = await getWithStaleWhileRevalidate(
                `resources:created-by:aws:v1:${tenantId}`,
                () => getAwsCreatedByAggregation(tenantId),
                3600
            );
            return NextResponse.json({ success: true, mock: false, provider: "AWS", ...awsData });
        }

        const data = await getWithStaleWhileRevalidate(
            `resources:created-by:v1:${tenantId}`,
            () => getCreatedByAggregation(tenantId),
            3600
        );
        return NextResponse.json({ success: true, mock: false, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/created-by] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

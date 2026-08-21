import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { searchLiveResources, generateMockResourcesSearch } from "@/services/azureResourcesInventory.service";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const pageSize = Math.min(60, Math.max(5, Number(url.searchParams.get("pageSize")) || 15));
        const subscriptionId = url.searchParams.get("subscriptionId") || "";
        const resourceGroup = url.searchParams.get("resourceGroup") || "";
        const tagKey = url.searchParams.get("tagKey") || "";
        const search = url.searchParams.get("search") || "";

        // ORDEN CRÍTICO: isMockTenant antes de auth
        if (isMockTenant(tenantId)) {
            const mock = generateMockResourcesSearch("Professional", {
                subscriptionId: subscriptionId || undefined,
                resourceGroup: resourceGroup || undefined,
                tagKey: tagKey || undefined,
                search: search || undefined,
                page,
                pageSize,
            });
            return NextResponse.json({ success: true, ...mock });
        }

        await requireTenantTier(request, tenantId, "Professional");

        const cacheKey = `resources:search:v2:${tenantId}:${page}:${pageSize}:${subscriptionId}:${resourceGroup}:${tagKey}:${search}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, () => searchLiveResources(tenantId, {
            subscriptionId: subscriptionId || undefined,
            resourceGroup: resourceGroup || undefined,
            tagKey: tagKey || undefined,
            search: search || undefined,
            page,
            pageSize,
        }), 1800);

        return NextResponse.json({ success: true, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/search] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

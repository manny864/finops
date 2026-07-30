import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { searchResources } from "@/modules/collectors/azure/resourceInventoryService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantTier(request, tenantId, "Professional");

        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        // Techo 60: coincide con la mayor opción del selector (15/30/45/60) en
        // ResourcesBoard.tsx — antes era 50, que ni siquiera alcanzaba para la
        // opción de 60 filas.
        const pageSize = Math.min(60, Math.max(5, Number(url.searchParams.get("pageSize")) || 15));

        if (isMockTenant(tenantId)) {
            // El mock trae TODAS las filas en `allRows`; se sliceá acá según el
            // page/pageSize real pedido — si no, elegir 30/45/60 en modo demo
            // seguía mostrando siempre las mismas 15 filas fijas del default.
            const { allRows: mockAllRows, ...mock } = getMockDataForRoute("resources_search", tenantId);
            const allRows = mockAllRows || mock.rows || [];
            const rows = allRows.slice((page - 1) * pageSize, page * pageSize);
            return NextResponse.json({ ...mock, rows, page, pageSize });
        }

        const subscriptionId = url.searchParams.get("subscriptionId") || "";
        const resourceGroup = url.searchParams.get("resourceGroup") || "";
        const tagKey = url.searchParams.get("tagKey") || "";
        const search = url.searchParams.get("search") || "";

        const cacheKey = `resources:search:v1:${tenantId}:${page}:${pageSize}:${subscriptionId}:${resourceGroup}:${tagKey}:${search}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, () => searchResources(tenantId, {
            subscriptionId: subscriptionId || undefined,
            resourceGroup: resourceGroup || undefined,
            tagKey: tagKey || undefined,
            search: search || undefined,
            page,
            pageSize,
        }), 3600);

        return NextResponse.json({ success: true, mock: false, page, pageSize, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/search] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

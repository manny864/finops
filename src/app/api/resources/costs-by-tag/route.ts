import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getDistinctTagKeys, getCostByTagKey } from "@/modules/collectors/azure/resourceInventoryService";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantTier(request, tenantId, "Professional");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("resources_costs_by_tag", tenantId));
        }

        const keys = await getDistinctTagKeys(tenantId);
        // Máx. 3 concurrentes: cada clave dispara N consultas de Cost Management
        // (una por suscripción) y evitamos saturar la API con 429s.
        const tags: Array<{ key: string; values: Array<{ value: string; cost: number }>; totalCost: number }> = [];
        for (let i = 0; i < keys.length; i += 3) {
            const batch = keys.slice(i, i + 3);
            const results = await Promise.all(batch.map(async k => ({ key: k, values: await getCostByTagKey(tenantId, k) })));
            for (const r of results) {
                tags.push({ key: r.key, values: r.values, totalCost: Number(r.values.reduce((s, v) => s + v.cost, 0).toFixed(2)) });
            }
        }
        tags.sort((a, b) => b.totalCost - a.totalCost);

        return NextResponse.json({ success: true, mock: false, tags });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/costs-by-tag] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

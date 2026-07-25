import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getDistinctTagKeys, getCostByTagKey } from "@/modules/collectors/azure/resourceInventoryService";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { tenantUsesAws } from "@/lib/tenantProviderContext";
import { getAwsDistinctTagKeys, getAwsCostByTagKey } from "@/modules/collectors/aws/awsResourceInventoryService";

async function fetchCostsByTag(tenantId: string) {
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
    return { tags };
}

/**
 * Costo por etiqueta en AWS.
 *
 * No hay batching de concurrencia como en Azure: alla cada clave dispara N
 * llamadas a Cost Management (una por suscripcion) y saturaba la API con 429s.
 * Aca las dos consultas van contra `FocusLineItems`, en la base propia.
 */
async function fetchAwsCostsByTag(tenantId: string) {
    const keys = await getAwsDistinctTagKeys(tenantId);
    const results = await Promise.all(keys.map(async k => ({ key: k, values: await getAwsCostByTagKey(tenantId, k) })));
    const tags = results.map(r => ({
        key: r.key,
        values: r.values,
        totalCost: Number(r.values.reduce((s, v) => s + v.cost, 0).toFixed(2)),
    }));
    tags.sort((a, b) => b.totalCost - a.totalCost);
    return { tags };
}

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantTier(request, tenantId, "Professional");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("resources_costs_by_tag", tenantId));
        }

        if (await tenantUsesAws(tenantId)) {
            const awsData = await getWithStaleWhileRevalidate(
                `resources:costs-by-tag:aws:v1:${tenantId}`,
                () => fetchAwsCostsByTag(tenantId),
                3600
            );
            return NextResponse.json({ success: true, mock: false, provider: "AWS", ...awsData });
        }

        // Es la consulta más cara de las 4 (N llamadas a Cost Management por
        // tag key x suscripción) — la que más se beneficia de Redis.
        const data = await getWithStaleWhileRevalidate(
            `resources:costs-by-tag:v1:${tenantId}`,
            () => fetchCostsByTag(tenantId),
            3600
        );

        return NextResponse.json({ success: true, mock: false, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[resources/costs-by-tag] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { getMiscServicesCost } from "@/modules/collectors/azure/miscServicesCostService";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";

type Family = "postgres-mysql" | "mongodb" | "redis";

const FAMILY_MATCHERS: Record<Family, string[]> = {
    "postgres-mysql": ["postgresql", "mysql"],
    mongodb: ["mongodb", "mongo", "cosmos db"],
    redis: ["redis"],
};

const FAMILY_RESOURCE_TYPES: Record<Family, string[]> = {
    "postgres-mysql": [
        "microsoft.dbforpostgresql/flexibleservers",
        "microsoft.dbforpostgresql/servers",
        "microsoft.dbformysql/flexibleservers",
        "microsoft.dbformysql/servers",
    ],
    mongodb: [
        "microsoft.documentdb/databaseaccounts",
        "microsoft.documentdb/mongoclusters",
    ],
    redis: ["microsoft.cache/redis", "microsoft.cache/redisenterprise"],
};

function filterFamily(items: Array<{ serviceLabel: string; monthlyCost: number; resourceType?: string }>, family: Family) {
    const tokens = FAMILY_MATCHERS[family];
    return items.filter((i) => tokens.some((token) => i.serviceLabel.toLowerCase().includes(token)));
}

function aggregateByLabel(items: Array<{ serviceLabel: string; monthlyCost: number; resourceCount?: number }>) {
    const byLabel = new Map<string, { monthlyCost: number; resourceCount: number }>();
    for (const item of items) {
        const prev = byLabel.get(item.serviceLabel) || { monthlyCost: 0, resourceCount: 0 };
        byLabel.set(item.serviceLabel, {
            monthlyCost: prev.monthlyCost + Number(item.monthlyCost || 0),
            resourceCount: prev.resourceCount + Number(item.resourceCount || 0),
        });
    }
    return Array.from(byLabel.entries())
        .map(([serviceLabel, values]) => ({
            serviceLabel,
            monthlyCost: Number(values.monthlyCost.toFixed(2)),
            resourceCount: values.resourceCount,
        }))
        .sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const family = searchParams.get("family") as Family | null;

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!family || !(family in FAMILY_MATCHERS)) {
            return NextResponse.json({ error: "Parámetro family inválido" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        const cacheKey = `db-service-cost:v1:${tenantId}:${family}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            if (isMockTenant(tenantId)) {
                const mock = await getMiscServicesCost(null, "", tenantId);
                const filtered = filterFamily(mock.items, family);
                const items = aggregateByLabel(filtered);
                return {
                    success: true,
                    mock: true,
                    family,
                    items,
                    totalMonthlyCost: Number(items.reduce((sum, i) => sum + i.monthlyCost, 0).toFixed(2)),
                    dataAvailable: mock.dataAvailable,
                };
            }

            const credential = await getAzureCredential(tenantId);
            const subscriptions = await getSubscriptionsForTenant(tenantId, credential);
            const resourceCountsByType = new Map<string, number>();
            try {
                const arg = await getResourceGraphClient(tenantId);
                const types = FAMILY_RESOURCE_TYPES[family].map((t) => `'${t}'`).join(",");
                const query = `
                    Resources
                    | where type in~ (${types})
                    | summarize resourceCount = count() by resourceType = tolower(type)
                `;
                const argRes: any = await arg.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
                for (const row of (argRes.data as any[]) || []) {
                    resourceCountsByType.set(String(row.resourceType || "").toLowerCase(), Number(row.resourceCount || 0));
                }
            } catch {
                // best-effort: si ARG falla, seguimos con costos
            }

            const allItems: Array<{ serviceLabel: string; monthlyCost: number; resourceType?: string; resourceCount?: number }> = [];
            let dataAvailable = true;
            if (subscriptions.length > 0) {
                for (const subId of subscriptions) {
                    const subData = await getMiscServicesCost(credential, subId, tenantId);
                    dataAvailable = dataAvailable && subData.dataAvailable;
                    allItems.push(...filterFamily(subData.items as any, family));
                }
            }

            const aggregatedCosts = aggregateByLabel(allItems);

            const labelByType: Record<string, string> = {
                "microsoft.dbforpostgresql/flexibleservers": "PostgreSQL",
                "microsoft.dbforpostgresql/servers": "PostgreSQL",
                "microsoft.dbformysql/flexibleservers": "MySQL",
                "microsoft.dbformysql/servers": "MySQL",
                "microsoft.documentdb/databaseaccounts": "Cosmos DB (Mongo API)",
                "microsoft.documentdb/mongoclusters": "MongoDB Cluster",
                "microsoft.cache/redis": "Azure Cache for Redis",
                "microsoft.cache/redisenterprise": "Azure Cache for Redis Enterprise",
            };

            const inventoryItems = Array.from(resourceCountsByType.entries()).map(([type, resourceCount]) => ({
                serviceLabel: labelByType[type] || type,
                monthlyCost: 0,
                resourceCount,
            }));

            const items = aggregateByLabel([...aggregatedCosts, ...inventoryItems]);
            return {
                success: true,
                mock: false,
                family,
                items,
                totalMonthlyCost: Number(items.reduce((sum, i) => sum + i.monthlyCost, 0).toFixed(2)),
                dataAvailable,
            };
        }, 1800, 600);

        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[databases/service-cost] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

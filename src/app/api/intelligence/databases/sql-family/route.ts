import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { withCostColumn, findCostColumnIndex } from "@/lib/azureCostColumn";
import { isMockTenant } from "@/lib/mockData";

const SQL_TYPES = ["microsoft.sql/servers/databases", "microsoft.sql/managedinstances"];
const SQL_LABEL: Record<string, string> = {
    "microsoft.sql/servers/databases": "Azure SQL Database",
    "microsoft.sql/managedinstances": "Azure SQL Managed Instance",
};

function emptyPayload(mock: boolean) {
    return {
        success: true,
        mock,
        items: SQL_TYPES.map((t) => ({ resourceType: t, serviceLabel: SQL_LABEL[t], resourceCount: 0, monthlyCost: 0 })),
        totalMonthlyCost: 0,
        dataAvailable: true,
    };
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        const data = await getWithStaleWhileRevalidate(
            `db-sql-family:v1:${tenantId}`,
            async () => {
                if (isMockTenant(tenantId)) {
                    return {
                        success: true,
                        mock: true,
                        items: [
                            { resourceType: "microsoft.sql/servers/databases", serviceLabel: SQL_LABEL["microsoft.sql/servers/databases"], resourceCount: 5, monthlyCost: 820.45 },
                            { resourceType: "microsoft.sql/managedinstances", serviceLabel: SQL_LABEL["microsoft.sql/managedinstances"], resourceCount: 1, monthlyCost: 1240.7 },
                        ],
                        totalMonthlyCost: 2061.15,
                        dataAvailable: true,
                    };
                }

                const credential = await getAzureCredential(tenantId);
                const subs = await getSubscriptionsForTenant(tenantId, credential);
                if (subs.length === 0) return emptyPayload(false);

                const argClient = await getResourceGraphClient(tenantId);
                const countQuery = `
                    Resources
                    | where type in~ ('microsoft.sql/servers/databases','microsoft.sql/managedinstances')
                    | summarize resourceCount = count() by resourceType = tolower(type)
                `;
                const argRes: any = await argClient.resources({ query: countQuery, options: { resultFormat: "objectArray", top: 1000 } });
                const countMap = new Map<string, number>();
                for (const row of (argRes.data as any[]) || []) {
                    countMap.set(String(row.resourceType || "").toLowerCase(), Number(row.resourceCount || 0));
                }

                const costMap = new Map<string, number>(SQL_TYPES.map((t) => [t, 0]));
                let dataAvailable = true;
                for (const subId of subs) {
                    const cm = new CostManagementClient(credential);
                    const scope = `/subscriptions/${subId}`;
                    const now = new Date();
                    const from = new Date();
                    from.setDate(now.getDate() - 30);
                    try {
                        const result = await withCostColumn(tenantId, (col) =>
                            cm.query.usage(scope, {
                                type: "ActualCost",
                                timeframe: "Custom",
                                timePeriod: { from, to: now },
                                dataset: {
                                    granularity: "None",
                                    aggregation: { totalCost: { name: col, function: "Sum" } },
                                    grouping: [{ type: "Dimension", name: "ResourceType" }],
                                    filter: { dimensions: { name: "ResourceType", operator: "In", values: SQL_TYPES } },
                                },
                            } as any)
                        );
                        const cols = result.columns || [];
                        const costIdx = findCostColumnIndex(cols as any);
                        const typeIdx = cols.findIndex((c: any) => /resourcetype/i.test(c?.name || ""));
                        for (const row of result.rows || []) {
                            const type = String(row[typeIdx] || "").toLowerCase();
                            if (!costMap.has(type)) continue;
                            const cost = Number(row[costIdx >= 0 ? costIdx : 0] || 0);
                            costMap.set(type, (costMap.get(type) || 0) + cost);
                        }
                    } catch {
                        dataAvailable = false;
                    }
                }

                const items = SQL_TYPES.map((type) => ({
                    resourceType: type,
                    serviceLabel: SQL_LABEL[type],
                    resourceCount: countMap.get(type) || 0,
                    monthlyCost: Number((costMap.get(type) || 0).toFixed(2)),
                }));
                return {
                    success: true,
                    mock: false,
                    items,
                    totalMonthlyCost: Number(items.reduce((sum, i) => sum + i.monthlyCost, 0).toFixed(2)),
                    dataAvailable,
                };
            },
            1800,
            600
        );

        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[databases/sql-family] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

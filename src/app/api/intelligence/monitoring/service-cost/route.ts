import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { withCostColumn, findCostColumnIndex } from "@/lib/azureCostColumn";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";

type Family = "azure-monitor" | "action-groups" | "workbooks" | "network-watcher";

const FAMILY_META: Record<Family, { serviceNames: string[]; argTypeFilter: string; label: string }> = {
    "azure-monitor": {
        serviceNames: ["Azure Monitor"],
        argTypeFilter: "type in~ ('microsoft.insights/components','microsoft.operationalinsights/workspaces','microsoft.insights/metricalerts','microsoft.insights/scheduledqueryrules')",
        label: "Azure Monitor",
    },
    "action-groups": {
        serviceNames: ["Azure Monitor"],
        argTypeFilter: "type =~ 'microsoft.insights/actiongroups'",
        label: "Action Groups",
    },
    workbooks: {
        serviceNames: ["Azure Monitor"],
        argTypeFilter: "type =~ 'microsoft.insights/workbooks'",
        label: "Workbooks",
    },
    "network-watcher": {
        serviceNames: ["Network Watcher"],
        argTypeFilter: "type =~ 'microsoft.network/networkwatchers'",
        label: "Network Watcher",
    },
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const family = searchParams.get("family") as Family | null;
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!family || !(family in FAMILY_META)) return NextResponse.json({ error: "Parámetro family inválido" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        const data = await getWithStaleWhileRevalidate(
            `monitoring-service-cost:v1:${tenantId}:${family}`,
            async () => {
                if (isMockTenant(tenantId)) {
                    const mockMap: Record<Family, number> = {
                        "azure-monitor": 341.2,
                        "action-groups": 0,
                        workbooks: 19.4,
                        "network-watcher": 37.8,
                    };
                    const resourceCountMap: Record<Family, number> = {
                        "azure-monitor": 12,
                        "action-groups": 5,
                        workbooks: 4,
                        "network-watcher": 2,
                    };
                    return {
                        success: true,
                        mock: true,
                        family,
                        serviceLabel: FAMILY_META[family].label,
                        resourceCount: resourceCountMap[family],
                        monthlyCost: mockMap[family],
                        dataAvailable: true,
                    };
                }

                const credential = await getAzureCredential(tenantId);
                const subs = await getSubscriptionsForTenant(tenantId, credential);

                let resourceCount = 0;
                try {
                    const arg = await getResourceGraphClient(tenantId);
                    const q = `Resources | where ${FAMILY_META[family].argTypeFilter} | summarize resourceCount = count()`;
                    const argRes: any = await arg.resources({ query: q, options: { resultFormat: "objectArray", top: 1 } });
                    resourceCount = Number((argRes.data as any[])?.[0]?.resourceCount || 0);
                } catch {
                    resourceCount = 0;
                }

                if (subs.length === 0) {
                    return { success: true, mock: false, family, serviceLabel: FAMILY_META[family].label, resourceCount, monthlyCost: 0, dataAvailable: true };
                }

                let monthlyCost = 0;
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
                                    grouping: [{ type: "Dimension", name: "ServiceName" }],
                                    filter: { dimensions: { name: "ServiceName", operator: "In", values: FAMILY_META[family].serviceNames } },
                                },
                            } as any)
                        );
                        const cols = result.columns || [];
                        const costIdx = findCostColumnIndex(cols as any);
                        for (const row of result.rows || []) {
                            monthlyCost += Number(row[costIdx >= 0 ? costIdx : 0] || 0);
                        }
                    } catch {
                        dataAvailable = false;
                    }
                }

                return {
                    success: true,
                    mock: false,
                    family,
                    serviceLabel: FAMILY_META[family].label,
                    resourceCount,
                    monthlyCost: Number(monthlyCost.toFixed(2)),
                    dataAvailable,
                };
            },
            1800,
            600
        );

        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[monitoring/service-cost] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

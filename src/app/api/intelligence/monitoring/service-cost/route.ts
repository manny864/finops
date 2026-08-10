import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { withCostColumn, findCostColumnIndex } from "@/lib/azureCostColumn";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";

type Family = "azure-monitor" | "action-groups" | "workbooks" | "network-watcher" | "microsoft-sentinel";

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
    "microsoft-sentinel": {
        serviceNames: ["Microsoft Sentinel", "Azure Monitor"],
        argTypeFilter: "type =~ 'microsoft.operationalinsights/workspaces'",
        label: "Microsoft Sentinel",
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
                    const mockResourcesMap: Record<Family, Array<{ name: string; resourceGroup: string; subscriptionId: string; monthlyCost: number }>> = {
                        "azure-monitor": [
                            { name: "law-prod-central", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 180.0 },
                            { name: "law-network-diag", resourceGroup: "rg-network", subscriptionId: "mock-sub", monthlyCost: 95.0 },
                            { name: "law-security", resourceGroup: "rg-security", subscriptionId: "mock-sub", monthlyCost: 50.0 },
                            { name: "law-apps-dev", resourceGroup: "rg-dev", subscriptionId: "mock-sub", monthlyCost: 16.2 }
                        ],
                        "action-groups": [
                            { name: "ag-email-alerts", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 0 },
                            { name: "ag-sms-critical", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 0 }
                        ],
                        workbooks: [
                            { name: "wb-finops-dashboard", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 12.4 },
                            { name: "wb-security-audit", resourceGroup: "rg-security", subscriptionId: "mock-sub", monthlyCost: 7.0 }
                        ],
                        "network-watcher": [
                            { name: "nw-eastus", resourceGroup: "NetworkWatcherRG", subscriptionId: "mock-sub", monthlyCost: 25.0 },
                            { name: "nw-westeurope", resourceGroup: "NetworkWatcherRG", subscriptionId: "mock-sub", monthlyCost: 12.8 }
                        ],
                        "microsoft-sentinel": [
                            { name: "sentinel-workspace-prod", resourceGroup: "rg-security", subscriptionId: "mock-sub", monthlyCost: 124.20 },
                            { name: "sentinel-workspace-shared", resourceGroup: "rg-monitoring", subscriptionId: "mock-sub", monthlyCost: 62.40 }
                        ]
                    };
                    const resources = mockResourcesMap[family] || [];
                    const monthlyCost = resources.reduce((acc, r) => acc + r.monthlyCost, 0);
                    return {
                        success: true,
                        mock: true,
                        family,
                        serviceLabel: FAMILY_META[family].label,
                        resourceCount: resources.length,
                        monthlyCost: Number(monthlyCost.toFixed(2)),
                        resources,
                        dataAvailable: true,
                    };
                }

                const credential = await getAzureCredential(tenantId);
                const subs = await getSubscriptionsForTenant(tenantId, credential);

                let resources: any[] = [];
                try {
                    const arg = await getResourceGraphClient(tenantId);
                    const q = `Resources | where ${FAMILY_META[family].argTypeFilter} | project name, resourceGroup, subscriptionId, id = tolower(id)`;
                    const argRes: any = await arg.resources({ query: q, options: { resultFormat: "objectArray", top: 1000 } });
                    resources = (argRes.data as any[]) || [];
                } catch {
                    resources = [];
                }

                if (subs.length === 0) {
                    return { success: true, mock: false, family, serviceLabel: FAMILY_META[family].label, resourceCount: resources.length, monthlyCost: 0, resources: [], dataAvailable: true };
                }

                let monthlyCost = 0;
                let dataAvailable = true;
                const costByResourceId: Record<string, number> = {};
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
                                    grouping: [{ type: "Dimension", name: "ResourceId" }],
                                    filter: { dimensions: { name: "ServiceName", operator: "In", values: FAMILY_META[family].serviceNames } },
                                },
                            } as any)
                        );
                        const cols = result.columns || [];
                        const costIdx = findCostColumnIndex(cols as any);
                        const ridIdx = cols.map((c: any) => String(c.name).toLowerCase()).indexOf("resourceid");
                        for (const row of result.rows || []) {
                            const rid = ridIdx >= 0 ? String(row[ridIdx]).toLowerCase() : "";
                            const cost = costIdx >= 0 ? Number(row[costIdx] || 0) : 0;
                            if (rid) {
                                costByResourceId[rid] = (costByResourceId[rid] || 0) + cost;
                            }
                        }
                    } catch {
                        dataAvailable = false;
                    }
                }

                const mappedResources = resources.map((r) => {
                    const cost = costByResourceId[r.id] || 0;
                    monthlyCost += cost;
                    return {
                        name: r.name,
                        resourceGroup: r.resourceGroup,
                        subscriptionId: r.subscriptionId,
                        monthlyCost: Number(cost.toFixed(2)),
                    };
                }).sort((a, b) => b.monthlyCost - a.monthlyCost);

                return {
                    success: true,
                    mock: false,
                    family,
                    serviceLabel: FAMILY_META[family].label,
                    resourceCount: mappedResources.length,
                    monthlyCost: Number(monthlyCost.toFixed(2)),
                    resources: mappedResources,
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

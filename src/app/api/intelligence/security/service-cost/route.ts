import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { withCostColumn, findCostColumnIndex } from "@/lib/azureCostColumn";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";

type Family = "sentinel" | "key-vault" | "entra-id" | "waf" | "ddos";

const FAMILY_META: Record<Family, { serviceNames: string[]; argTypeFilter: string | null; label: string }> = {
    sentinel: {
        serviceNames: ["Microsoft Sentinel", "Azure Monitor"],
        argTypeFilter: "type =~ 'microsoft.operationalinsights/workspaces'",
        label: "Microsoft Sentinel",
    },
    "key-vault": {
        serviceNames: ["Key Vault"],
        argTypeFilter: "type =~ 'microsoft.keyvault/vaults'",
        label: "Key Vault",
    },
    "entra-id": {
        serviceNames: ["Microsoft Entra ID", "Azure Active Directory"],
        argTypeFilter: null,
        label: "Entra ID",
    },
    waf: {
        serviceNames: ["Application Gateway", "Azure Front Door", "Web Application Firewall"],
        argTypeFilter: "type in~ ('microsoft.network/applicationgatewaywebapplicationfirewallpolicies','microsoft.cdn/frontdoorwebapplicationfirewallpolicies','microsoft.network/applicationgateways')",
        label: "WAF",
    },
    ddos: {
        serviceNames: ["DDoS Protection"],
        argTypeFilter: "type =~ 'microsoft.network/ddosprotectionplans'",
        label: "DDoS Protection",
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
            `security-service-cost:v2:${tenantId}:${family}`,
            async () => {
                if (isMockTenant(tenantId)) {
                    const mockResourcesMap: Record<Family, Array<{
                        name: string;
                        resourceGroup: string;
                        subscriptionId: string;
                        subscriptionName: string;
                        region: string;
                        type: string;
                        monthlyCost: number;
                    }>> = {
                        sentinel: [
                            {
                                name: "sentinel-prod-workspace",
                                resourceGroup: "rg-security-prod",
                                subscriptionId: "mock-sub-prod",
                                subscriptionName: "Demo Production Subscription",
                                region: "eastus2",
                                type: "microsoft.operationalinsights/workspaces",
                                monthlyCost: 132.4,
                            },
                            {
                                name: "sentinel-shared-workspace",
                                resourceGroup: "rg-monitoring-shared",
                                subscriptionId: "mock-sub-shared",
                                subscriptionName: "Demo Shared Subscription",
                                region: "westus2",
                                type: "microsoft.operationalinsights/workspaces",
                                monthlyCost: 54.2,
                            },
                        ],
                        "key-vault": [
                            {
                                name: "kv-finops-prod",
                                resourceGroup: "rg-security-prod",
                                subscriptionId: "mock-sub-prod",
                                subscriptionName: "Demo Production Subscription",
                                region: "eastus2",
                                type: "microsoft.keyvault/vaults",
                                monthlyCost: 14.3,
                            },
                            {
                                name: "kv-shared-platform",
                                resourceGroup: "rg-platform",
                                subscriptionId: "mock-sub-shared",
                                subscriptionName: "Demo Shared Subscription",
                                region: "westus2",
                                type: "microsoft.keyvault/vaults",
                                monthlyCost: 10.7,
                            },
                            {
                                name: "kv-dev-sandbox",
                                resourceGroup: "rg-dev",
                                subscriptionId: "mock-sub-dev",
                                subscriptionName: "Demo Sandbox Subscription",
                                region: "eastus",
                                type: "microsoft.keyvault/vaults",
                                monthlyCost: 5.1,
                            },
                        ],
                        "entra-id": [
                            {
                                name: "entra-tenant-directory",
                                resourceGroup: "-",
                                subscriptionId: "tenant-scope",
                                subscriptionName: "Tenant Scope",
                                region: "global",
                                type: "microsoft.entra/directory",
                                monthlyCost: 0,
                            },
                        ],
                        waf: [
                            {
                                name: "waf-policy-edge",
                                resourceGroup: "rg-edge",
                                subscriptionId: "mock-sub-prod",
                                subscriptionName: "Demo Production Subscription",
                                region: "global",
                                type: "microsoft.cdn/frontdoorwebapplicationfirewallpolicies",
                                monthlyCost: 74.1,
                            },
                            {
                                name: "waf-policy-appgw",
                                resourceGroup: "rg-network-prod",
                                subscriptionId: "mock-sub-prod",
                                subscriptionName: "Demo Production Subscription",
                                region: "eastus2",
                                type: "microsoft.network/applicationgatewaywebapplicationfirewallpolicies",
                                monthlyCost: 55.3,
                            },
                        ],
                        ddos: [
                            {
                                name: "ddos-plan-core",
                                resourceGroup: "rg-network-core",
                                subscriptionId: "mock-sub-prod",
                                subscriptionName: "Demo Production Subscription",
                                region: "eastus2",
                                type: "microsoft.network/ddosprotectionplans",
                                monthlyCost: 76.2,
                            },
                        ],
                    };
                    const resources = mockResourcesMap[family] || [];
                    const monthlyCost = resources.reduce((acc, resource) => acc + Number(resource.monthlyCost || 0), 0);
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
                const subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);

                let resources: Array<{
                    name: string;
                    resourceGroup: string;
                    subscriptionId: string;
                    region: string;
                    type: string;
                    id: string;
                }> = [];
                if (FAMILY_META[family].argTypeFilter) {
                    try {
                        const arg = await getResourceGraphClient(tenantId);
                        const q = `Resources | where ${FAMILY_META[family].argTypeFilter} | project name, resourceGroup, subscriptionId, location, type, id=tolower(id)`;
                        const argRes: any = await arg.resources({ query: q, options: { resultFormat: "objectArray", top: 1000 } });
                        resources = ((argRes.data as any[]) || []).map((row) => ({
                            name: String(row.name || "-"),
                            resourceGroup: String(row.resourceGroup || "-"),
                            subscriptionId: String(row.subscriptionId || "unknown"),
                            region: String(row.location || "unknown"),
                            type: String(row.type || FAMILY_META[family].label),
                            id: String(row.id || "").toLowerCase(),
                        }));
                    } catch {
                        resources = [];
                    }
                }

                if (subs.length === 0) {
                    return {
                        success: true,
                        mock: false,
                        family,
                        serviceLabel: FAMILY_META[family].label,
                        resourceCount: family === "entra-id" ? 1 : resources.length,
                        monthlyCost: 0,
                        resources: family === "entra-id"
                            ? [{
                                name: "entra-tenant-directory",
                                resourceGroup: "-",
                                subscriptionId: "tenant-scope",
                                subscriptionName: "Tenant Scope",
                                region: "global",
                                type: "microsoft.entra/directory",
                                monthlyCost: 0,
                            }]
                            : [],
                        dataAvailable: true,
                    };
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
                        const resourceIdIdx = cols.map((column: any) => String(column.name).toLowerCase()).indexOf("resourceid");
                        for (const row of result.rows || []) {
                            const cost = Number(row[costIdx >= 0 ? costIdx : 0] || 0);
                            const resourceId = resourceIdIdx >= 0 ? String(row[resourceIdIdx] || "").toLowerCase() : "";
                            monthlyCost += cost;
                            if (resourceId) {
                                costByResourceId[resourceId] = (costByResourceId[resourceId] || 0) + cost;
                            }
                        }
                    } catch {
                        dataAvailable = false;
                    }
                }

                const mappedResources = family === "entra-id"
                    ? [{
                        name: "entra-tenant-directory",
                        resourceGroup: "-",
                        subscriptionId: "tenant-scope",
                        subscriptionName: "Tenant Scope",
                        region: "global",
                        type: "microsoft.entra/directory",
                        monthlyCost: Number(monthlyCost.toFixed(2)),
                    }]
                    : resources
                        .map((resource) => ({
                            name: resource.name,
                            resourceGroup: resource.resourceGroup,
                            subscriptionId: resource.subscriptionId,
                            subscriptionName: resolveSubscriptionName(resource.subscriptionId, subscriptionNameMap) || resource.subscriptionId,
                            region: resource.region,
                            type: resource.type,
                            monthlyCost: Number((costByResourceId[resource.id] || 0).toFixed(2)),
                        }))
                        .sort((a, b) => b.monthlyCost - a.monthlyCost);

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
        console.error("[security/service-cost] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

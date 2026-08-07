import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { withCostColumn, findCostColumnIndex } from "@/lib/azureCostColumn";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";

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
            `security-service-cost:v1:${tenantId}:${family}`,
            async () => {
                if (isMockTenant(tenantId)) {
                    const mockMap: Record<Family, number> = {
                        sentinel: 186.6,
                        "key-vault": 42.3,
                        "entra-id": 0,
                        waf: 129.4,
                        ddos: 76.2,
                    };
                    const resourceCountMap: Record<Family, number> = {
                        sentinel: 2,
                        "key-vault": 7,
                        "entra-id": 1,
                        waf: 3,
                        ddos: 1,
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

                let resourceCount = family === "entra-id" ? 1 : 0;
                if (FAMILY_META[family].argTypeFilter) {
                    try {
                        const arg = await getResourceGraphClient(tenantId);
                        const q = `Resources | where ${FAMILY_META[family].argTypeFilter} | summarize resourceCount = count()`;
                        const argRes: any = await arg.resources({ query: q, options: { resultFormat: "objectArray", top: 1 } });
                        resourceCount = Number((argRes.data as any[])?.[0]?.resourceCount || 0);
                    } catch {
                        if (family !== "entra-id") resourceCount = 0;
                    }
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
        console.error("[security/service-cost] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

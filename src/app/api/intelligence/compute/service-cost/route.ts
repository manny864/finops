import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { withCostColumn, findCostColumnIndex } from "@/lib/azureCostColumn";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";

type Family = "functions" | "batch" | "aro";

const FAMILY_META: Record<Family, { serviceNames: string[]; argTypeFilter: string; label: string }> = {
    functions: {
        serviceNames: ["Azure Functions"],
        argTypeFilter: "type =~ 'microsoft.web/sites' and tostring(kind) contains 'functionapp'",
        label: "Azure Functions",
    },
    batch: {
        serviceNames: ["Azure Batch"],
        argTypeFilter: "type =~ 'microsoft.batch/batchaccounts'",
        label: "Azure Batch",
    },
    aro: {
        serviceNames: ["Azure Red Hat OpenShift"],
        argTypeFilter: "type =~ 'microsoft.redhatopenshift/openshiftclusters'",
        label: "Azure Red Hat OpenShift",
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
            `compute-service-cost:v1:${tenantId}:${family}`,
            async () => {
                if (isMockTenant(tenantId)) {
                    const mockMap: Record<Family, number> = { functions: 132.4, batch: 88.2, aro: 1540.65 };
                    return {
                        success: true,
                        mock: true,
                        family,
                        serviceLabel: FAMILY_META[family].label,
                        resourceCount: family === "functions" ? 6 : family === "batch" ? 2 : 1,
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
        console.error("[compute/service-cost] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

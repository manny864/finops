import { CostManagementClient } from "@azure/arm-costmanagement";
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError } from "@/lib/azureCostColumn";

export async function getNetworkEgressCosts(credential: any, subscriptionId: string, tenantId: string) {
    const client = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;

    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    // CostUSD (normalizado a USD por Azure) en vez de PreTaxCost (moneda de
    // facturación de la suscripción) — ver src/lib/azureCostColumn.ts.
    const buildQueryParameters = (col: string) => ({
        type: "Usage",
        timeframe: "Custom",
        timePeriod: {
            from: thirtyDaysAgo,
            to: now
        },
        dataset: {
            granularity: "None",
            aggregation: {
                totalCost: {
                    name: col,
                    function: "Sum"
                }
            },
            grouping: [
                { type: "Dimension", name: "MeterSubCategory" },
                { type: "Dimension", name: "ResourceGroup" }
            ],
            filter: {
                dimensions: {
                    name: "MeterCategory",
                    operator: "In",
                    values: ["Networking", "Virtual Network", "Bandwidth"]
                }
            }
        }
    });

    const activeCol = await resolveCostColumn(tenantId);

    try {
        return await client.query.usage(scope, buildQueryParameters(activeCol) as any);
    } catch (error: any) {
        if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(error)) {
            console.warn(`[NetworkCostService] CostUSD no soportado para tenant ${tenantId} — degradando a PreTaxCost.`);
            await degradeCostColumn(tenantId);
            try {
                return await client.query.usage(scope, buildQueryParameters('PreTaxCost') as any);
            } catch (retryError) {
                console.error("CostManagement Error:", retryError);
                throw retryError;
            }
        }
        console.error("CostManagement Error:", error);
        throw error;
    }
}

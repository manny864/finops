import { CostManagementClient } from "@azure/arm-costmanagement";

export async function getNetworkEgressCosts(credential: any, subscriptionId: string) {
    const client = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;

    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const queryParameters = {
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
                    name: "PreTaxCost",
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
    };

    try {
        const result = await client.query.usage(scope, queryParameters as any);
        return result;
    } catch (error) {
        console.error("CostManagement Error:", error);
        throw error;
    }
}

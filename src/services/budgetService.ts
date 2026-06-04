import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";

export async function getBudgetConsumption(tenantId: string, subscriptionId: string, costCenterName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;

    try {
        const res = await client.query.usage(scope, {
            type: "Usage",
            timeframe: "MonthToDate",
            dataset: {
                granularity: "Monthly",
                aggregation: {
                    totalCost: { name: "PreTaxCost", function: "Sum" }
                },
                grouping: [],
                filter: {
                    tags: { name: "CostCenter", operator: "In", values: [costCenterName] }
                }
            }
        });

        if (res.rows && res.rows.length > 0 && res.rows[0].length > 0) {
            return parseFloat(res.rows[0][0] as string);
        }
        return 0;
    } catch (e) {
        console.error(`Error fetching cost for ${costCenterName}:`, e);
        return 0;
    }
}

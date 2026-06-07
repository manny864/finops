import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { ConsumptionManagementClient } from "@azure/arm-consumption";

export async function getNativeBudgets(tenantId: string, subscriptionId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ConsumptionManagementClient(credential, subscriptionId);
    const scope = `/subscriptions/${subscriptionId}`;

    const budgetsData = [];
    try {
        for await (const budget of client.budgets.list(scope)) {
            budgetsData.push({
                costCenter: budget.name,
                budget: budget.amount || 0,
                actual: budget.currentSpend ? budget.currentSpend.amount : 0
            });
        }
    } catch (e) {
        console.error(`Error fetching native budgets for scope ${scope}:`, e);
    }
    
    return budgetsData;
}

export async function getBudgetConsumption(tenantId: string, subscriptionId: string, costCenterName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);
    const scope = subscriptionId === 'All' 
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
        : `/subscriptions/${subscriptionId}`;

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

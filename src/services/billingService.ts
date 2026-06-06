import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from "../lib/azure";

export async function getCurrentMonthAmortizedCosts(tenantId: string, subscriptionId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = `/subscriptions/${subscriptionId}`;
    
    const result = await client.query.usage(scope, {
        type: "Usage",
        timeframe: "MonthToDate",
        dataset: {
            granularity: "Daily",
            aggregation: {
                totalCost: {
                    name: "PreTaxCost",
                    function: "Sum"
                }
            },
            grouping: [
                { type: "Dimension", name: "ServiceName" }
            ]
        }
    });

    if (!result.rows) return { costByService: [], dailyTrend: [], totalCost: 0 };

    let totalCost = 0;
    const serviceMap: Record<string, number> = {};
    const dailyMap: Record<string, number> = {};

    result.rows.forEach(row => {
        const cost = Number(row[0]) || 0;
        const dateStr = String(row[1]);
        const service = String(row[2]);

        totalCost += cost;

        if (!serviceMap[service]) serviceMap[service] = 0;
        serviceMap[service] += cost;

        if (!dailyMap[dateStr]) dailyMap[dateStr] = 0;
        dailyMap[dateStr] += cost;
    });

    const costByService = Object.keys(serviceMap).map(k => ({
        name: k,
        cost: Number(serviceMap[k].toFixed(2))
    })).sort((a, b) => b.cost - a.cost);

    const dailyTrend = Object.keys(dailyMap).sort().map(k => {
        const formattedDate = k.length === 8 ? `${k.substring(0,4)}-${k.substring(4,6)}-${k.substring(6,8)}` : k;
        return {
            date: formattedDate,
            cost: Number(dailyMap[k].toFixed(2))
        };
    });

    return {
        costByService,
        dailyTrend,
        totalCost: Number(totalCost.toFixed(2))
    };
}

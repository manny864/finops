import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from "../lib/azure";

export async function getCurrentMonthAmortizedCosts(tenantId: string, subscriptionId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = subscriptionId === 'All' 
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
        : `/subscriptions/${subscriptionId}`;
    
    const queryOptions = {
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
    } as any;

    let result;
    let fallbackResults: any[] = [];
    let isFallback = false;

    try {
        result = await client.query.usage(scope, queryOptions);
    } catch (e: any) {
        if (subscriptionId === 'All' && (e.statusCode === 403 || e.code === 'AuthorizationFailed' || e.message?.includes('AuthorizationFailed'))) {
            isFallback = true;
            console.log("Management Group scope failed, falling back to concurrent subscription iteration...");
            const token = await credential.getToken("https://management.azure.com/.default");
            const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
                headers: { 'Authorization': `Bearer ${token?.token}` }
            });
            const subJson = await subRes.json();
            const subs = subJson.value || [];
            
            const subPromises: Promise<any>[] = [];
            for (const sub of subs) {
                if (sub.subscriptionId && sub.state === 'Enabled') {
                    subPromises.push(client.query.usage(`/subscriptions/${sub.subscriptionId}`, queryOptions).catch(() => null));
                }
            }
            fallbackResults = (await Promise.all(subPromises)).filter(r => r && r.rows);
        } else {
            throw e;
        }
    }

    let totalCost = 0;
    const serviceMap: Record<string, number> = {};
    const dailyMap: Record<string, number> = {};

    const processRows = (rows: any[]) => {
        rows.forEach(row => {
            const cost = Number(row[0]) || 0;
            const dateStr = String(row[1]);
            const service = String(row[2]);

            totalCost += cost;

            if (!serviceMap[service]) serviceMap[service] = 0;
            serviceMap[service] += cost;

            if (!dailyMap[dateStr]) dailyMap[dateStr] = 0;
            dailyMap[dateStr] += cost;
        });
    };

    if (isFallback) {
        fallbackResults.forEach(res => {
            if (res.rows) processRows(res.rows);
        });
    } else {
        if (!result || !result.rows) return { costByService: [], dailyTrend: [], totalCost: 0 };
        processRows(result.rows);
    }

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

export async function getCostForecast(tenantId: string, subscriptionId: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = subscriptionId === 'All' 
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
        : `/subscriptions/${subscriptionId}`;
    
    // Azure Cost Management forecast API expects a timeframe
    // Or we can use timePeriod.
    // We will ask for data from today to the end of the month
    const today = new Date();
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const forecastOptions = {
        type: "Usage",
        timeframe: "Custom",
        timePeriod: {
            from: today,
            to: endOfMonth
        },
        dataset: {
            granularity: "Daily",
            aggregation: {
                totalCost: {
                    name: "PreTaxCost",
                    function: "Sum"
                }
            }
        }
    } as any;

    let result;
    let fallbackResults: any[] = [];
    let isFallback = false;

    try {
        result = await client.forecast.usage(scope, forecastOptions);
    } catch (e: any) {
        if (subscriptionId === 'All' && (e.statusCode === 403 || e.code === 'AuthorizationFailed' || e.message?.includes('AuthorizationFailed'))) {
            isFallback = true;
            console.log("Management Group scope failed for forecast, falling back to concurrent subscription iteration...");
            const token = await credential.getToken("https://management.azure.com/.default");
            const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
                headers: { 'Authorization': `Bearer ${token?.token}` }
            });
            const subJson = await subRes.json();
            const subs = subJson.value || [];

            const subPromises: Promise<any>[] = [];
            for (const sub of subs) {
                if (sub.subscriptionId && sub.state === 'Enabled') {
                    subPromises.push(client.forecast.usage(`/subscriptions/${sub.subscriptionId}`, forecastOptions).catch(() => null));
                }
            }
            fallbackResults = (await Promise.all(subPromises)).filter(r => r && r.rows);
        } else {
            throw e;
        }
    }

    const forecastMap: Record<string, number> = {};

    const processForecastRows = (rows: any[]) => {
        rows.forEach(row => {
            const cost = Number(row[0]) || 0;
            const dateStr = String(row[1]);
            if (!forecastMap[dateStr]) forecastMap[dateStr] = 0;
            forecastMap[dateStr] += cost;
        });
    };

    if (isFallback) {
        fallbackResults.forEach(res => {
            if (res.rows) processForecastRows(res.rows);
        });
    } else {
        if (!result || !result.rows) return [];
        processForecastRows(result.rows);
    }

    const forecastData = Object.keys(forecastMap).sort().map(dateStr => {
        const formattedDate = dateStr.length === 8 ? `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}` : dateStr;
        return {
            date: formattedDate,
            forecastCost: Number(forecastMap[dateStr].toFixed(2))
        };
    });

    return forecastData;
}

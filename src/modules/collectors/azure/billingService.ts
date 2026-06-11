import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from '@/lib/azure';
import { FocusCostEntry, mapAzureToFocus } from '@/modules/core/focusMapper';

export async function getCurrentMonthAmortizedCosts(
    tenantId: string, 
    subscriptionId: string,
    metricType: 'ActualCost' | 'AmortizedCost' = 'ActualCost'
): Promise<FocusCostEntry[]> {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = subscriptionId === 'All' 
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
        : `/subscriptions/${subscriptionId}`;
    
    const queryOptions = {
        type: metricType === 'ActualCost' ? 'ActualCost' : 'AmortizedCost',
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
                { type: "Dimension", name: "ServiceName" },
                { type: "Dimension", name: "SubscriptionId" },
                { type: "Dimension", name: "ChargeType" },
                { type: "Dimension", name: "PublisherType" }
            ]
        }
    } as any;

    let result;
    let fallbackResults: any[] = [];
    let isFallback = false;

    try {
        result = await client.query.usage(scope, queryOptions);
    } catch (e: any) {
        const isAuthOrNotFound = e.statusCode === 403 || e.statusCode === 401 || e.code === 'AuthorizationFailed' || e.code === 'RBACAccessDenied' || e.message?.includes('AuthorizationFailed') || e.code === 'ManagementGroupNotFound' || e.message?.includes("was not found or you don't have access") || e.message?.includes('does not have authorization') || e.message?.includes('does not have any valid subscriptions') || e.statusCode === 400;
        if (subscriptionId === 'All' && isAuthOrNotFound) {
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

    const focusData: FocusCostEntry[] = [];

    const processResult = (res: any) => {
        if (!res || !res.rows || !res.columns) return;
        for (const row of res.rows) {
            focusData.push(mapAzureToFocus(row, res.columns));
        }
    };

    if (isFallback) {
        fallbackResults.forEach(res => processResult(res));
    } else {
        processResult(result);
    }

    return focusData;
}

export async function getCostForecast(
    tenantId: string, 
    subscriptionId: string,
    metricType: 'ActualCost' | 'AmortizedCost' = 'ActualCost'
) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const scope = subscriptionId === 'All' 
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
        : `/subscriptions/${subscriptionId}`;
    
    const today = new Date();
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const forecastOptions = {
        type: metricType === 'ActualCost' ? 'ActualCost' : 'AmortizedCost',
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
        const isAuthOrNotFound = e.statusCode === 403 || e.statusCode === 401 || e.code === 'AuthorizationFailed' || e.code === 'RBACAccessDenied' || e.message?.includes('AuthorizationFailed') || e.code === 'ManagementGroupNotFound' || e.message?.includes("was not found or you don't have access") || e.message?.includes('does not have authorization') || e.message?.includes('does not have any valid subscriptions') || e.statusCode === 400;
        if (subscriptionId === 'All' && isAuthOrNotFound) {
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

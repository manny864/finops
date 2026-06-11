import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');
        const tagKey = searchParams.get('tagKey') || 'CostCenter';

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId" }, { status: 400 });
        }

        const credential = await getAzureCredential(tenantId);
        const client = new CostManagementClient(credential);
        const scope = subscriptionId === 'All' 
            ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
            : `/subscriptions/${subscriptionId}`;

        const parameters = {
            type: "Usage",
            timeframe: "TheLastMonth",
            dataset: {
                granularity: "None",
                aggregation: {
                    totalCost: { name: "PreTaxCost", function: "Sum" }
                },
                grouping: [
                    { type: "Tag", name: tagKey }
                ]
            }
        };

        let result;
        let fallbackResults: any[] = [];
        let isFallback = false;

        try {
            result = await client.query.usage(scope, parameters as any);
        } catch (e: any) {
            const isAuthOrNotFound = e.statusCode === 403 || e.statusCode === 401 || e.code === 'AuthorizationFailed' || e.code === 'RBACAccessDenied' || e.message?.includes('AuthorizationFailed') || e.code === 'ManagementGroupNotFound' || e.message?.includes("was not found or you don't have access") || e.message?.includes('does not have authorization');
            if (subscriptionId === 'All' && isAuthOrNotFound) {
                isFallback = true;
                console.log("Management Group scope failed for chargeback, falling back to concurrent subscription iteration...");
                const token = await credential.getToken("https://management.azure.com/.default");
                const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
                    headers: { 'Authorization': `Bearer ${token?.token}` }
                });
                const subJson = await subRes.json();
                const subs = subJson.value || [];
                
                const subPromises: Promise<any>[] = [];
                for (const sub of subs) {
                    if (sub.subscriptionId && sub.state === 'Enabled') {
                        subPromises.push(client.query.usage(`/subscriptions/${sub.subscriptionId}`, parameters as any).catch(() => null));
                    }
                }
                fallbackResults = (await Promise.all(subPromises)).filter(r => r && r.rows);
            } else {
                throw e;
            }
        }

        const chargebackMap: Record<string, number> = {};

        const processRows = (res: any) => {
            if (res.rows && res.columns) {
                const costIndex = res.columns.findIndex((c: any) => c.name === 'PreTaxCost');
                const tagIndex = res.columns.findIndex((c: any) => c.name === tagKey || c.name === 'TagKey');

                if (costIndex !== -1 && tagIndex !== -1) {
                    for (const row of res.rows) {
                        const cost = row[costIndex] as number;
                        let tagValue = row[tagIndex] as string;
                        if (!tagValue || tagValue.trim() === "") {
                            tagValue = "Sin Etiquetar / Untagged";
                        }
                        
                        if (!chargebackMap[tagValue]) chargebackMap[tagValue] = 0;
                        chargebackMap[tagValue] += cost;
                    }
                }
            }
        };

        if (isFallback) {
            fallbackResults.forEach(res => processRows(res));
        } else {
            if (result) processRows(result);
        }

        const chargebackData = Object.keys(chargebackMap).map(k => ({
            name: k,
            value: Number(chargebackMap[k].toFixed(2))
        }));

        return NextResponse.json({ data: chargebackData });

    } catch (error: any) {
        console.error("Chargeback Fetch Error:", error);
        return NextResponse.json({ error: "Fallo al obtener información de chargeback.", details: error.message }, { status: 500 });
    }
}

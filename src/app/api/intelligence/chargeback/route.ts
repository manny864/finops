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
        const scope = `/subscriptions/${subscriptionId}`;

        const parameters = {
            type: "Usage",
            timeframe: "TheLastMonth",
            dataset: {
                granularity: "None",
                aggregation: {
                    totalCost: { name: "PreTaxCost", function: "Sum" }
                },
                grouping: [
                    { type: "TagKey", name: tagKey }
                ]
            }
        };

        const result = await client.query.usage(scope, parameters as any);

        const chargebackData = [];
        if (result.rows && result.columns) {
            const costIndex = result.columns.findIndex(c => c.name === 'PreTaxCost');
            const tagIndex = result.columns.findIndex(c => c.name === tagKey || c.name === 'TagKey');

            if (costIndex !== -1 && tagIndex !== -1) {
                for (const row of result.rows) {
                    const cost = row[costIndex] as number;
                    let tagValue = row[tagIndex] as string;
                    if (!tagValue || tagValue.trim() === "") {
                        tagValue = "Sin Etiquetar / Untagged";
                    }
                    
                    chargebackData.push({
                        name: tagValue,
                        value: cost
                    });
                }
            }
        }

        return NextResponse.json({ data: chargebackData });

    } catch (error: any) {
        console.error("Chargeback Fetch Error:", error);
        return NextResponse.json({ error: "Fallo al obtener información de chargeback.", details: error.message }, { status: 500 });
    }
}

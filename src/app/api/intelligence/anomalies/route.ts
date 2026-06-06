import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros: tenantId, subscriptionId" }, { status: 400 });
        }

        const credential = await getAzureCredential(tenantId);
        const client = new CostManagementClient(credential);
        const scope = `/subscriptions/${subscriptionId}`;

        const today = new Date();
        const endDate = new Date(today.getTime() - 24 * 60 * 60 * 1000); // Yesterday
        const startDate = new Date(today.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

        const parameters = {
            type: "Usage",
            timeframe: "Custom",
            timePeriod: {
                from: startDate,
                to: endDate
            },
            dataset: {
                granularity: "Daily",
                aggregation: {
                    totalCost: { name: "PreTaxCost", function: "Sum" }
                }
            }
        };

        const result = await client.query.usage(scope, parameters as any);

        const dailyCosts: { date: string; cost: number }[] = [];
        if (result.rows && result.columns) {
            const costIndex = result.columns.findIndex(c => c.name === 'PreTaxCost');
            const dateIndex = result.columns.findIndex(c => c.name === 'UsageDate' || c.name === 'BillingMonth');

            if (costIndex !== -1 && dateIndex !== -1) {
                for (const row of result.rows) {
                    // Cost API returns dates often as YYYYMMDD
                    dailyCosts.push({
                        date: String(row[dateIndex]),
                        cost: row[costIndex] as number
                    });
                }
            }
        }

        if (dailyCosts.length < 2) {
            // Not enough data to compare
            return NextResponse.json({ isAnomaly: false });
        }

        // Sort chronologically (just in case)
        dailyCosts.sort((a, b) => a.date.localeCompare(b.date));

        const baselineDays = dailyCosts.slice(0, dailyCosts.length - 1);
        const day8 = dailyCosts[dailyCosts.length - 1];

        const avgBaseline = baselineDays.reduce((acc, curr) => acc + curr.cost, 0) / baselineDays.length;
        
        // Spike > 20%
        if (avgBaseline > 0 && day8.cost > (avgBaseline * 1.20)) {
            // Anomaly detected!
            // Let's do a quick second query to find the top ResourceGroup for day8
            const rgParameters = {
                type: "Usage",
                timeframe: "Custom",
                timePeriod: {
                    from: endDate,
                    to: endDate
                },
                dataset: {
                    granularity: "None",
                    aggregation: {
                        totalCost: { name: "PreTaxCost", function: "Sum" }
                    },
                    grouping: [
                        { type: "Dimension", name: "ResourceGroupName" }
                    ]
                }
            };

            let topRg = "Varios";
            try {
                const rgResult = await client.query.usage(scope, rgParameters as any);
                if (rgResult.rows && rgResult.columns) {
                    const rgCostIndex = rgResult.columns.findIndex(c => c.name === 'PreTaxCost');
                    const rgIndex = rgResult.columns.findIndex(c => c.name === 'ResourceGroupName');
                    if (rgCostIndex !== -1 && rgIndex !== -1) {
                        let maxRgCost = -1;
                        for (const row of rgResult.rows) {
                            const c = row[rgCostIndex] as number;
                            if (c > maxRgCost) {
                                maxRgCost = c;
                                topRg = String(row[rgIndex]);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Error fetching RG anomaly details:", err);
            }

            return NextResponse.json({
                isAnomaly: true,
                anomalyDate: day8.date,
                baselineAverage: avgBaseline,
                spikeAmount: day8.cost,
                affectedResourceGroup: topRg,
                percentageIncrease: ((day8.cost - avgBaseline) / avgBaseline) * 100
            });
        }

        return NextResponse.json({ isAnomaly: false, baselineAverage: avgBaseline, lastDayCost: day8.cost });
        
    } catch (error: any) {
        console.error("Anomaly Detection Error:", error);
        return NextResponse.json({ error: "Fallo al ejecutar motor de anomalías.", details: error.message }, { status: 500 });
    }
}

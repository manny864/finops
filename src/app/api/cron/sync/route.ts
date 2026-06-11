import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";

export async function GET(request: NextRequest) {
    return runSync(request);
}

export async function POST(request: NextRequest) {
    return runSync(request);
}

async function runSync(request: NextRequest) {
    try {
        // 1. Security Check
        const authHeader = request.headers.get("authorization");
        const cronSecret = process.env.CRON_SECRET || "local-cron-secret";
        if (authHeader && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        // 2. Calculate Yesterday's dates
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yyyy = yesterday.getFullYear();
        const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
        const dd = String(yesterday.getDate()).padStart(2, '0');
        const yesterdayStr = `${yyyy}-${mm}-${dd}`;

        // Date range objects for Azure SDK
        const yesterdayStart = new Date(yyyy, yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
        const yesterdayEnd = new Date(yyyy, yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);

        // 3. Query Active Tenants
        const [tenants] = await pool.query<any[]>(
            'SELECT tenant_id as id, client_id, client_secret FROM Tenants WHERE status = "active"'
        );

        const summary: Record<string, any> = {};

        for (const tenant of tenants) {
            summary[tenant.id] = { costsSynced: 0, recommendationsSynced: 0, status: "OK" };

            try {
                if (!tenant.client_id || !tenant.client_secret) {
                    summary[tenant.id].status = "SKIP_NO_CREDENTIALS";
                    continue;
                }

                const credential = await getAzureCredential(tenant.id);
                const client = new CostManagementClient(credential);

                // Fetch enabled subscriptions
                const token = await credential.getToken("https://management.azure.com/.default");
                if (!token) {
                    throw new Error("No se pudo obtener el token de Azure.");
                }

                const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
                    headers: { 'Authorization': `Bearer ${token.token}` }
                });
                const subJson = await subRes.json();
                const subs = subJson.value || [];

                const queryOptions = {
                    type: 'ActualCost',
                    timeframe: 'Custom',
                    timePeriod: {
                        from: yesterdayStart,
                        to: yesterdayEnd
                    },
                    dataset: {
                        granularity: 'Daily',
                        aggregation: {
                            totalCost: {
                                name: 'PreTaxCost',
                                function: 'Sum'
                            }
                        },
                        grouping: [
                            { type: 'Dimension', name: 'ResourceGroup' },
                            { type: 'Dimension', name: 'ServiceName' },
                            { type: 'Dimension', name: 'SubscriptionId' }
                        ]
                    }
                } as any;

                // Sync costs per subscription
                let costCount = 0;
                for (const sub of subs) {
                    if (sub.subscriptionId && sub.state === 'Enabled') {
                        try {
                            const result = await client.query.usage(`/subscriptions/${sub.subscriptionId}`, queryOptions);
                            if (result && result.rows && result.columns) {
                                const costIdx = result.columns.findIndex(c => (c.name || '').toLowerCase() === 'pretaxcost');
                                const rgIdx = result.columns.findIndex(c => (c.name || '').toLowerCase() === 'resourcegroup');
                                const serviceIdx = result.columns.findIndex(c => (c.name || '').toLowerCase() === 'servicename');
                                const subIdx = result.columns.findIndex(c => (c.name || '').toLowerCase() === 'subscriptionid');

                                for (const row of result.rows) {
                                    const cost = Number(row[costIdx]) || 0;
                                    const rg = row[rgIdx] ? String(row[rgIdx]) : 'Unallocated';
                                    const service = row[serviceIdx] ? String(row[serviceIdx]) : 'Unallocated';
                                    const subId = row[subIdx] ? String(row[subIdx]) : sub.subscriptionId;

                                    await pool.query(
                                        `INSERT INTO CostSnapshots (tenant_id, subscription_id, date, resource_group, service_name, cost_usd, currency)
                                         VALUES (?, ?, ?, ?, ?, ?, ?)
                                         ON DUPLICATE KEY UPDATE cost_usd = VALUES(cost_usd)`,
                                        [tenant.id, subId, yesterdayStr, rg, service, cost, 'USD']
                                    );
                                    costCount++;
                                }
                            }
                        } catch (subErr: any) {
                            console.error(`Cost sync sub error for tenant ${tenant.id}, sub ${sub.subscriptionId}:`, subErr.message);
                        }
                    }
                }
                summary[tenant.id].costsSynced = costCount;

                // Sync Advisor Recommendations
                let recCount = 0;
                try {
                    const advisorData = await collectAdvisorData(tenant.id, 'en');
                    if (advisorData?.recommendations) {
                        for (const [recType, list] of Object.entries(advisorData.recommendations)) {
                            const arrayList = Array.isArray(list) ? list : [];
                            const savings = arrayList.reduce((acc: number, curr: any) => 
                                acc + parseFloat(curr.extendedProperties?.savingsAmount || '0'), 0);

                            await pool.query(
                                `INSERT INTO RecommendationsCache (tenant_id, recommendation_type, potential_savings, snapshot_date)
                                 VALUES (?, ?, ?, ?)
                                 ON DUPLICATE KEY UPDATE potential_savings = VALUES(potential_savings)`,
                                [tenant.id, recType, savings, yesterdayStr]
                            );
                            recCount++;
                        }
                    }
                } catch (advErr: any) {
                    console.error(`Advisor sync error for tenant ${tenant.id}:`, advErr.message);
                }
                summary[tenant.id].recommendationsSynced = recCount;

            } catch (err: any) {
                console.error(`Cron sync failed for tenant ${tenant.id}:`, err);
                summary[tenant.id].status = `ERROR: ${err.message}`;
            }
        }

        return NextResponse.json({
            success: true,
            date: yesterdayStr,
            summary
        });

    } catch (e: any) {
        console.error("Cron sync general failure:", e);
        return NextResponse.json({ error: "Internal Server Error", details: e.message }, { status: 500 });
    }
}

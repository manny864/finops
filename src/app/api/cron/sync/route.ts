import { NextRequest, NextResponse } from "next/server";
import pool, { insertCostSnapshot, insertCostSnapshotRow, updateTenantHealth } from "@/modules/storage/db";
import { getYesterdaysCost, getYesterdaysDetailedCosts } from "@/modules/collectors/azure/billingService";
import { getTenantCredentials } from "@/lib/secrets/tenantCredentials";

export async function GET(request: NextRequest) {
    return runSync(request);
}

export async function POST(request: NextRequest) {
    return runSync(request);
}

async function runSync(request: NextRequest) {
    try {
        // 1. Security Check — fail-closed if secret is not configured
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error('CRON_SECRET not configured or too short');
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        // 2. Define YYYY-MM-DD for yesterday
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yyyy = yesterday.getFullYear();
        const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
        const dd = String(yesterday.getDate()).padStart(2, '0');
        const yesterdayStr = `${yyyy}-${mm}-${dd}`;

        // 3. Fetch all active tenants (only IDs — credentials come from KV per-tenant)
        const [tenants] = await pool.query<any[]>(
            'SELECT tenant_id as id FROM Tenants WHERE status = "active"'
        );

        let tenantCount = 0;
        let detailRowsTotal = 0;

        // 4. Sequential Loop (for...of) to avoid rate limits
        for (const tenant of tenants) {
            try {
                const creds = await getTenantCredentials(tenant.id);
                if (!creds) {
                    throw new Error("Azure client credentials are not configured for this tenant.");
                }

                // a) Aggregate total (legacy table cost_snapshots used by dashboard)
                const totalCost = await getYesterdaysCost(tenant.id);
                await insertCostSnapshot(tenant.id, yesterdayStr, totalCost, 'USD');

                // b) Detailed FOCUS rows (CostSnapshots — powers storage-efficiency,
                //    billing, chargeback, ai-analytics, etc.)
                try {
                    const detailedRows = await getYesterdaysDetailedCosts(tenant.id);
                    for (const row of detailedRows) {
                        await insertCostSnapshotRow(tenant.id, yesterdayStr, row);
                    }
                    detailRowsTotal += detailedRows.length;
                    console.log(`[cron-sync] tenant=${tenant.id} detailed rows inserted=${detailedRows.length}`);
                } catch (detailErr: any) {
                    console.error(`[cron-sync] detailed fetch failed for tenant ${tenant.id}:`, detailErr.message);
                }

                // c) Health OK
                await updateTenantHealth(tenant.id, 'OK');
                tenantCount++;
            } catch (err: any) {
                console.error(`Cron sync error for tenant ${tenant.id}:`, err.message);
                await updateTenantHealth(tenant.id, 'ERROR', err.message);
            }
        }

        return NextResponse.json({
            status: 'Sync completed',
            processed: tenantCount,
            detailedRows: detailRowsTotal
        });

    } catch (e: any) {
        console.error("Cron sync fatal failure:", e);
        return NextResponse.json({ error: "Internal Server Error", details: e.message }, { status: 500 });
    }
}

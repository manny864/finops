import { NextRequest, NextResponse } from "next/server";
import pool, { insertCostSnapshot, updateTenantHealth } from "@/modules/storage/db";
import { getYesterdaysCost } from "@/modules/collectors/azure/billingService";

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

        // 3. Fetch all active tenants
        const [tenants] = await pool.query<any[]>(
            'SELECT tenant_id as id, client_id, client_secret FROM Tenants WHERE status = "active"'
        );

        let tenantCount = 0;

        // 4. Sequential Loop (for...of) to avoid rate limits
        for (const tenant of tenants) {
            try {
                if (!tenant.client_id || !tenant.client_secret) {
                    throw new Error("Azure client credentials are not configured for this tenant.");
                }

                // Call Billing/Consumption module
                const totalCost = await getYesterdaysCost(tenant.id);

                // Cache the cost snapshot
                await insertCostSnapshot(tenant.id, yesterdayStr, totalCost, 'USD');

                // Update tenant health status to OK
                await updateTenantHealth(tenant.id, 'OK');

                tenantCount++;
            } catch (err: any) {
                console.error(`Cron sync error for tenant ${tenant.id}:`, err.message);
                // Update tenant health status to ERROR
                await updateTenantHealth(tenant.id, 'ERROR', err.message);
            }
        }

        return NextResponse.json({
            status: 'Sync completed',
            processed: tenantCount
        });

    } catch (e: any) {
        console.error("Cron sync fatal failure:", e);
        return NextResponse.json({ error: "Internal Server Error", details: e.message }, { status: 500 });
    }
}

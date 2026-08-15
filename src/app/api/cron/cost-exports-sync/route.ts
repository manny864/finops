import { NextRequest, NextResponse } from "next/server";
import { ingestCostExportsForTenant } from "@/services/costExportIngestionService";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { recordCronRun } from "@/lib/cronRunTracker";

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return false;
    return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const [rows]: any = await pool.query("SELECT tenant_id FROM Tenants");
        const tenants = (rows as any[]).map(r => r.tenant_id).filter(t => !isMockTenant(t));

        const results = [];
        for (const tenantId of tenants) {
            const res = await ingestCostExportsForTenant(tenantId);
            results.push(res);
        }

        await recordCronRun({
            cronName: "cost-exports-sync",
            status: "ok",
            summary: `Ingestados ${tenants.length} tenants`,
            details: { tenantsProcessed: tenants.length, results }
        });

        return NextResponse.json({
            success: true,
            tenantsCount: tenants.length,
            results
        });
    } catch (err: any) {
        console.error("[Cron Cost Exports Sync] Error:", err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

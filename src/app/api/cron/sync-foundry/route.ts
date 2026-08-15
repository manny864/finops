import { NextRequest, NextResponse } from "next/server";
import { syncFoundrySnapshots } from "@/modules/collectors/azure/foundryCollector";
import pool from "@/modules/storage/db";

/**
 * GET /api/cron/sync-foundry
 * Synchronize Azure AI Foundry model deployment profiles and costs across all tenants.
 * Requires: CRON_SECRET in Authorization header
 * Timing: Run every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[sync-foundry] Starting Foundry snapshots sync...");

    // Fetch all active tenants
    const [tenants]: any = await pool.query(
      `SELECT DISTINCT tenantId FROM TenantSubscriptions WHERE status = 'active' LIMIT 100`,
      []
    );

    if (!tenants || tenants.length === 0) {
      console.log("[sync-foundry] No active tenants found");
      return NextResponse.json({ success: true, tenantsProcessed: 0, message: "No active tenants" });
    }

    console.log(`[sync-foundry] Processing ${tenants.length} tenants...`);
    let processed = 0;
    let failed = 0;

    for (const { tenantId } of tenants) {
      try {
        await syncFoundrySnapshots(tenantId);
        processed++;
      } catch (err) {
        console.error(`[sync-foundry] Failed for tenant ${tenantId}:`, err);
        failed++;
      }
    }

    console.log(`[sync-foundry] Completed: ${processed} succeeded, ${failed} failed`);

    return NextResponse.json({
      success: true,
      tenantsProcessed: processed,
      tenantsFailed: failed,
      message: `Synced ${processed} tenants, ${failed} failed`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[sync-foundry] Cron error:", error);
    return NextResponse.json(
      { error: "Cron execution failed", details: error.message },
      { status: 500 }
    );
  }
}

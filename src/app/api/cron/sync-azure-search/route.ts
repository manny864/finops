import { NextRequest, NextResponse } from "next/server";
import { syncAzureSearchSnapshots } from "@/modules/collectors/azure/azureSearchCollector";
import pool from "@/modules/storage/db";

/**
 * Cron job: sync Azure Search resource inventory, metrics, costs.
 * Protected by CRON_SECRET in Authorization header.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("Authorization") || "";

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT id FROM Tenants WHERE azure_subscription_id IS NOT NULL AND deleted_at IS NULL`
    );
    const tenants = rows as Array<{ id: string }>;

    console.log(`[sync-azure-search] Syncing ${tenants.length} tenants...`);

    for (const tenant of tenants) {
      try {
        await syncAzureSearchSnapshots(tenant.id);
        console.log(`[sync-azure-search] ✓ ${tenant.id}`);
      } catch (err) {
        console.error(`[sync-azure-search] ✗ ${tenant.id}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${tenants.length} tenants`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[sync-azure-search] Failed:", err);
    return NextResponse.json({ error: "Cron failed", details: String(err) }, { status: 500 });
  }
}


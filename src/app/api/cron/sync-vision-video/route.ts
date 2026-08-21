import { NextRequest, NextResponse } from "next/server";
import { syncVisionVideoSnapshots } from "@/modules/collectors/azure/aiServiceCollectors";
import pool from "@/modules/storage/db";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [rows] = await pool.query(`SELECT DISTINCT id FROM Tenants WHERE azure_subscription_id IS NOT NULL AND deleted_at IS NULL`);
    for (const tenant of rows as Array<{ id: string }>) {
      try { await syncVisionVideoSnapshots(tenant.id); } catch (err) { console.error(`sync-vision-video ${tenant.id}:`, err); }
    }
    return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}

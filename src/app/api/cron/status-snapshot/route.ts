import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";

type ComponentStatus = "operational" | "degraded" | "down";
type OverallStatus = "operational" | "degraded" | "down";

interface Component {
  name: string;
  status: ComponentStatus;
  latency_ms?: number;
}

async function checkDatabaseHealth(): Promise<{ status: ComponentStatus; latency_ms: number }> {
  try {
    const start = Date.now();
    await pool.query("SELECT 1");
    const latency_ms = Date.now() - start;
    if (latency_ms > 500) {
      return { status: "degraded", latency_ms };
    }
    return { status: "operational", latency_ms };
  } catch (e) {
    console.error("Database health check failed:", e);
    return { status: "down", latency_ms: -1 };
  }
}

async function checkAzureSyncHealth(): Promise<{ status: ComponentStatus; ratio: number }> {
  try {
    const [rows]: any = await pool.query(
      `SELECT COUNT(*) as total, 
              SUM(CASE WHEN sync_status='OK' THEN 1 ELSE 0 END) as ok_count
       FROM Tenants`
    );
    if (!rows || rows.length === 0 || rows[0].total === 0) {
      return { status: "operational", ratio: 1.0 };
    }
    const ratio = rows[0].ok_count / rows[0].total;
    return { status: ratio >= 0.5 ? "operational" : "degraded", ratio };
  } catch (e) {
    console.error("Azure sync health check failed:", e);
    return { status: "degraded", ratio: 0 };
  }
}

async function checkAIProviderHealth(): Promise<ComponentStatus> {
  const geminiKey = process.env.GEMINI_API_KEY || "";
  if (!geminiKey || geminiKey.toLowerCase().includes("placeholder") || geminiKey.trim().length === 0) {
    return "degraded";
  }
  return "operational";
}

async function checkPaddleBillingHealth(): Promise<ComponentStatus> {
  const paddleKey = process.env.PADDLE_API_KEY || "";
  if (!paddleKey || paddleKey.toLowerCase().includes("placeholder") || paddleKey.trim().length === 0) {
    return "degraded";
  }
  return "operational";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Verify cron secret
    const secret = request.nextUrl.searchParams.get("secret");
    const cronSecret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
    if (!cronSecret || secret !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initializeDatabase();

    // Check all components
    const dbCheck = await checkDatabaseHealth();
    const azureCheck = await checkAzureSyncHealth();
    const aiCheck = await checkAIProviderHealth();
    const paddleCheck = await checkPaddleBillingHealth();

    const components: Component[] = [
      { name: "API", status: "operational" },
      { name: "Database", status: dbCheck.status, latency_ms: dbCheck.latency_ms },
      { name: "Azure Sync", status: azureCheck.status },
      { name: "AI Provider", status: aiCheck },
      { name: "Paddle Billing", status: paddleCheck },
    ];

    // Calculate overall status
    let overallStatus: OverallStatus = "operational";
    if (components.some((c) => c.status === "down")) {
      overallStatus = "down";
    } else if (components.some((c) => c.status === "degraded")) {
      overallStatus = "degraded";
    }

    // Insert snapshot into database
    await pool.query(
      `INSERT INTO PlatformStatusSnapshots (overall_status, db_latency_ms, azure_sync_ratio, components_json)
       VALUES (?, ?, ?, ?)`,
      [overallStatus, dbCheck.latency_ms, azureCheck.ratio, JSON.stringify(components)]
    );

    // Calculate uptime
    const [rows]: any = await pool.query(
      `SELECT 
        COUNT(CASE WHEN overall_status='operational' THEN 1 END) as operational_count,
        COUNT(*) as total_count
       FROM PlatformStatusSnapshots
       WHERE captured_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    const uptime =
      rows && rows.length > 0 && rows[0].total_count > 0 ? (rows[0].operational_count / rows[0].total_count) * 100 : 100.0;

    return NextResponse.json({
      success: true,
      overall_status: overallStatus,
      uptime_30d_pct: Math.round(uptime * 100) / 100,
    });
  } catch (e) {
    console.error("Snapshot capture error:", e);
    return NextResponse.json({ error: "Failed to capture snapshot" }, { status: 500 });
  }
}

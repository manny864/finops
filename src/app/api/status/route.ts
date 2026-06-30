import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";

type ComponentStatus = "operational" | "degraded" | "down";
type OverallStatus = "operational" | "degraded" | "down";

interface Component {
  name: string;
  status: ComponentStatus;
  latency_ms?: number;
}

interface StatusResponse {
  status: OverallStatus;
  timestamp: string;
  components: Component[];
  uptime_30d_pct: number;
  incidents_last_30d: number;
  version: string;
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

async function checkAzureSyncHealth(): Promise<ComponentStatus> {
  try {
    const [rows]: any = await pool.query(
      `SELECT COUNT(*) as total, 
              SUM(CASE WHEN sync_status='OK' THEN 1 ELSE 0 END) as ok_count
       FROM Tenants`
    );
    if (!rows || rows.length === 0 || rows[0].total === 0) {
      return "operational"; // No tenants yet
    }
    const ratio = rows[0].ok_count / rows[0].total;
    return ratio >= 0.5 ? "operational" : "degraded";
  } catch (e) {
    console.error("Azure sync health check failed:", e);
    return "degraded";
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

async function calculateUptime30d(): Promise<number> {
  try {
    // Count operational snapshots in the last 30 days
    const [rows]: any = await pool.query(
      `SELECT 
        COUNT(CASE WHEN overall_status='operational' THEN 1 END) as operational_count,
        COUNT(*) as total_count
       FROM PlatformStatusSnapshots
       WHERE captured_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    if (!rows || rows.length === 0 || rows[0].total_count === 0) {
      return 100.0; // No data yet, assume operational
    }

    const uptime = (rows[0].operational_count / rows[0].total_count) * 100;
    return Math.round(uptime * 100) / 100; // Round to 2 decimals
  } catch (e) {
    console.error("Uptime calculation failed:", e);
    return 100.0;
  }
}

async function getIncidentsCount30d(): Promise<number> {
  try {
    const [rows]: any = await pool.query(
      `SELECT COUNT(*) as incident_count
       FROM PlatformIncidents
       WHERE started_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
    return rows && rows.length > 0 ? rows[0].incident_count : 0;
  } catch (e) {
    console.error("Incidents count failed:", e);
    return 0;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await initializeDatabase();

    // Check all components
    const dbCheck = await checkDatabaseHealth();
    const azureCheck = await checkAzureSyncHealth();
    const aiCheck = await checkAIProviderHealth();
    const paddleCheck = await checkPaddleBillingHealth();

    const components: Component[] = [
      { name: "API", status: "operational" }, // Trivially operational if endpoint responds
      { name: "Database", status: dbCheck.status, latency_ms: dbCheck.latency_ms },
      { name: "Azure Sync", status: azureCheck },
      { name: "AI Provider", status: aiCheck },
      { name: "Paddle Billing", status: paddleCheck },
    ];

    // Calculate overall status (worst of components)
    let overallStatus: OverallStatus = "operational";
    if (components.some((c) => c.status === "down")) {
      overallStatus = "down";
    } else if (components.some((c) => c.status === "degraded")) {
      overallStatus = "degraded";
    }

    const uptime = await calculateUptime30d();
    const incidents = await getIncidentsCount30d();

    const response: StatusResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      components,
      uptime_30d_pct: uptime,
      incidents_last_30d: incidents,
      version: process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || "b4debae",
    };

    return NextResponse.json(response, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (e) {
    console.error("Status endpoint error:", e);
    return NextResponse.json(
      { error: "Failed to retrieve status" },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}

// Handle CORS preflight
export async function OPTIONS(): Promise<NextResponse> {
  return NextResponse.json(
    {},
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    }
  );
}

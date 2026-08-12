import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";

const CRON_SECRET = process.env.CRON_SECRET || "unsafe-default";

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !timingSafeCompare(token, CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [tenants]: any = await pool.query(
      "SELECT id FROM Tenants WHERE tier = 'Enterprise' LIMIT 100"
    );

    if (!tenants || tenants.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Enterprise tenants found",
        count: 0,
        timestamp: new Date().toISOString(),
      });
    }

    const results = await Promise.allSettled(
      tenants.map(async (tenant: any) => {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
          const res = await fetch(`${baseUrl}/api/intelligence/azure-ai?tenantId=${tenant.id}`, {
            headers: { "X-Cron-Auth": CRON_SECRET },
            cache: "no-store",
          });

          if (!res.ok) {
            console.warn(`Azure AI sync failed for tenant ${tenant.id}: ${res.status}`);
            return { tenantId: tenant.id, cached: false, error: res.statusText };
          }

          const data = await res.json();
          return { tenantId: tenant.id, cached: !data.mock, capCount: data.capabilities?.length || 0 };
        } catch (err) {
          console.error(`Azure AI sync error for tenant ${tenant.id}:`, err);
          return { tenantId: tenant.id, cached: false, error: String(err) };
        }
      })
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.cached).length;

    return NextResponse.json({
      success: true,
      message: "Azure AI sync completed",
      total: tenants.length,
      cached: successful,
      results: results.map((r) => (r.status === "fulfilled" ? r.value : { error: r.reason })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Azure AI cron job error:", error);
    return NextResponse.json(
      { error: "Internal server error", message: error?.message },
      { status: 500 }
    );
  }
}

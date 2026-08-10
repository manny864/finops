import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";

export const dynamic = "force-dynamic";

const SERVICE_COST_FAMILIES = ["managed-disks", "backups", "data-lake-gen2"] as const;

export async function GET(request: NextRequest) {
  return runPrewarmStorage(request);
}

export async function POST(request: NextRequest) {
  return runPrewarmStorage(request);
}

async function runPrewarmStorage(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.length < 16) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const [tenants] = await pool.query<any[]>(
      'SELECT tenant_id AS id FROM Tenants WHERE status = "active"'
    );

    const origin = getInternalBaseUrl();
    const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };
    const results: Array<{ tenantId: string; endpoint: string; ok: boolean; ms: number; error?: string }> = [];

    for (const tenant of tenants) {
      const requests = [
        `${origin}/api/intelligence/storage-efficiency?tenantId=${encodeURIComponent(tenant.id)}&days=30`,
        ...SERVICE_COST_FAMILIES.map(
          (family) =>
            `${origin}/api/intelligence/storage/service-cost?tenantId=${encodeURIComponent(tenant.id)}&family=${family}`
        ),
      ];

      for (const endpoint of requests) {
        const start = Date.now();
        try {
          const res = await fetch(endpoint, { headers, cache: "no-store" });
          const ms = Date.now() - start;
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            results.push({
              tenantId: tenant.id,
              endpoint,
              ok: false,
              ms,
              error: `HTTP ${res.status}: ${detail.slice(0, 200)}`,
            });
            continue;
          }
          results.push({ tenantId: tenant.id, endpoint, ok: true, ms });
        } catch (error: unknown) {
          results.push({
            tenantId: tenant.id,
            endpoint,
            ok: false,
            ms: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const ok = results.filter((r) => r.ok).length;
    return NextResponse.json({
      status: "Storage FinOps prewarm completed",
      total: results.length,
      ok,
      failed: results.length - ok,
      results,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}


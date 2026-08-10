import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";

export const dynamic = "force-dynamic";

const DATABASE_ENDPOINTS = [
    "cosmos-diagnostics",
    "sql-diagnostics",
    "postgres-diagnostics",
    "mysql-diagnostics",
    "mongo-diagnostics",
    "redis-diagnostics",
    "redis-metrics",
    "mysql-metrics",
] as const;

export async function GET(request: NextRequest) {
    return runPrewarmDatabases(request);
}

export async function POST(request: NextRequest) {
    return runPrewarmDatabases(request);
}

async function runPrewarmDatabases(request: NextRequest) {
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
            'SELECT tenant_id AS id, company_name AS name FROM Tenants WHERE status = "active"'
        );

        const origin = getInternalBaseUrl();
        const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };
        const results: Array<{
            tenantId: string;
            endpoint: string;
            ok: boolean;
            ms: number;
            error?: string;
        }> = [];

        for (const tenant of tenants) {
            for (const endpoint of DATABASE_ENDPOINTS) {
                const start = Date.now();
                try {
                    const url = `${origin}/api/intelligence/databases/${endpoint}?tenantId=${encodeURIComponent(tenant.id)}`;
                    const res = await fetch(url, { headers, cache: "no-store" });
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
                    const ms = Date.now() - start;
                    results.push({
                        tenantId: tenant.id,
                        endpoint,
                        ok: false,
                        ms,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }

        const okCount = results.filter((r) => r.ok).length;
        return NextResponse.json({
            status: "Databases prewarm completed",
            total: results.length,
            ok: okCount,
            failed: results.length - okCount,
            results,
        });
    } catch (error: unknown) {
        return NextResponse.json(
            { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

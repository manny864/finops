import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { recordCronRun } from "@/lib/cronRunTracker";

export const dynamic = "force-dynamic";

const SECURITY_FAMILIES = ["sentinel", "key-vault", "entra-id", "waf", "ddos"] as const;

export async function GET(request: NextRequest) {
    return runPrewarmSecurity(request);
}

export async function POST(request: NextRequest) {
    return runPrewarmSecurity(request);
}

async function runPrewarmSecurity(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }

        if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const [tenants] = await pool.query<any[]>(
            'SELECT tenant_id AS id FROM Tenants WHERE status = "active"'
        );

        const origin = getInternalBaseUrl();
        const headers = { "X-Cron-Auth": cronSecret };
        const results: Array<{ tenantId: string; endpoint: string; ok: boolean; ms: number; error?: string }> = [];

        for (const tenant of tenants) {
            const endpoints = [
                `${origin}/api/intelligence/defender?tenantId=${encodeURIComponent(tenant.id)}`,
                ...SECURITY_FAMILIES.map(
                    (family) =>
                        `${origin}/api/intelligence/security/service-cost?tenantId=${encodeURIComponent(tenant.id)}&family=${family}`
                ),
            ];

            for (const endpoint of endpoints) {
                const started = Date.now();
                try {
                    const res = await fetch(endpoint, { headers, cache: "no-store" });
                    const ms = Date.now() - started;
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
                        ms: Date.now() - started,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }

        const ok = results.filter((r) => r.ok).length;
        const response = {
            status: "Security FinOps prewarm completed",
            total: results.length,
            ok,
            failed: results.length - ok,
            results,
        };

        await recordCronRun({
            cronName: "prewarm-security-finops",
            status: results.length - ok > 0 ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `total=${results.length} ok=${ok} failed=${results.length - ok}`,
            details: response as unknown as Record<string, unknown>,
        });

        return NextResponse.json(response);
    } catch (error: unknown) {
        await recordCronRun({
            cronName: "prewarm-security-finops",
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: error instanceof Error ? error.message : "cron failed",
            details: { error: error instanceof Error ? error.message : String(error) },
        });
        return NextResponse.json(
            { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

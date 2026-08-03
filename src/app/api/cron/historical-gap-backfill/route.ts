import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { backfillTenantHistoricalGaps } from "@/lib/historicalGapBackfill";
import { recordCronRun } from "@/lib/cronRunTracker";

export async function GET(request: NextRequest) {
    return runBackfill(request);
}

export async function POST(request: NextRequest) {
    return runBackfill(request);
}

async function runBackfill(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        // Todos los tenants activos — incluye automáticamente los que se
        // sumen al SaaS a futuro, misma query que /api/cron/sync.
        const [tenants] = await pool.query<any[]>(
            'SELECT tenant_id as id FROM Tenants WHERE status = "active"'
        );

        let tenantsProcessed = 0;
        let detailedRowsUpserted = 0;
        let dailyRowsUpserted = 0;
        const tenantErrors: Record<string, string> = {};

        // Secuencial (no Promise.all) — mismo criterio que /api/cron/sync:
        // correr todos los tenants en paralelo amplificaría el 429 de Cost
        // Management en vez de evitarlo.
        for (const tenant of tenants) {
            try {
                const result = await backfillTenantHistoricalGaps(tenant.id);
                detailedRowsUpserted += result.detailedRowsUpserted;
                dailyRowsUpserted += result.dailyRowsUpserted;
                tenantsProcessed++;
            } catch (err: any) {
                console.error(`[historical-gap-backfill] tenant=${tenant.id} failed:`, err.message);
                tenantErrors[tenant.id] = err.message;
            }
        }

        const response = {
            status: "Historical gap backfill completed",
            tenantsTotal: tenants.length,
            tenantsProcessed,
            detailedRowsUpserted,
            dailyRowsUpserted,
            tenantErrors,
        };
        await recordCronRun({
            cronName: "historical-gap-backfill",
            status: Object.keys(tenantErrors).length > 0 ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `processed=${tenantsProcessed}/${tenants.length}`,
            details: response as unknown as Record<string, unknown>,
        });
        return NextResponse.json(response);
    } catch (e: any) {
        console.error("Historical gap backfill fatal failure:", e);
        await recordCronRun({
            cronName: "historical-gap-backfill",
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: e?.message || "cron failed",
            details: { error: e?.message || String(e) },
        });
        return NextResponse.json({ error: "Internal Server Error", details: e.message }, { status: 500 });
    }
}

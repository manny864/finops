import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const [rows] = await pool.query(
            `SELECT id, target_endpoint, concurrency, duration_ms, total_requests, success_count, error_count,
                    p50_ms, p95_ms, p99_ms, max_ms, throughput_rps, triggered_by, created_at
             FROM LoadTestRuns ORDER BY created_at DESC LIMIT 30`
        );

        return NextResponse.json({ success: true, runs: rows });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/load-test/runs] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

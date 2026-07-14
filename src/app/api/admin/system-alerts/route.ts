import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const { searchParams } = new URL(request.url);
        const onlyUnacknowledged = searchParams.get('unacknowledged') === 'true';

        const query = onlyUnacknowledged
            ? `SELECT id, severity, source, message, detail, load_test_run_id, acknowledged_at, acknowledged_by, created_at
               FROM SystemAlerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 100`
            : `SELECT id, severity, source, message, detail, load_test_run_id, acknowledged_at, acknowledged_by, created_at
               FROM SystemAlerts ORDER BY created_at DESC LIMIT 100`;

        const [rows] = await pool.query(query);

        return NextResponse.json({ success: true, alerts: rows });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/system-alerts] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        await initializeDatabase();
        const identity = await requireSuperAdmin(request);
        const { id } = await params;

        await pool.query(
            `UPDATE SystemAlerts SET acknowledged_at = NOW(), acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL`,
            [identity.email, id]
        );

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/system-alerts/ack] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

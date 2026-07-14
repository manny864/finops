import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const sinceId = Number(searchParams.get("sinceId")) || 0;
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, notifications: [] });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [rows] = await pool.query(
            `SELECT id, title, message, href, severity, source, created_at
             FROM Notifications
             WHERE tenant_id = ? AND id > ?
             ORDER BY id DESC LIMIT 20`,
            [tenantId, sinceId]
        );

        return NextResponse.json({ success: true, notifications: rows });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[api/notifications] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

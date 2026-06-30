import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool, { initializeDatabase } from "@/modules/storage/db";

/** GET /api/advisor/suppressions?tenantId=X → suppressions activas. */
export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        // Auto-expira las que ya vencieron
        await pool.query(
            `UPDATE RecommendationActions SET status='open', updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=? AND status='suppressed' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
            [tenantId]
        );

        const [rows]: any = await pool.query(
            `SELECT recommendation_id AS recommendationId, category, resource_id AS resourceId,
                    user_email AS suppressedBy, reason, expires_at AS expiresAt, updated_at AS updatedAt
             FROM RecommendationActions
             WHERE tenant_id=? AND status='suppressed'
               AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
             ORDER BY updated_at DESC`,
            [tenantId]
        );
        return NextResponse.json({ success: true, suppressions: rows });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[suppressions] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool, { initializeDatabase } from "@/modules/storage/db";

/**
 * IT-06 — Recommendation Suppression.
 * POST /api/advisor/suppress
 * Body: { tenantId, recommendationId, category?, resourceId?, reason?, durationDays? }
 *   durationDays: 7|30|90; omitido = permanente (NULL).
 */
export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const body = await request.json();
        const { tenantId, recommendationId, category, resourceId, reason, durationDays } = body;
        if (!tenantId || !recommendationId) {
            return NextResponse.json({ error: "Faltan tenantId / recommendationId" }, { status: 400 });
        }

        const identity = await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
        const email = identity.email;

        const expiresClause = durationDays && Number(durationDays) > 0
            ? `DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${Math.floor(Number(durationDays))} DAY)`
            : "NULL";

        await pool.query(
            `INSERT INTO RecommendationActions (tenant_id, recommendation_id, category, resource_id, status, user_email, reason, expires_at)
             VALUES (?, ?, ?, ?, 'suppressed', ?, ?, ${expiresClause})
             ON DUPLICATE KEY UPDATE status='suppressed', user_email=VALUES(user_email), reason=VALUES(reason), expires_at=${expiresClause}, updated_at=CURRENT_TIMESTAMP`,
            [tenantId, recommendationId, category || null, resourceId || null, email, reason || null]
        );

        return NextResponse.json({ success: true, recommendationId, suppressedUntil: durationDays ? `+${durationDays}d` : "permanent" });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[suppress] error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/**
 * DELETE /api/advisor/suppress?tenantId=X&recommendationId=Y → reactiva (status='open').
 */
export async function DELETE(request: NextRequest) {
    try {
        await initializeDatabase();
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const recommendationId = request.nextUrl.searchParams.get("recommendationId");
        if (!tenantId || !recommendationId) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        await pool.query(
            `UPDATE RecommendationActions SET status='open', expires_at=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=? AND recommendation_id=? AND status='suppressed'`,
            [tenantId, recommendationId]
        );
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[suppress DELETE] error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

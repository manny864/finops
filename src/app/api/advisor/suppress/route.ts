import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
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

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) return NextResponse.json({ error: "Token inválido" }, { status: 401 });
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

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
    } catch (e: any) {
        console.error("[suppress] error:", e);
        return NextResponse.json({ error: "Error al suprimir recomendación", details: e.message }, { status: 500 });
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

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) return NextResponse.json({ error: "Token inválido" }, { status: 401 });
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

        await pool.query(
            `UPDATE RecommendationActions SET status='open', expires_at=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=? AND recommendation_id=? AND status='suppressed'`,
            [tenantId, recommendationId]
        );
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: "Error", details: e.message }, { status: 500 });
    }
}

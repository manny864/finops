import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool, { initializeDatabase } from "@/modules/storage/db";

/** GET /api/advisor/suppressions?tenantId=X → suppressions activas. */
export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) return NextResponse.json({ error: "Token inválido" }, { status: 401 });
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });

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
    } catch (e: any) {
        return NextResponse.json({ error: "Error", details: e.message }, { status: 500 });
    }
}

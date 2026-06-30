import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool, { initializeDatabase } from "@/modules/storage/db";

/**
 * IT-05 — Cost Optimization Implementation Number (COIN).
 *
 * COIN = (# recomendaciones implementadas en ventana) / (# total recomendaciones gestionadas) * 100.
 *
 * GET /api/intelligence/kpis/coin?tenantId=X&days=90
 * Devuelve global + breakdown por category, + serie mensual últimos `days` días.
 */
export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        const days = Math.max(1, Math.min(365, Number(request.nextUrl.searchParams.get("days") || 90)));

        await requireTenantAccess(request, tenantId);

        const [globalRows]: any = await pool.query(
            `SELECT
                SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented,
                SUM(CASE WHEN status='suppressed' THEN 1 ELSE 0 END) AS suppressed,
                SUM(CASE WHEN status='dismissed' THEN 1 ELSE 0 END) AS dismissed,
                SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS accepted,
                COUNT(*) AS total
             FROM RecommendationActions
             WHERE tenant_id=? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)`,
            [tenantId, days]
        );
        const g = globalRows[0] || {};
        const total = Number(g.total || 0);
        const implemented = Number(g.implemented || 0);
        const coin = total > 0 ? Math.round((implemented / total) * 1000) / 10 : 0;

        const [byCat]: any = await pool.query(
            `SELECT COALESCE(category, 'Other') AS category,
                    SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented,
                    COUNT(*) AS total
             FROM RecommendationActions
             WHERE tenant_id=? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
             GROUP BY category`,
            [tenantId, days]
        );
        const breakdown = (byCat as any[]).map(r => ({
            category: r.category,
            implemented: Number(r.implemented || 0),
            total: Number(r.total || 0),
            coin: Number(r.total || 0) > 0 ? Math.round((Number(r.implemented || 0) / Number(r.total)) * 1000) / 10 : 0,
        }));

        const [series]: any = await pool.query(
            `SELECT DATE_FORMAT(updated_at, '%Y-%m') AS month,
                    SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented,
                    COUNT(*) AS total
             FROM RecommendationActions
             WHERE tenant_id=? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
             GROUP BY month ORDER BY month ASC`,
            [tenantId, days]
        );
        const monthly = (series as any[]).map(r => ({
            month: r.month,
            coin: Number(r.total) > 0 ? Math.round((Number(r.implemented) / Number(r.total)) * 1000) / 10 : 0,
            implemented: Number(r.implemented || 0),
            total: Number(r.total || 0),
        }));

        return NextResponse.json({
            success: true,
            windowDays: days,
            coin,
            implemented,
            total,
            suppressed: Number(g.suppressed || 0),
            dismissed: Number(g.dismissed || 0),
            accepted: Number(g.accepted || 0),
            breakdown,
            monthly,
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[coin] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/**
 * POST /api/intelligence/kpis/coin
 * Body: { tenantId, recommendationId, status, category?, resourceId?, reason? }
 * Hook para que la página de remediación marque acciones como 'implemented' / 'accepted' / 'dismissed'.
 */
export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const body = await request.json();
        const { tenantId, recommendationId, status, category, resourceId, reason } = body;
        if (!tenantId || !recommendationId || !status) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
        const validStatus = ["open", "accepted", "implemented", "dismissed", "suppressed"];
        if (!validStatus.includes(status)) return NextResponse.json({ error: "status inválido" }, { status: 400 });

        const identity = await requireTenantAccess(request, tenantId);
        const email = identity.email;

        await pool.query(
            `INSERT INTO RecommendationActions (tenant_id, recommendation_id, category, resource_id, status, user_email, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status=VALUES(status), category=COALESCE(VALUES(category), category),
                                     resource_id=COALESCE(VALUES(resource_id), resource_id),
                                     user_email=VALUES(user_email), reason=COALESCE(VALUES(reason), reason),
                                     updated_at=CURRENT_TIMESTAMP`,
            [tenantId, recommendationId, category || null, resourceId || null, status, email, reason || null]
        );
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[coin] POST error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

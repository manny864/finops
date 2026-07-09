import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";

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

        // Índice de Optimización (COIN) es feature Professional.
        await requireTenantTier(request, tenantId, "Professional");

        if (isMockTenant(tenantId)) {
            const breakdown = [
                { category: "Cost", implemented: 18, total: 24, coin: 75 },
                { category: "Performance", implemented: 6, total: 12, coin: 50 },
                { category: "Reliability", implemented: 4, total: 9, coin: 44.4 },
                { category: "Security", implemented: 9, total: 10, coin: 90 },
            ];
            const totalImplemented = breakdown.reduce((s, b) => s + b.implemented, 0);
            const totalAll = breakdown.reduce((s, b) => s + b.total, 0);
            const monthly = Array.from({ length: 6 }).map((_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() - (5 - i));
                const total = 8 + i * 2;
                const implemented = Math.round(total * (0.5 + i * 0.07));
                return { month: d.toISOString().slice(0, 7), coin: Math.round((implemented / total) * 1000) / 10, implemented, total };
            });
            return NextResponse.json({
                success: true, mock: true, windowDays: days,
                coin: Math.round((totalImplemented / totalAll) * 1000) / 10,
                implemented: totalImplemented, total: totalAll,
                suppressed: 3, dismissed: 2, accepted: 5,
                breakdown, monthly,
            });
        }

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
        const { tenantId, recommendationId, status, category, resourceId, reason, snoozeDays } = body;
        if (!tenantId || !recommendationId || !status) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
        const validStatus = ["open", "accepted", "implemented", "dismissed", "suppressed"];
        if (!validStatus.includes(status)) return NextResponse.json({ error: "status inválido" }, { status: 400 });

        // Supresión de Recomendaciones (Snooze) es feature Professional.
        await requireTenantTier(request, tenantId, "Professional");
        const identity = await requireTenantAccess(request, tenantId);
        const email = identity.email;

        // snoozeDays: solo aplica cuando status='suppressed'. Sin snoozeDays,
        // la supresión queda permanente (expires_at NULL) hasta que se reabra
        // a mano. Con snoozeDays, expira sola y el recordatorio vuelve a
        // aparecer (ver auto-expiración en /api/advisor GET).
        const expiresAt = status === "suppressed" && Number(snoozeDays) > 0
            ? new Date(Date.now() + Number(snoozeDays) * 86400000)
            : null;

        await pool.query(
            `INSERT INTO RecommendationActions (tenant_id, recommendation_id, category, resource_id, status, user_email, reason, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status=VALUES(status), category=COALESCE(VALUES(category), category),
                                     resource_id=COALESCE(VALUES(resource_id), resource_id),
                                     user_email=VALUES(user_email), reason=COALESCE(VALUES(reason), reason),
                                     expires_at=VALUES(expires_at),
                                     updated_at=CURRENT_TIMESTAMP`,
            [tenantId, recommendationId, category || null, resourceId || null, status, email, reason || null, expiresAt]
        );
        return NextResponse.json({ success: true, expiresAt });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[coin] POST error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

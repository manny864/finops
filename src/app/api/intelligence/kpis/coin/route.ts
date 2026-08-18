import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { getCoinIndexSummary } from "@/services/coinIndexService";

/**
 * IT-05 — Cost Optimization Implementation Number (COIN).
 *
 * COIN = (# recomendaciones implementadas en ventana) / (# total recomendaciones gestionadas) * 100.
 *
 * GET /api/intelligence/kpis/coin?tenantId=X&days=90
 * Devuelve global + breakdown por category WAF, estado exhaustivo de recomendaciones y serie mensual.
 */
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        const days = Math.max(1, Math.min(365, Number(request.nextUrl.searchParams.get("days") || 90)));

        // Índice de Optimización (COIN) es feature Professional.
        await requireTenantTier(request, tenantId, "Professional");
        await requireTenantAccess(request, tenantId);

        const summary = await getCoinIndexSummary(tenantId, days);
        return NextResponse.json(summary);
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

import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

/**
 * GET /api/intelligence/tenant-health?tenantId=X
 *
 * "Dashboard de Salud del Tenant" (feature Professional) — score compuesto
 * 0-100 que combina señales ya persistidas en la plataforma:
 *  - Cumplimiento de presupuesto (TenantMonthlyBudgets vs CostSnapshots del mes)
 *  - Credenciales por expirar (ExpiringCredentials, ventana de 30 días)
 *  - Índice de Optimización / COIN (RecommendationActions implementadas vs total)
 *  - Postura de seguridad (% de Admins con MFA activo, Users.mfa_enabled)
 *
 * No incluye (todavía) cumplimiento de etiquetas ni conteo de recursos zombie
 * en vivo: esas señales requieren la misma consulta a Azure Resource Graph
 * que ya hacen /api/tags/compliance y /api/dashboard/summary — reusarlas acá
 * sin duplicar esa lógica queda para una iteración siguiente (ver TODO abajo).
 */

const WEIGHTS = { budget: 30, credentials: 25, optimization: 25, security: 20 };

function scoreToGrade(score: number): string {
    if (score >= 85) return "A";
    if (score >= 70) return "B";
    if (score >= 50) return "C";
    return "D";
}

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Dashboard de Salud del Tenant es feature Professional.
        await requireTenantTier(request, tenantId, "Professional");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("tenant_health", tenantId));
        }

        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        // ── Presupuesto ──────────────────────────────────────────────────
        const [budgetRows]: any = await pool.query(
            `SELECT budget_usd FROM TenantMonthlyBudgets WHERE tenant_id=? AND budget_month=? AND budget_year=? LIMIT 1`,
            [tenantId, month, year]
        );
        const [spendRows]: any = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS spend
             FROM CostSnapshots
             WHERE tenant_id=? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')`,
            [tenantId]
        );
        const budgetUsd = budgetRows[0]?.budget_usd != null ? Number(budgetRows[0].budget_usd) : null;
        const spend = Number(spendRows[0]?.spend || 0);
        const burnPct = budgetUsd && budgetUsd > 0 ? (spend / budgetUsd) * 100 : null;
        // Sin presupuesto configurado: score neutro (no penaliza a un tenant nuevo).
        const budgetScore = burnPct === null
            ? 70
            : Math.round(Math.max(0, 100 - Math.max(0, burnPct - 100) * 2));

        // ── Credenciales por expirar (ventana 30 días) ──────────────────
        const [credRows]: any = await pool.query(
            `SELECT COUNT(*) AS cnt FROM ExpiringCredentials
             WHERE tenant_id=? AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)`,
            [tenantId]
        );
        const expiringCount = Number(credRows[0]?.cnt || 0);
        const credentialsScore = Math.max(0, 100 - expiringCount * 15);

        // ── Índice de Optimización (COIN) ────────────────────────────────
        const [coinRows]: any = await pool.query(
            `SELECT
                SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented,
                COUNT(*) AS total
             FROM RecommendationActions
             WHERE tenant_id=? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 90 DAY)`,
            [tenantId]
        );
        const coinTotal = Number(coinRows[0]?.total || 0);
        const coinImplemented = Number(coinRows[0]?.implemented || 0);
        // Sin recomendaciones gestionadas todavía: score neutro, no castigamos
        // a un tenant recién onboardeado que aún no tuvo chance de actuar.
        const optimizationScore = coinTotal > 0 ? Math.round((coinImplemented / coinTotal) * 100) : 60;

        // ── MFA en usuarios Admin ────────────────────────────────────────
        const [mfaRows]: any = await pool.query(
            `SELECT SUM(CASE WHEN mfa_enabled=1 THEN 1 ELSE 0 END) AS withMfa, COUNT(*) AS total
             FROM Users WHERE tenant_id=? AND role IN ('Admin')`,
            [tenantId]
        );
        const mfaTotal = Number(mfaRows[0]?.total || 0);
        const mfaWith = Number(mfaRows[0]?.withMfa || 0);
        const securityScore = mfaTotal > 0 ? Math.round((mfaWith / mfaTotal) * 100) : 50;

        const overallScore = Math.round(
            (budgetScore * WEIGHTS.budget +
                credentialsScore * WEIGHTS.credentials +
                optimizationScore * WEIGHTS.optimization +
                securityScore * WEIGHTS.security) / 100
        );

        return NextResponse.json({
            success: true,
            mock: false,
            overallScore,
            grade: scoreToGrade(overallScore),
            signals: [
                {
                    key: "budget", label: "Cumplimiento de Presupuesto", score: budgetScore, weight: WEIGHTS.budget,
                    detail: burnPct === null ? "Sin presupuesto configurado este mes" : `${burnPct.toFixed(0)}% del presupuesto consumido`,
                },
                {
                    key: "credentials", label: "Credenciales por Expirar", score: credentialsScore, weight: WEIGHTS.credentials,
                    detail: `${expiringCount} credencial(es) vencen en los próximos 30 días`,
                },
                {
                    key: "optimization", label: "Índice de Optimización (COIN)", score: optimizationScore, weight: WEIGHTS.optimization,
                    detail: coinTotal > 0 ? `${coinImplemented}/${coinTotal} recomendaciones implementadas (90 días)` : "Sin recomendaciones gestionadas todavía",
                },
                {
                    key: "security", label: "Postura de Seguridad (MFA)", score: securityScore, weight: WEIGHTS.security,
                    detail: mfaTotal > 0 ? `${mfaWith}/${mfaTotal} administradores con MFA activo` : "Sin usuarios Admin registrados",
                },
            ],
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[tenant-health] GET error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

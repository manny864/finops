/**
 * GET /api/intelligence/cost-by-category — desglose de costo por categoría FinOps
 * (Compute/Storage/Networking/Databases/...).
 *
 * Une CostCategorySnapshots.resource_type → OpenDataServices.service_category
 * (Open Data del FinOps Toolkit). El resource_type es la clave de join nativa de
 * FOCUS, con cobertura ~100% (vs. ~75% si se usara el ServiceName de billing).
 *
 * RBAC app: requireTenantAccess (tenant-scoped). Tier: Business (routeTiers).
 * Roles Azure requeridos: NINGUNO en el request (sirve datos ya persistidos por
 * /api/cron/sync, que requiere 'Cost Management Reader' — tier Essential).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

async function runQuery(tenantId: string, days: number) {
    const [rows]: any = await pool.query(
        `SELECT COALESCE(s.cat, 'Other') AS category,
                SUM(c.cost_usd) AS cost
         FROM CostCategorySnapshots c
         LEFT JOIN (
             SELECT resource_type, MAX(service_category) AS cat
             FROM OpenDataServices GROUP BY resource_type
         ) s ON s.resource_type = c.resource_type
         WHERE c.tenant_id = ?
           AND c.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY category`,
        [tenantId, days]
    );
    return rows as Array<{ category: string; cost: string | number }>;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const days = Math.max(1, Math.min(365, parseInt(searchParams.get("days") || "30", 10)));

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        try {
            await requireTenantAccess(request, tenantId);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("cost-by-category", tenantId));
        }

        try {
            // Ventana solicitada; si vacía, ampliar a 90 y luego 365 días.
            let rows = await runQuery(tenantId, days);
            let effectiveDays = days;
            if (rows.length === 0 && days < 90) { rows = await runQuery(tenantId, 90); effectiveDays = 90; }
            if (rows.length === 0) { rows = await runQuery(tenantId, 365); effectiveDays = 365; }

            const parsed = rows
                .map(r => ({ category: r.category || "Other", cost: parseFloat(String(r.cost)) || 0 }))
                .filter(r => r.cost > 0)
                .sort((a, b) => b.cost - a.cost);

            const total = parsed.reduce((s, r) => s + r.cost, 0);
            const categories = parsed.map(r => ({
                category: r.category,
                cost: parseFloat(r.cost.toFixed(2)),
                percent: total > 0 ? Math.round((r.cost / total) * 100) : 0,
            }));

            if (categories.length === 0) {
                return NextResponse.json({
                    success: true, mock: false, empty: true,
                    message: "No se encontraron costos categorizados en los últimos 365 días. Verificá que la sincronización de FinOps haya corrido al menos una vez.",
                    categories: [], total: 0,
                    diagnostics: { requestedDays: days, effectiveDays: 365 },
                });
            }

            return NextResponse.json({
                success: true, mock: false,
                categories,
                total: parseFloat(total.toFixed(2)),
                topCategory: categories[0]?.category || null,
                diagnostics: { requestedDays: days, effectiveDays, rowsFound: categories.length },
            });
        } catch (dbErr: any) {
            console.error("[cost-by-category] DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({
                success: false, mock: false, categories: [], total: 0,
                error: `Sin datos disponibles: ${dbErr?.message || "error"}`,
            });
        }
    } catch (err: unknown) {
        console.error("[cost-by-category] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

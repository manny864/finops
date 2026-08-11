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
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";
import Decimal from "decimal.js";

type CategoryRow = { category: string; cost: Decimal };

async function getLiveMtdTotal(tenantId: string): Promise<Decimal | null> {
    try {
        const entries = await getCurrentMonthAmortizedCosts(tenantId, "All", "ActualCost");
        if (!entries || entries.length === 0) return null;

        let total = new Decimal(0);
        for (const entry of entries) {
            const cost = new Decimal(entry.EffectiveCost || entry.BilledCost || 0);
            if (cost.lte(0)) continue;
            total = total.plus(cost);
        }
        return total.gt(0) ? total : null;
    } catch (error) {
        console.warn("[cost-by-category] live MTD fallback to snapshots:", (error as Error)?.message);
        return null;
    }
}

async function runSnapshotQuery(tenantId: string, days: number) {
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

function sumCategoryCost(rows: CategoryRow[]): Decimal {
    return rows.reduce((acc, row) => acc.plus(row.cost), new Decimal(0));
}

function scaleCategoryRows(rows: CategoryRow[], targetTotal: Decimal): CategoryRow[] {
    const currentTotal = sumCategoryCost(rows);
    if (currentTotal.lte(0) || targetTotal.lte(0)) return rows;
    const factor = targetTotal.dividedBy(currentTotal);
    return rows.map((row) => ({
        category: row.category,
        cost: row.cost.times(factor).toDecimalPlaces(8, Decimal.ROUND_HALF_UP),
    }));
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
            const liveTotal = await getLiveMtdTotal(tenantId);

            // Ventana solicitada; si vacía, ampliar a 90 y luego 365 días.
            let rows = await runSnapshotQuery(tenantId, days);
            let effectiveDays = days;
            if (rows.length === 0 && days < 90) { rows = await runSnapshotQuery(tenantId, 90); effectiveDays = 90; }
            if (rows.length === 0) { rows = await runSnapshotQuery(tenantId, 365); effectiveDays = 365; }

            const parsed = rows
                .map((r) => ({ category: r.category || "Other", cost: new Decimal(r.cost || 0) }))
                .filter((r) => r.cost.gt(0))
                .sort((a, b) => b.cost.minus(a.cost).toNumber());

            const effectiveRows = parsed.length > 0
                ? (liveTotal ? scaleCategoryRows(parsed, liveTotal) : parsed)
                : (liveTotal ? [{ category: "Other", cost: liveTotal }] : []);

            const total = sumCategoryCost(effectiveRows);
            const categories = effectiveRows.map((r) => ({
                category: r.category,
                cost: Number(r.cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                percent: total.gt(0) ? Math.round(r.cost.dividedBy(total).times(100).toNumber()) : 0,
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
                total: Number(total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
                topCategory: categories[0]?.category || null,
                diagnostics: {
                    requestedDays: days,
                    effectiveDays,
                    rowsFound: categories.length,
                    source: liveTotal ? "snapshot-categories-live-total-anchored" : "snapshot-categories",
                },
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

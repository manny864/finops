/**
 * GET /api/cost-groups — listado de Cost Groups (Budget & Forecast por
 * Business Unit) para la nueva pantalla "Cost Groups".
 *
 * Un Cost Group = valor del tag CostCenter en CostSnapshots (misma fuente que
 * getTop5CostGroups en /api/intelligence/whiteboard). El budget mensual se
 * lee de la tabla `Budgets` (ya usada por /api/budgets); la metadata
 * adicional (description, owner, created_by/created_at) vive en la nueva
 * tabla `CostGroups` (lectura, sin CRUD todavía).
 *
 * period: "30d" | "90d" | "fy" (default "30d").
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import pool from "@/modules/storage/db";

function periodRange(period: string): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    if (period === "fy") {
        return { start: `${now.getUTCFullYear()}-01-01`, end };
    }
    const days = period === "90d" ? 90 : 30;
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - days);
    return { start: start.toISOString().slice(0, 10), end };
}

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const period = url.searchParams.get("period") || "30d";
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Cost Groups es exclusivo de los planes Business y Enterprise.
        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("cost_groups", tenantId));
        }

        const { start, end } = periodRange(period);
        const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) || 30);

        // COUNT(DISTINCT subscription_id) excluye 'mg-aggregated'/'default': el
        // sync diario a veces graba un placeholder ahí en vez del GUID real
        // (ver azureSubscriptionNames.ts) — contarlo inflaría "suscripciones"
        // con una que no existe.
        const [rows]: any = await pool.query(
            `SELECT
                COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'), 'Untagged/Unknown') AS name,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS periodCost,
                COUNT(DISTINCT CASE WHEN subscription_id NOT IN ('mg-aggregated', 'default') THEN subscription_id END) AS subscriptions,
                COUNT(DISTINCT resource_group) AS resourceGroups,
                COUNT(DISTINCT ResourceId) AS resources,
                MAX(COALESCE(ChargePeriodStart, date)) AS lastUpdated
             FROM CostSnapshots
             WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ?
             GROUP BY name`,
            [tenantId, start, end]
        );

        const [budgetRows]: any = await pool.query(
            `SELECT cost_center_tag_value AS name, monthly_limit_usd AS budget FROM Budgets WHERE tenant_id = ?`,
            [tenantId]
        );
        const budgetByName = new Map<string, number>((budgetRows as any[]).map(b => [b.name, Number(b.budget) || 0]));

        const [metaRows]: any = await pool.query(
            `SELECT cg.name, cg.description, cg.created_by, cg.created_at, u.display_name AS ownerName, u.email AS ownerEmail
             FROM CostGroups cg LEFT JOIN Users u ON u.id = cg.owner_user_id
             WHERE cg.tenant_id = ?`,
            [tenantId]
        );
        const metaByName = new Map<string, any>((metaRows as any[]).map(m => [m.name, m]));

        const groups = (rows as any[]).map(r => {
            const periodCost = Number(r.periodCost) || 0;
            const avgDailyCost = periodCost / days;
            const budget = budgetByName.get(r.name) || 0;
            const meta = metaByName.get(r.name);
            // Proyección run-rate: mismo enfoque que el resto del repo (sin ML de forecasting).
            const forecast = Number((avgDailyCost * 30).toFixed(2));
            return {
                name: r.name,
                description: meta?.description || null,
                avgDailyCost: Number(avgDailyCost.toFixed(2)),
                periodCost: Number(periodCost.toFixed(2)),
                monthlyBilledCost: Number((avgDailyCost * 30).toFixed(2)),
                budget: Number(budget.toFixed(2)),
                forecast,
                owner: meta?.ownerName || meta?.ownerEmail || null,
                createdBy: meta?.created_by || null,
                lastUpdated: r.lastUpdated,
                subscriptions: Number(r.subscriptions) || 0,
                resourceGroups: Number(r.resourceGroups) || 0,
                resources: Number(r.resources) || 0,
            };
        }).sort((a, b) => b.periodCost - a.periodCost);

        return NextResponse.json({ success: true, mock: false, groups });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

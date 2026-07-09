/**
 * GET /api/intelligence/cost-projection — agregado mensual de gasto real
 * (últimos 13 meses) usado por la tarjeta/página de Proyección de Gastos.
 *
 * La proyección en sí (aplicar el % de crecimiento que ingresa el usuario)
 * se calcula 100% client-side (src/lib/costProjection.ts) porque varía por
 * request y no tiene sentido cachearla — lo costoso y cacheable es el
 * agregado mensual histórico que sirve de base, que es lo que este endpoint
 * resuelve y guarda en Redis.
 *
 * RBAC: requireTenantAccess (tenant-scoped). Tier: Professional (routeTiers,
 * mismo nivel que /intelligence/billing).
 * Roles Azure requeridos: ninguno en el request — sirve datos ya persistidos
 * por /api/cron/sync (que requiere Cost Management Reader, tier Essential),
 * con fallback best-effort a Azure Cost Management si el snapshot local no
 * cubre los 13 meses.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithCache } from "@/lib/cache";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getHistoricalDailyCosts, AZURE_COST_HISTORY_MAX_MONTHS } from "@/modules/collectors/azure/billingService";

async function queryMonthlyFromDb(tenantId: string, subscriptionId: string): Promise<{ month: string; cost: number }[]> {
    const params: any[] = [tenantId];
    let where = "WHERE tenant_id = ?";
    if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
        where += " AND subscription_id = ?";
        params.push(subscriptionId);
    }
    const [rows]: any = await pool.query(
        `SELECT DATE_FORMAT(date, '%Y-%m') AS month,
                ROUND(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 2) AS cost
         FROM CostSnapshots
         ${where}
           AND date >= DATE_SUB(CURDATE(), INTERVAL ${AZURE_COST_HISTORY_MAX_MONTHS} MONTH)
         GROUP BY month
         ORDER BY month ASC`,
        params
    );
    return (rows || []).map((r: any) => ({ month: String(r.month), cost: Number(r.cost) || 0 }));
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const subscriptionId = searchParams.get("subscriptionId") || "All";

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
            return NextResponse.json(getMockDataForRoute("cost-projection", tenantId));
        }

        const cacheKey = `costProjection:v1:${tenantId}:${subscriptionId.toLowerCase()}`;
        const monthlyHistory = await getWithCache(
            cacheKey,
            async () => {
                let monthly = await queryMonthlyFromDb(tenantId, subscriptionId);
                // Fallback best-effort: si el snapshot local no cubre los 13 meses
                // (tenant nuevo), completar con Azure Cost Management directo.
                if (monthly.length < 3) {
                    try {
                        const daily = await getHistoricalDailyCosts(tenantId, subscriptionId, AZURE_COST_HISTORY_MAX_MONTHS);
                        const byMonth = new Map<string, number>(monthly.map((m) => [m.month, m.cost]));
                        for (const { date, cost } of daily) {
                            const month = date.slice(0, 7);
                            byMonth.set(month, (byMonth.get(month) || 0) + cost);
                        }
                        monthly = Array.from(byMonth.entries())
                            .map(([month, cost]) => ({ month, cost: Number(cost.toFixed(2)) }))
                            .sort((a, b) => a.month.localeCompare(b.month));
                    } catch (e: any) {
                        console.warn("[cost-projection] historical Azure fallback failed:", e?.message);
                    }
                }
                return monthly;
            },
            // 6h: el gasto histórico no cambia intra-día salvo por el snapshot
            // diario (cron), así que una ventana amplia evita pegarle a la DB/Azure
            // en cada visita a la card o a la página dedicada.
            6 * 3600
        );

        return NextResponse.json({ success: true, mock: false, monthlyHistory });
    } catch (error: any) {
        console.error("API GET /intelligence/cost-projection error:", error);
        return NextResponse.json({ error: "Fallo al calcular la proyección de gastos" }, { status: 500 });
    }
}

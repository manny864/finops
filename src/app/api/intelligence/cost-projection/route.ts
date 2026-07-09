/**
 * GET /api/intelligence/cost-projection — historial de gasto real de hasta
 * AZURE_COST_HISTORY_MAX_MONTHS (13) meses, en dos formas: serie diaria
 * (histograma de costos, filtrable client-side por rango) y agregado mensual
 * (base de la Proyección de Gastos). Usado por la página "Gastos y Proyección"
 * (/intelligence/cost-projection) y su card en el dashboard.
 *
 * Fuente de datos: CostSnapshots (snapshot diario del cron) + relleno desde
 * Azure Cost Management (getHistoricalDailyCosts) cuando el snapshot local no
 * cubre toda la ventana de 13 meses — así el histograma trae TODO lo que Azure
 * tenga disponible, no solo lo acumulado localmente. El resultado combinado se
 * cachea en Redis (TTL 6h) para consulta rápida.
 *
 * La proyección en sí (aplicar el % de crecimiento que ingresa el usuario)
 * se calcula 100% client-side (src/lib/costProjection.ts) porque varía por
 * request y no tiene sentido cachearla.
 *
 * RBAC: requireTenantAccess (tenant-scoped). Tier: Professional (routeTiers,
 * mismo nivel que /intelligence/billing).
 * Roles Azure requeridos: 'Cost Management Reader' solo para el relleno live;
 * los datos ya persistidos por /api/cron/sync no requieren rol en el request.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { redis } from "@/lib/redis";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getHistoricalDailyCosts, AZURE_COST_HISTORY_MAX_MONTHS } from "@/modules/collectors/azure/billingService";

type DailyPoint = { date: string; cost: number };
type MonthlyPoint = { month: string; cost: number };

async function queryDailyFromDb(tenantId: string, subscriptionId: string): Promise<DailyPoint[]> {
    const params: any[] = [tenantId];
    let where = "WHERE tenant_id = ?";
    if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
        where += " AND subscription_id = ?";
        params.push(subscriptionId);
    }
    const [rows]: any = await pool.query(
        `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d,
                ROUND(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 2) AS cost
         FROM CostSnapshots
         ${where}
           AND date >= DATE_SUB(CURDATE(), INTERVAL ${AZURE_COST_HISTORY_MAX_MONTHS} MONTH)
         GROUP BY d
         ORDER BY d ASC`,
        params
    );
    return (rows || []).map((r: any) => ({ date: String(r.d), cost: Number(r.cost) || 0 }));
}

function aggregateMonthly(daily: DailyPoint[]): MonthlyPoint[] {
    const byMonth = new Map<string, number>();
    for (const { date, cost } of daily) {
        const month = date.slice(0, 7);
        byMonth.set(month, (byMonth.get(month) || 0) + cost);
    }
    return Array.from(byMonth.entries())
        .map(([month, cost]) => ({ month, cost: Number(cost.toFixed(2)) }))
        .sort((a, b) => a.month.localeCompare(b.month));
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

        // v4: getHistoricalDailyCosts ahora agrega CostUSD (USD normalizado por
        // Azure) en vez de PreTaxCost (moneda de facturación — inflaba órdenes
        // de magnitud a tenants no facturados en USD). Bump para invalidar
        // payloads viejos cacheados con montos en moneda local.
        const cacheKey = `costProjection:v4:${tenantId}:${subscriptionId.toLowerCase()}`;

        type Payload = { dailyHistory: DailyPoint[]; monthlyHistory: MonthlyPoint[]; backfillOk: boolean };
        let payload: Payload | null = null;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) payload = JSON.parse(cached) as Payload;
        } catch (e: any) {
            console.warn("[cost-projection] Redis read failed:", e?.message);
        }

        if (!payload) {
            let daily = await queryDailyFromDb(tenantId, subscriptionId);
            let backfillOk = true;

            // Relleno desde Azure Cost Management: si el snapshot local no
            // arranca donde debería (tenants nuevos, o gaps por cron caído),
            // pedimos la ventana completa a Azure y mergeamos. El snapshot
            // local gana en fechas superpuestas (ya validado/persistido).
            const requiredFrom = new Date();
            requiredFrom.setMonth(requiredFrom.getMonth() - AZURE_COST_HISTORY_MAX_MONTHS);
            const earliestInDb = daily[0]?.date;
            const needsBackfill = daily.length === 0 || (earliestInDb && new Date(earliestInDb) > requiredFrom);
            if (needsBackfill) {
                try {
                    const historical = await getHistoricalDailyCosts(tenantId, subscriptionId, AZURE_COST_HISTORY_MAX_MONTHS);
                    // Azure GANA en fechas superpuestas: el backfill viene en USD
                    // normalizado (CostUSD), mientras que CostSnapshots guarda hoy
                    // PreTaxCost en moneda de facturación — mezclar unidades por
                    // fecha rompería la serie. La DB solo aporta fechas que Azure
                    // no tiene (p.ej. filas AWS ingestadas por CUR).
                    const byDate = new Map<string, number>(daily.map((p) => [p.date, p.cost]));
                    for (const { date, cost } of historical) {
                        byDate.set(date, cost);
                    }
                    daily = Array.from(byDate.entries())
                        .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(2)) }))
                        .sort((a, b) => a.date.localeCompare(b.date));
                    backfillOk = historical.length > 0;
                } catch (e: any) {
                    console.warn("[cost-projection] historical Azure backfill failed:", e?.message);
                    backfillOk = false;
                }
            }

            payload = { dailyHistory: daily, monthlyHistory: aggregateMonthly(daily), backfillOk };

            // TTL adaptativo: 6h con backfill sano (el gasto histórico no cambia
            // intra-día salvo por el snapshot diario del cron); solo 10 min si el
            // backfill de Azure falló, para reintentar pronto en vez de dejar 6h
            // un histograma incompleto cacheado.
            const ttl = backfillOk ? 6 * 3600 : 600;
            redis.set(cacheKey, JSON.stringify(payload), "EX", ttl)
                .catch((e: any) => console.warn("[cost-projection] Redis write failed:", e?.message));
        }

        return NextResponse.json({ success: true, mock: false, dailyHistory: payload.dailyHistory, monthlyHistory: payload.monthlyHistory });
    } catch (error: any) {
        console.error("API GET /intelligence/cost-projection error:", error);
        return NextResponse.json({ error: "Fallo al calcular gastos y proyección" }, { status: 500 });
    }
}

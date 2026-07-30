/**
 * GET /api/intelligence/cost-projection — historial de gasto real de hasta
 * AZURE_COST_HISTORY_MAX_MONTHS (13) meses, en dos formas: serie diaria
 * (histograma de costos, filtrable client-side por rango) y agregado mensual
 * (base de la Proyección de Gastos). Usado por la página "Gastos y Proyección"
 * (/intelligence/cost-projection) y su card en el dashboard.
 *
 * Fuente de datos: CostSnapshots (snapshot diario del cron), cacheada en Redis
 * (TTL 6h). Si la tabla no cubre la ventana de 13 meses, se dispara el backfill
 * histórico EN BACKGROUND (triggerBackfillIfStale) y se devuelve la serie que
 * haya: esta ruta NO consulta Cost Management en línea. Ver el comentario largo
 * en el cuerpo — hacerlo inline generaba 429 sostenido que además tumbaba la
 * consulta MTD de los KPIs.
 *
 * La proyección en sí (aplicar el % de crecimiento que ingresa el usuario)
 * se calcula 100% client-side (src/lib/costProjection.ts) porque varía por
 * request y no tiene sentido cachearla.
 *
 * RBAC: requireTenantAccess (tenant-scoped). Tier: Professional (routeTiers,
 * mismo nivel que /intelligence/billing).
 * Roles Azure requeridos: ninguno en el request (el backfill de background sí
 * necesita 'Cost Management Reader', igual que el cron);
 * los datos ya persistidos por /api/cron/sync no requieren rol en el request.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { redis } from "@/lib/redis";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { AZURE_COST_HISTORY_MAX_MONTHS } from "@/modules/collectors/azure/billingService";
import { triggerBackfillIfStale } from "@/lib/historicalGapBackfill";

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

            // Si el snapshot local no arranca donde debería (tenants nuevos, o
            // gaps por cron caído), el histórico se completa EN BACKGROUND, no
            // en esta request.
            //
            // Antes esto hacía un getHistoricalDailyCosts de 13 meses inline. Con
            // una base recién creada —el caso de prod desde el 2026-07-28— la
            // tabla está vacía, así que *cada* request entraba acá y disparaba una
            // consulta de 13 meses contra Cost Management. Resultado verificado en
            // los logs de prod (2026-07-30): 429 sostenido con los 3 reintentos
            // agotados, y con él "Azure Cost Management unavailable" en
            // /api/dashboard/summary — es decir, el flood de histórico se llevaba
            // puesta la consulta MTD que alimenta los KPIs, que quedaban leyendo
            // una tabla vacía. Y como el backfill también fallaba por 429, la
            // tabla no se llenaba nunca: bucle cerrado.
            //
            // triggerBackfillIfStale ya resuelve esto para el Invoicing Report:
            // fire-and-forget, con lock de 6h en Redis por tenant, y la ventana
            // ancha la corre el cron diario (HISTORICAL_GAP_BACKFILL_MONTHS = 13).
            const requiredFrom = new Date();
            requiredFrom.setMonth(requiredFrom.getMonth() - AZURE_COST_HISTORY_MAX_MONTHS);
            const earliestInDb = daily[0]?.date;
            const needsBackfill = daily.length === 0 || (earliestInDb && new Date(earliestInDb) > requiredFrom);
            if (needsBackfill) {
                triggerBackfillIfStale(tenantId);
                // La serie que se devuelve es la que hay. backfillOk=false baja el
                // TTL a 10 min, así que en cuanto el backfill de background termine
                // la próxima lectura ya ve el histórico completo.
                backfillOk = daily.length > 0;
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

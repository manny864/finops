/**
 * GET /api/intelligence/cost-projection — historial de gasto real de hasta
 * AZURE_COST_HISTORY_MAX_MONTHS (13) meses, en dos formas: serie diaria
 * (histograma de costos, filtrable client-side por rango) y agregado mensual
 * (base de la Proyección de Gastos). Usado por la página "Gastos y Proyección"
 * (/intelligence/cost-projection) y su card en el dashboard.
 *
 * Fuente de datos: CostSnapshots (snapshot diario del cron), cacheada en Redis
 * (TTL 6h). Si la tabla no cubre la ventana de 13 meses, se rellena desde Azure
 * Cost Management en la misma request, pero detrás de un lock de 6 h por tenant
 * — ver el comentario largo en el cuerpo: sin lock, una tabla vacía hacía que
 * cada request disparara una consulta de 13 meses y el 429 resultante tumbaba
 * también la consulta MTD de los KPIs.
 *
 * La proyección en sí (aplicar el % de crecimiento que ingresa el usuario)
 * se calcula 100% client-side (src/lib/costProjection.ts) porque varía por
 * request y no tiene sentido cachearla.
 *
 * RBAC: requireTenantAccess (tenant-scoped). Tier: Professional (routeTiers,
 * mismo nivel que /intelligence/billing).
 * Roles Azure requeridos: 'Cost Management Reader' sólo para el relleno;
 * los datos ya persistidos por /api/cron/sync no requieren rol en el request.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { redis } from "@/lib/redis";
import pool from "@/modules/storage/db";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getHistoricalDailyCosts, AZURE_COST_HISTORY_MAX_MONTHS } from "@/modules/collectors/azure/billingService";
import { buildDailyHistogram, type DailySpendHistogramPoint } from "@/lib/costProjection";
import { errorMessage } from '@/lib/apiErrors';

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

/**
 * Servicio con mayor gasto por día, best-effort (solo para días persistidos
 * en CostSnapshots — el backfill de Azure no trae desglose por servicio en
 * esta misma request, ver getHistoricalDailyCosts). Usado para el tooltip
 * de picos/anomalías del histograma ("Servicio causante: X").
 */
async function queryDailyTopServiceFromDb(tenantId: string, subscriptionId: string): Promise<Map<string, string>> {
    const params: any[] = [tenantId];
    let where = "WHERE tenant_id = ?";
    if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
        where += " AND subscription_id = ?";
        params.push(subscriptionId);
    }
    const [rows]: any = await pool.query(
        `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d,
                COALESCE(NULLIF(service_name, ''), 'Unknown') AS service,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS total
         FROM CostSnapshots
         ${where}
           AND date >= DATE_SUB(CURDATE(), INTERVAL ${AZURE_COST_HISTORY_MAX_MONTHS} MONTH)
         GROUP BY d, service`,
        params
    );
    const topByDate = new Map<string, { service: string; total: number }>();
    for (const r of (rows || []) as Array<{ d: string; service: string; total: number }>) {
        const current = topByDate.get(r.d);
        if (!current || Number(r.total) > current.total) {
            topByDate.set(r.d, { service: r.service, total: Number(r.total) });
        }
    }
    return new Map(Array.from(topByDate.entries()).map(([date, v]) => [date, v.service]));
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

        // v5: dailyHistory ahora incluye continuidad (huecos rellenados con
        // $0), media móvil de 7d, flags de fin de semana/pico y servicio
        // dominante del día (ver buildDailyHistogram) — bump para invalidar
        // payloads v4 que tenían solo {date, cost}.
        const cacheKey = `costProjection:v5:${tenantId}:${subscriptionId.toLowerCase()}`;

        type Payload = { dailyHistory: DailySpendHistogramPoint[]; monthlyHistory: MonthlyPoint[]; backfillOk: boolean };
        let payload: Payload | null = null;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) payload = JSON.parse(cached) as Payload;
        } catch (e) {
            console.warn("[cost-projection] Redis read failed:", errorMessage(e));
        }

        if (!payload) {
            let daily = await queryDailyFromDb(tenantId, subscriptionId);
            let backfillOk = true;
            // Best-effort: si falla no corta la respuesta, solo se pierde el
            // dato de "servicio causante" en los picos detectados.
            const serviceTopByDate = await queryDailyTopServiceFromDb(tenantId, subscriptionId).catch((e) => {
                console.warn("[cost-projection] top service por día falló:", e?.message);
                return new Map<string, string>();
            });

            // Relleno desde Azure Cost Management cuando el snapshot local no
            // cubre la ventana (tenants nuevos, o gaps por cron caído).
            //
            // El relleno es inline —hace falta para DEVOLVER la serie en esta
            // misma respuesta— pero está detrás de un lock de 6 h por tenant.
            //
            // POR QUÉ EL LOCK. Sin él, con la tabla vacía *cada* request entraba
            // acá y disparaba una consulta de 13 meses contra Cost Management.
            // Verificado en los logs de prod el 2026-07-30: 429 sostenido con los
            // 3 reintentos agotados, y con él "Azure Cost Management unavailable"
            // en /api/dashboard/summary — el flood de histórico se llevaba puesta
            // la consulta MTD que alimenta los KPIs. Y como el backfill también
            // moría por 429, la tabla nunca se llenaba: bucle cerrado.
            //
            // POR QUÉ NO ALCANZA CON DIFERIRLO A BACKGROUND. Se probó
            // (fire-and-forget) y deja la respuesta sin serie, así que la tarjeta
            // de Proyección de Gastos queda vacía en cualquier entorno cuya tabla
            // no esté al día — exactamente lo que pasó en local. Con el lock hay
            // dato en la primera lectura y como máximo UNA consulta ancha cada
            // 6 h por tenant, que es lo que evita el stampede.
            const requiredFrom = new Date();
            requiredFrom.setMonth(requiredFrom.getMonth() - AZURE_COST_HISTORY_MAX_MONTHS);
            const earliestInDb = daily[0]?.date;
            const needsBackfill = daily.length === 0 || (earliestInDb && new Date(earliestInDb) > requiredFrom);
            if (needsBackfill) {
                let mayQueryAzure = true;
                try {
                    // NX + EX: sólo el primero de la ventana se lo lleva. Si Redis
                    // no responde se permite la consulta (degradar a "sin lock" es
                    // preferible a dejar la tarjeta vacía por un cache caído).
                    const lock = await redis.set(
                        `cost-projection:backfill:lock:${tenantId}`,
                        "1", "EX", 6 * 60 * 60, "NX"
                    );
                    mayQueryAzure = lock !== null;
                } catch (e) {
                    console.warn("[cost-projection] Redis lock no disponible:", errorMessage(e));
                }

                if (mayQueryAzure) {
                    try {
                        const historical = await getHistoricalDailyCosts(tenantId, subscriptionId, AZURE_COST_HISTORY_MAX_MONTHS);
                        // Azure GANA en fechas superpuestas: el backfill viene en USD
                        // normalizado (CostUSD), mientras que CostSnapshots guarda hoy
                        // PreTaxCost en moneda de facturación — mezclar unidades por
                        // fecha rompería la serie. La DB solo aporta fechas que Azure
                        // no tiene.
                        const byDate = new Map<string, number>(daily.map((p) => [p.date, p.cost]));
                        for (const { date, cost } of historical) {
                            byDate.set(date, cost);
                        }
                        daily = Array.from(byDate.entries())
                            .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(2)) }))
                            .sort((a, b) => a.date.localeCompare(b.date));
                        backfillOk = historical.length > 0;
                    } catch (e) {
                        console.warn("[cost-projection] historical Azure backfill failed:", errorMessage(e));
                        backfillOk = false;
                    }
                } else {
                    // Otro request ya se llevó la ventana: se devuelve lo que hay en
                    // la DB y el TTL corto hace que se reintente pronto.
                    backfillOk = daily.length > 0;
                }
            }

            payload = { dailyHistory: buildDailyHistogram(daily, serviceTopByDate), monthlyHistory: aggregateMonthly(daily), backfillOk };

            // TTL adaptativo: 6h con backfill sano (el gasto histórico no cambia
            // intra-día salvo por el snapshot diario del cron); solo 10 min si el
            // backfill de Azure falló, para reintentar pronto en vez de dejar 6h
            // un histograma incompleto cacheado.
            const ttl = backfillOk ? 6 * 3600 : 600;
            redis.set(cacheKey, JSON.stringify(payload), "EX", ttl)
                .catch((e: any) => console.warn("[cost-projection] Redis write failed:", e?.message));
        }

        return NextResponse.json({ success: true, mock: false, dailyHistory: payload.dailyHistory, monthlyHistory: payload.monthlyHistory });
    } catch (error) {
        console.error("API GET /intelligence/cost-projection error:", error);
        return NextResponse.json({ error: "Fallo al calcular gastos y proyección" }, { status: 500 });
    }
}

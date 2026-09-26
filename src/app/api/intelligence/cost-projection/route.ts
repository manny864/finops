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
import { getTagCoverage } from "@/lib/costTagCoverage";
import {
    filtroDeAlcance, comoFilaDeCosto, recorteDeAlcance, DIMENSIONES_DE_ALCANCE,
    type FilaConDimensiones, type RecorteDeAlcance,
} from "@/services/perspectivesData.service";
import type { FilaDeCosto } from "@/services/perspectives.service";

type DailyPoint = { date: string; cost: number };
type MonthlyPoint = { month: string; cost: number };

type Alcance = (fila: FilaDeCosto) => boolean;

/**
 * Cómo se acota esta serie. Son dos mecanismos y el orden importa:
 *
 *   - `recorte`: el alcance traducido a un predicado SQL. Es el camino bueno —
 *     la agregación se queda en la base—, pero se niega cuando una terna cae de
 *     los dos lados (el mismo recurso con dos juegos de etiquetas en la
 *     ventana), y con 13 meses eso es más probable que en los otros tableros.
 *   - `plegado`: evaluar fila por fila en TypeScript. Siempre exacto, pero se
 *     trae el detalle: medido contra la base local, 13.940 filas, porque el
 *     grano de esta serie incluye la fecha y no colapsa.
 *
 * Con los dos, la serie se acota siempre y sólo paga el detalle cuando el
 * predicado no alcanza.
 */
interface ModoDeAlcance {
    recorte: RecorteDeAlcance | null;
    plegado: Alcance | null;
}

/** El filtro por suscripción, igual en las dos formas de cada consulta. */
function ventana(tenantId: string, subscriptionId: string) {
    const params: any[] = [tenantId];
    let where = "WHERE tenant_id = ?";
    if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
        where += " AND subscription_id = ?";
        params.push(subscriptionId);
    }
    where += ` AND date >= DATE_SUB(CURDATE(), INTERVAL ${AZURE_COST_HISTORY_MAX_MONTHS} MONTH)`;
    return { where, params };
}

/**
 * MEJ-34 — con alcance activo la agregación pasa de SQL a acá: la consulta trae
 * el detalle por las cinco dimensiones que las reglas miran y el plegado rehace
 * la suma por día. Sin alcance la consulta de siempre no se toca.
 */
async function queryDailyFromDb(tenantId: string, subscriptionId: string, modo?: ModoDeAlcance): Promise<DailyPoint[]> {
    const { where, params } = ventana(tenantId, subscriptionId);

    if (modo?.recorte) {
        const [rows]: any = await pool.query(
            `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d,
                    ROUND(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 2) AS cost
             FROM CostSnapshots
             ${where} AND ${modo.recorte.sql}
             GROUP BY d
             ORDER BY d ASC`,
            [...params, ...modo.recorte.params]
        );
        return (rows || []).map((r: any) => ({ date: String(r.d), cost: Number(r.cost) || 0 }));
    }

    const alcance = modo?.plegado;
    if (alcance) {
        const [detalle]: any = await pool.query(
            `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, ${DIMENSIONES_DE_ALCANCE},
                    SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
             FROM CostSnapshots
             ${where}
             GROUP BY d, ${DIMENSIONES_DE_ALCANCE}`,
            params
        );
        const porDia = new Map<string, number>();
        for (const f of (detalle as Array<FilaConDimensiones & { d: string; cost: unknown }>)) {
            const costo = Number(f.cost) || 0;
            if (!alcance(comoFilaDeCosto(f, costo))) continue;
            porDia.set(f.d, (porDia.get(f.d) || 0) + costo);
        }
        return [...porDia.entries()]
            .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(2)) }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    const [rows]: any = await pool.query(
        `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d,
                ROUND(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 2) AS cost
         FROM CostSnapshots
         ${where}
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
async function queryDailyTopServiceFromDb(tenantId: string, subscriptionId: string, modo?: ModoDeAlcance): Promise<Map<string, string>> {
    const { where, params } = ventana(tenantId, subscriptionId);
    const servicio = `COALESCE(NULLIF(service_name, ''), 'Unknown')`;
    const alcance = modo?.plegado;

    // El servicio causante tiene que salir del MISMO universo que la serie: si
    // la serie está acotada y este desglose no, el tooltip de un pico nombraría
    // un servicio que en ese alcance no gastó nada.
    const [rows]: any = alcance
        ? await pool.query(
            `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, ${servicio} AS service, ${DIMENSIONES_DE_ALCANCE},
                    SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS total
             FROM CostSnapshots
             ${where}
             GROUP BY d, service, ${DIMENSIONES_DE_ALCANCE}`,
            params
        )
        : await pool.query(
            `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d, ${servicio} AS service,
                    SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS total
             FROM CostSnapshots
             ${where}${modo?.recorte ? ` AND ${modo.recorte.sql}` : ""}
             GROUP BY d, service`,
            [...params, ...(modo?.recorte?.params || [])]
        );

    const porDiaYServicio = new Map<string, number>();
    for (const f of (rows || []) as Array<FilaConDimensiones & { d: string; service: string; total: unknown }>) {
        const total = Number(f.total) || 0;
        if (alcance && !alcance(comoFilaDeCosto(f, total))) continue;
        const clave = `${f.d}\u0001${f.service}`;
        porDiaYServicio.set(clave, (porDiaYServicio.get(clave) || 0) + total);
    }

    const topByDate = new Map<string, { service: string; total: number }>();
    for (const [clave, total] of porDiaYServicio) {
        const [d, service] = clave.split("\u0001");
        const current = topByDate.get(d);
        if (!current || total > current.total) topByDate.set(d, { service, total });
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

        // MEJ-34: alcance transversal de Perspective, resuelto UNA vez.
        const pid = Number(searchParams.get("perspective"));
        const alcance = await filtroDeAlcance(
            tenantId,
            Number.isInteger(pid) && pid > 0 ? pid : null,
            searchParams.get("pgroup"),
        );

        // UN ALCANCE SOLO SE APLICA SI SE PUEDE MEDIR, con el mismo criterio que
        // los otros tableros: sin procedencia en el costo de la ventana, el
        // reparto se aproxima por Resource Group y una aproximación no se
        // recorta fila por fila.
        const desde = new Date();
        desde.setMonth(desde.getMonth() - AZURE_COST_HISTORY_MAX_MONTHS);
        const medible = !!alcance && (await getTagCoverage(
            tenantId, desde.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10),
        )).isExact;

        // Predicado primero, plegado de respaldo. Ver `ModoDeAlcance`.
        let modo: ModoDeAlcance | null = null;
        if (medible && alcance) {
            const v = ventana(tenantId, subscriptionId);
            const [dims]: any = await pool.query(
                `SELECT DISTINCT ${DIMENSIONES_DE_ALCANCE} FROM CostSnapshots ${v.where}`, v.params,
            );
            modo = { recorte: recorteDeAlcance(dims as FilaConDimensiones[], alcance), plegado: alcance };
            // Con predicado no hace falta el plegado, y es lo que evita traerse
            // el detalle de 13 meses a memoria.
            if (modo.recorte) modo.plegado = null;
        }
        const recorte = modo;

        // v5: dailyHistory ahora incluye continuidad (huecos rellenados con
        // $0), media móvil de 7d, flags de fin de semana/pico y servicio
        // dominante del día (ver buildDailyHistogram) — bump para invalidar
        // payloads v4 que tenían solo {date, cost}.
        const cacheKey = `costProjection:v5:${tenantId}:${subscriptionId.toLowerCase()}`;

        type Payload = { dailyHistory: DailySpendHistogramPoint[]; monthlyHistory: MonthlyPoint[]; backfillOk: boolean };
        let payload: Payload | null = null;
        // El recorte no se cachea: la clave sería una por (perspective, grupo) y
        // el backfill invalida sólo la de la serie sin acotar.
        if (!recorte) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) payload = JSON.parse(cached) as Payload;
            } catch (e) {
                console.warn("[cost-projection] Redis read failed:", errorMessage(e));
            }
        }

        if (!payload) {
            let daily = await queryDailyFromDb(tenantId, subscriptionId, modo || undefined);
            let backfillOk = true;
            // Best-effort: si falla no corta la respuesta, solo se pierde el
            // dato de "servicio causante" en los picos detectados.
            const serviceTopByDate = await queryDailyTopServiceFromDb(tenantId, subscriptionId, modo || undefined).catch((e) => {
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
            // EL BACKFILL NO SE PUEDE ACOTAR y además GANA en las fechas que se
            // superponen: `getHistoricalDailyCosts` devuelve totales diarios sin
            // dimensión de recurso, así que bajo alcance pisaría los días
            // acotados con el total del tenant y la serie quedaría mitad
            // recortada y mitad no, sin que nada lo indique. Con alcance se
            // devuelve sólo lo que `CostSnapshots` tiene: una serie más corta y
            // correcta es mejor que una larga y mezclada.
            const needsBackfill = !recorte
                && (daily.length === 0 || (earliestInDb && new Date(earliestInDb) > requiredFrom));
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
            if (!recorte) {
                redis.set(cacheKey, JSON.stringify(payload), "EX", ttl)
                    .catch((e: any) => console.warn("[cost-projection] Redis write failed:", e?.message));
            }
        }

        return NextResponse.json({
            success: true, mock: false,
            dailyHistory: payload.dailyHistory, monthlyHistory: payload.monthlyHistory,
            // MEJ-34: con un alcance pedido y esto en false, la serie es la del
            // tenant entero. En true, la serie llega sólo hasta donde
            // `CostSnapshots` tiene datos (ver el backfill más arriba).
            scopeApplied: recorte !== null,
        });
    } catch (error) {
        console.error("API GET /intelligence/cost-projection error:", error);
        return NextResponse.json({ error: "Fallo al calcular gastos y proyección" }, { status: 500 });
    }
}

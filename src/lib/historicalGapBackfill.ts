import pool, {
    insertCostSnapshot,
    insertCostSnapshotRow,
    insertCostMeterSnapshotRow,
    insertCostCategorySnapshotRow,
} from "@/modules/storage/db";
import { getYesterdaysCost, getYesterdaysDetailedCosts } from "@/modules/collectors/azure/billingService";
import {
    getHistoricalDailyCosts,
    getHistoricalDetailedCosts,
    AZURE_COST_HISTORY_MAX_MONTHS,
} from "@/modules/collectors/azure/billingService";
import { redis } from "@/lib/redis";
import { errorMessage } from '@/lib/apiErrors';

// Ventana que cubre este job: la MAXIMA que permite la Query API de Azure (13
// meses). Antes eran 2, suficiente para cerrar huecos del backfill liviano del
// cron diario (findGapDays en /api/cron/sync, ventana de 7 días) — ver
// incidente RPA365 2026-07 (huecos de 45 días por 429 sostenido).
//
// Se subió a 13 el 2026-07-30 porque 2 meses no alcanzan para el caso que
// importa hoy: la base de prod arrancó de cero el 2026-07-28, así que las
// tarjetas que suman el AÑO CALENDARIO (White Board → Costos, vía
// getCostFigures) mostraban sólo los días ya sincronizados y no cerraban con
// Cost Management. Con 13 meses este cron llena el histórico solo.
//
// Este job es el ÚNICO lugar donde debe vivir una consulta tan ancha: corre una
// vez por día, serializado, fuera del request path. Cost Management tira 429
// por scope y una ventana de 13 meses en el camino de una página se lleva
// puesto el resto de las consultas del tenant (incluida la MTD que alimenta los
// KPIs). Upsert-only (ON DUPLICATE KEY UPDATE en todas las insertCost*), nunca
// DELETE — no puede perder datos ya persistidos.
export const HISTORICAL_GAP_BACKFILL_MONTHS = AZURE_COST_HISTORY_MAX_MONTHS;

export interface BackfillResult {
    tenantId: string;
    detailedRowsUpserted: number;
    dailyRowsUpserted: number;
}

/** Backfill histórico (upsert-only) para UN tenant puntual. */
export async function backfillTenantHistoricalGaps(
    tenantId: string,
    months: number = HISTORICAL_GAP_BACKFILL_MONTHS
): Promise<BackfillResult> {
    const detailedRows = await getHistoricalDetailedCosts(tenantId, months);
    for (const row of detailedRows) {
        if (row.kind === "meter") {
            await insertCostMeterSnapshotRow(tenantId, row.date, row);
        } else if (row.kind === "category") {
            await insertCostCategorySnapshotRow(tenantId, row.date, row);
        } else {
            await insertCostSnapshotRow(tenantId, row.date, row);
        }
    }

    const dailySeries = await getHistoricalDailyCosts(tenantId, undefined, months);
    for (const day of dailySeries) {
        await insertCostSnapshot(tenantId, day.date, day.cost, "USD");
    }

    console.log(`[historical-gap-backfill] tenant=${tenantId} detailedRows=${detailedRows.length} dailyRows=${dailySeries.length}`);
    return { tenantId, detailedRowsUpserted: detailedRows.length, dailyRowsUpserted: dailySeries.length };
}

// ─── Backfill día por día ────────────────────────────────────────────────────

/** Pausa entre días. Cada día es una tanda de consultas al mismo scope. */
/** Se lee en cada corrida, no al cargar el módulo: permite ajustar el ritmo
 *  por entorno sin redeploy. */
function perDayPaceMs(): number {
    const raw = Number(process.env.GAP_BACKFILL_PACE_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 2500;
}
/** Tras esta cantidad de días fallidos seguidos se corta: la cuota está agotada. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Techo de días por corrida, para no encadenar horas de consultas. */
const MAX_DAYS_PER_RUN = 40;

/** Días sin ninguna fila en CostSnapshots dentro de la ventana. */
export async function findMissingDays(tenantId: string, lookbackDays = 60): Promise<string[]> {
    const [rows] = await pool.query<any[]>(
        `SELECT DISTINCT DATE(COALESCE(ChargePeriodStart, date)) AS d
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND COALESCE(ChargePeriodStart, date) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [tenantId, lookbackDays]
    );
    // Defensivo: una fila con fecha nula o inválida haría explotar
    // toISOString() con RangeError y se llevaría puesto el backfill entero por
    // un dato corrupto en una sola fila.
    const present = new Set(
        (rows || [])
            .map((r) => {
                const d = new Date(r?.d);
                return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
            })
            .filter((d): d is string => d !== null)
    );

    const missing: string[] = [];
    // Se arranca en 1 = ayer: el día en curso todavía no cerró en Cost Management.
    for (let i = 1; i <= lookbackDays; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        if (!present.has(key)) missing.push(key);
    }
    return missing.reverse(); // del más viejo al más nuevo
}

export interface DayBackfillResult {
    tenantId: string;
    daysAttempted: number;
    daysRecovered: number;
    rowsUpserted: number;
    abortedByThrottling: boolean;
    remainingDays: string[];
}

/**
 * Rellena los huecos pidiendo UN DÍA POR VEZ, con pausa entre días.
 *
 * `backfillTenantHistoricalGaps` pide meses enteros en una sola consulta: es
 * pocas llamadas pero cada una enorme, y Cost Management la throttlea justo
 * cuando hay más para traer. En el incidente del tenant 81ebe027 esa consulta
 * devolvió 429 en todos los scopes y recuperó 0 filas.
 *
 * Esta variante hace muchas más llamadas, pero cada una del tamaño de un día
 * —exactamente la misma que ejecuta el cron diario, que sí funciona— y espaciadas.
 * Además el progreso es incremental: si la cuota se agota en el día 8, los 7
 * anteriores ya quedaron persistidos, mientras que en la consulta mensual un 429
 * se lleva puesta la corrida completa.
 */
export async function backfillMissingDaysOneByOne(
    tenantId: string,
    opts: { lookbackDays?: number; maxDays?: number; signal?: AbortSignal; paceMs?: number } = {}
): Promise<DayBackfillResult> {
    const lookbackDays = opts.lookbackDays ?? 60;
    const maxDays = Math.min(opts.maxDays ?? MAX_DAYS_PER_RUN, MAX_DAYS_PER_RUN);
    // Inyectable: el cron puede espaciar más si la cuota está ajustada, y
    // los tests no tienen por qué esperar la pausa real.
    const paceMs = opts.paceMs ?? perDayPaceMs();

    const allMissing = await findMissingDays(tenantId, lookbackDays);
    const targets = allMissing.slice(0, maxDays);

    let daysRecovered = 0;
    let rowsUpserted = 0;
    let consecutiveFailures = 0;
    let abortedByThrottling = false;
    const done = new Set<string>();

    for (const dateStr of targets) {
        if (opts.signal?.aborted) break;

        try {
            const day = new Date(`${dateStr}T12:00:00Z`);

            const totalCost = await getYesterdaysCost(tenantId, day, opts.signal);
            await insertCostSnapshot(tenantId, dateStr, totalCost, 'USD');

            const detailedRows = await getYesterdaysDetailedCosts(tenantId, day, opts.signal);
            for (const row of detailedRows) {
                if (row.kind === 'meter') await insertCostMeterSnapshotRow(tenantId, dateStr, row);
                else if (row.kind === 'category') await insertCostCategorySnapshotRow(tenantId, dateStr, row);
                else await insertCostSnapshotRow(tenantId, dateStr, row);
            }

            rowsUpserted += detailedRows.length;
            daysRecovered++;
            consecutiveFailures = 0;
            done.add(dateStr);
            console.log(`[gap-backfill-daily] ${tenantId} ${dateStr}: ${detailedRows.length} filas`);
        } catch (err) {
            consecutiveFailures++;
            console.warn(`[gap-backfill-daily] ${tenantId} ${dateStr} falló (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, errorMessage(err));
            // Seguir martillando una API que ya throttlea sólo empeora el
            // rate limit para el resto del tenant.
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                abortedByThrottling = true;
                break;
            }
        }

        if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
    }

    return {
        tenantId,
        daysAttempted: targets.length,
        daysRecovered,
        rowsUpserted,
        abortedByThrottling,
        remainingDays: allMissing.filter((d) => !done.has(d)),
    };
}

const ON_DEMAND_LOCK_TTL_SECONDS = 6 * 60 * 60; // 6h: no re-disparar en cada page load

/**
 * Ventana tras un intento que no recuperó nada. Corta para que el hueco no
 * espere medio día, pero suficiente para no martillar Cost Management mientras
 * dura el throttling que probablemente causó el fallo.
 */
const RETRY_LOCK_TTL_SECONDS = 15 * 60;
const STALE_THRESHOLD_DAYS = 2; // sin filas más recientes que esto -> se considera stale

/**
 * Ventana en la que se exige continuidad diaria. Cubre el mes en curso y el
 * anterior, que es el rango que miran los reportes de facturación.
 */
const GAP_SCAN_DAYS = 60;

/**
 * Cuántos días pueden faltar antes de considerar el histórico incompleto. No es
 * 0 porque un día sin consumo real no genera filas y sería un falso positivo
 * permanente; se tolera algún hueco aislado y se reacciona ante la ausencia
 * sistemática.
 */
const MAX_TOLERATED_GAP_DAYS = 3;

/**
 * Decide si hay que rellenar el histórico del tenant.
 *
 * Mira DOS cosas, no una:
 *   1. Antigüedad del último día (lo único que miraba antes).
 *   2. Huecos INTERNOS dentro de la ventana reciente.
 *
 * El (2) es el que faltaba. Mirando sólo `MAX(date)`, un tenant cuyo último día
 * fuera reciente se daba por sano aunque le faltaran semanas en el medio, y el
 * backfill no se disparaba nunca. Caso real: 15 días ausentes de agosto con el
 * último día a 2 días de antigüedad -> "al día", y el reporte de facturación
 * informaba 368 USD en lugar de 677. El gap-filler del cron tampoco los cubría:
 * su ventana es de 7 días y 10 de esos huecos ya habían quedado fuera.
 */
async function isTenantDataStale(tenantId: string): Promise<boolean> {
    const [rows] = await pool.query<any[]>(
        `SELECT MAX(DATE(COALESCE(ChargePeriodStart, date))) AS lastDay,
                COUNT(DISTINCT DATE(COALESCE(ChargePeriodStart, date))) AS daysWithData,
                MIN(DATE(COALESCE(ChargePeriodStart, date))) AS firstDay
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [tenantId, GAP_SCAN_DAYS]
    );

    const lastDay = rows?.[0]?.lastDay;
    if (!lastDay) return true; // sin ninguna fila todavía -> definitivamente stale

    const ageDays = (Date.now() - new Date(lastDay).getTime()) / 86400000;
    if (ageDays > STALE_THRESHOLD_DAYS) return true;

    // Huecos internos: se compara contra los días transcurridos desde la
    // primera fila de la ventana, no contra GAP_SCAN_DAYS completos — un tenant
    // dado de alta hace una semana no tiene por qué cubrir 60 días.
    const firstDay = rows[0].firstDay;
    const daysWithData = Number(rows[0].daysWithData || 0);
    const spanDays = Math.floor((new Date(lastDay).getTime() - new Date(firstDay).getTime()) / 86400000) + 1;
    const missingDays = spanDays - daysWithData;

    if (missingDays > MAX_TOLERATED_GAP_DAYS) {
        console.log(
            `[historical-gap-backfill] tenant=${tenantId} con histórico incompleto: ` +
            `${missingDays} de ${spanDays} días sin datos en la ventana reciente.`
        );
        return true;
    }

    return false;
}

/**
 * Dispara el backfill histórico de un tenant EN BACKGROUND (fire-and-forget,
 * no bloquea la request que lo llama) si sus datos están stale y no se
 * disparó ya en las últimas horas (lock en Redis, evita pegarle a Cost
 * Management en cada carga de página). Pensado para engancharse a rutas de
 * lectura como el Invoicing Report — así el hueco se autocura la próxima vez
 * que alguien mira el reporte, sin esperar a la corrida semanal/diaria del
 * cron ni bloquear el request actual con una consulta que puede tardar
 * minutos por reintentos de 429.
 */
export function triggerBackfillIfStale(tenantId: string): void {
    (async () => {
        const lockKey = `historical-gap-backfill:lock:${tenantId}`;
        try {
            const acquired = await redis.set(lockKey, "1", "EX", ON_DEMAND_LOCK_TTL_SECONDS, "NX");
            if (!acquired) return; // ya se disparó recientemente para este tenant

            const stale = await isTenantDataStale(tenantId);
            if (!stale) return;

            console.log(`[historical-gap-backfill] on-demand trigger tenant=${tenantId} (datos stale)`);

            // Estrategia por día primero: la consulta mensual es una sola llamada
            // enorme que Cost Management throttlea entera, y un 429 se lleva
            // puesta la corrida completa. Día por día son más llamadas pero cada
            // una del tamaño que el cron diario ya ejecuta con éxito, y el
            // progreso queda persistido aunque la cuota se agote a mitad.
            const daily = await backfillMissingDaysOneByOne(tenantId);
            console.log(
                `[historical-gap-backfill] ${tenantId}: ${daily.daysRecovered}/${daily.daysAttempted} días recuperados, ` +
                `${daily.rowsUpserted} filas${daily.abortedByThrottling ? ' (cortado por throttling)' : ''}`
            );

            // Sólo si no recuperó nada Y no fue por throttling se prueba la
            // consulta ancha: ahí el problema no es la cuota sino que el rango
            // por día no devolvió filas.
            const result = daily.daysRecovered > 0
                ? { detailedRowsUpserted: daily.rowsUpserted, dailyRowsUpserted: daily.daysRecovered }
                : daily.abortedByThrottling
                    ? { detailedRowsUpserted: 0, dailyRowsUpserted: 0 }
                    : await backfillTenantHistoricalGaps(tenantId);

            // Un backfill que no trajo NADA no cumplió su función, y el caso
            // típico es 429 sostenido de Cost Management: los reintentos
            // internos se agotan, las queries devuelven vacío y esto retornaba
            // "éxito" con 0 filas. Con el lock completo de 6 h, ese intento
            // fallido bloqueaba el siguiente durante medio día y el hueco
            // sobrevivía indefinidamente.
            //
            // No se libera el lock del todo: un tenant sin consumo real
            // devuelve 0 filas legítimamente y quedaría reintentando en cada
            // carga de página. Se acorta a una ventana de reintento.
            if (result.detailedRowsUpserted === 0 && result.dailyRowsUpserted === 0) {
                console.warn(
                    `[historical-gap-backfill] tenant=${tenantId} no recuperó filas ` +
                    `(probable throttling de Cost Management); se reintenta en ${RETRY_LOCK_TTL_SECONDS / 60} min.`
                );
                await redis.set(lockKey, "1", "EX", RETRY_LOCK_TTL_SECONDS).catch(() => {});
            }
        } catch (err) {
            console.warn(`[historical-gap-backfill] on-demand trigger falló para tenant=${tenantId}:`, errorMessage(err));
            // Idem ante excepción: no dejar el lock largo tomado por un intento
            // que no llegó a escribir nada.
            await redis.set(lockKey, "1", "EX", RETRY_LOCK_TTL_SECONDS).catch(() => {});
        }
    })();
}

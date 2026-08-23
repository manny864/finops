import pool, {
    insertCostSnapshot,
    insertCostSnapshotRow,
    insertCostMeterSnapshotRow,
    insertCostCategorySnapshotRow,
} from "@/modules/storage/db";
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

const ON_DEMAND_LOCK_TTL_SECONDS = 6 * 60 * 60; // 6h: no re-disparar en cada page load
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
        try {
            const lockKey = `historical-gap-backfill:lock:${tenantId}`;
            const acquired = await redis.set(lockKey, "1", "EX", ON_DEMAND_LOCK_TTL_SECONDS, "NX");
            if (!acquired) return; // ya se disparó recientemente para este tenant

            const stale = await isTenantDataStale(tenantId);
            if (!stale) return;

            console.log(`[historical-gap-backfill] on-demand trigger tenant=${tenantId} (datos stale)`);
            await backfillTenantHistoricalGaps(tenantId);
        } catch (err) {
            console.warn(`[historical-gap-backfill] on-demand trigger falló para tenant=${tenantId}:`, errorMessage(err));
        }
    })();
}

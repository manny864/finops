import pool, {
    insertCostSnapshot,
    insertCostSnapshotRow,
    insertCostMeterSnapshotRow,
    insertCostCategorySnapshotRow,
} from "@/modules/storage/db";
import {
    getHistoricalDailyCosts,
    getHistoricalDetailedCosts,
} from "@/modules/collectors/azure/billingService";
import { redis } from "@/lib/redis";

// Ventana que cubre este job: suficiente para cerrar huecos que el backfill
// liviano del cron diario (findGapDays en /api/cron/sync, ventana de 7 días)
// nunca llega a ver — ver incidente RPA365 2026-07 (huecos de 45 días por
// 429 sostenido en el cron diario). Upsert-only (ON DUPLICATE KEY UPDATE en
// todas las insertCost*), nunca DELETE — no puede perder datos ya persistidos.
export const HISTORICAL_GAP_BACKFILL_MONTHS = 2;

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

async function isTenantDataStale(tenantId: string): Promise<boolean> {
    const [rows] = await pool.query<any[]>(
        `SELECT MAX(DATE(COALESCE(ChargePeriodStart, date))) AS lastDay
         FROM CostSnapshots WHERE tenant_id = ?`,
        [tenantId]
    );
    const lastDay = rows?.[0]?.lastDay;
    if (!lastDay) return true; // sin ninguna fila todavía -> definitivamente stale
    const ageDays = (Date.now() - new Date(lastDay).getTime()) / 86400000;
    return ageDays > STALE_THRESHOLD_DAYS;
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
        } catch (err: any) {
            console.warn(`[historical-gap-backfill] on-demand trigger falló para tenant=${tenantId}:`, err.message);
        }
    })();
}

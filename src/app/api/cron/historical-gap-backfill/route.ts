import { NextRequest, NextResponse } from "next/server";
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

export async function GET(request: NextRequest) {
    return runBackfill(request);
}

export async function POST(request: NextRequest) {
    return runBackfill(request);
}

// Ventana que cubre este job: suficiente para cerrar huecos que el backfill
// liviano del cron diario (findGapDays en /api/cron/sync, ventana de 7 días)
// nunca llega a ver — como el caso real de RPA365 (2026-07), donde 2 de 3
// suscripciones perdieron el sync diario por 429 sostenido durante 45 días.
// No es un recálculo completo (eso es scripts/recalculate-cost-snapshots-usd.ts,
// manual, para fixes de moneda/histórico completo) — este job solo UPSERTEA
// (insertCostSnapshotRow/insertCostMeterSnapshotRow/insertCostCategorySnapshotRow
// usan ON DUPLICATE KEY UPDATE, nunca DELETE), así que nunca puede perder datos
// ya persistidos: en el peor caso, un día no se actualiza este ciclo y se
// reintenta el próximo.
const HISTORICAL_GAP_BACKFILL_MONTHS = 2;

async function runBackfill(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const [tenants] = await pool.query<any[]>(
            'SELECT tenant_id as id FROM Tenants WHERE status = "active"'
        );

        let tenantsProcessed = 0;
        let detailedRowsUpserted = 0;
        let dailyRowsUpserted = 0;
        const tenantErrors: Record<string, string> = {};

        // Secuencial (no Promise.all) — mismo criterio que /api/cron/sync:
        // correr todos los tenants en paralelo amplificaría el 429 de Cost
        // Management en vez de evitarlo.
        for (const tenant of tenants) {
            try {
                const detailedRows = await getHistoricalDetailedCosts(tenant.id, HISTORICAL_GAP_BACKFILL_MONTHS);
                for (const row of detailedRows) {
                    if (row.kind === "meter") {
                        await insertCostMeterSnapshotRow(tenant.id, row.date, row);
                    } else if (row.kind === "category") {
                        await insertCostCategorySnapshotRow(tenant.id, row.date, row);
                    } else {
                        await insertCostSnapshotRow(tenant.id, row.date, row);
                    }
                    detailedRowsUpserted++;
                }

                const dailySeries = await getHistoricalDailyCosts(tenant.id, undefined, HISTORICAL_GAP_BACKFILL_MONTHS);
                for (const day of dailySeries) {
                    await insertCostSnapshot(tenant.id, day.date, day.cost, "USD");
                    dailyRowsUpserted++;
                }

                tenantsProcessed++;
                console.log(`[historical-gap-backfill] tenant=${tenant.id} detailedRows=${detailedRows.length} dailyRows=${dailySeries.length}`);
            } catch (err: any) {
                console.error(`[historical-gap-backfill] tenant=${tenant.id} failed:`, err.message);
                tenantErrors[tenant.id] = err.message;
            }
        }

        return NextResponse.json({
            status: "Historical gap backfill completed",
            tenantsTotal: tenants.length,
            tenantsProcessed,
            detailedRowsUpserted,
            dailyRowsUpserted,
            tenantErrors,
        });
    } catch (e: any) {
        console.error("Historical gap backfill fatal failure:", e);
        return NextResponse.json({ error: "Internal Server Error", details: e.message }, { status: 500 });
    }
}

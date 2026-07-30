import { NextRequest, NextResponse } from "next/server";
import pool, { insertCostSnapshot, insertCostSnapshotRow, insertCostMeterSnapshotRow, insertCostCategorySnapshotRow, insertAICostSnapshotRow, updateTenantHealth } from "@/modules/storage/db";
import { getYesterdaysCost, getYesterdaysDetailedCosts } from "@/modules/collectors/azure/billingService";
import { getYesterdaysAIUsage } from "@/modules/collectors/azure/aiUsageCollector";
import { getTenantCredentials } from "@/lib/secrets/tenantCredentials";

export async function GET(request: NextRequest) {
    return runSync(request);
}

export async function POST(request: NextRequest) {
    return runSync(request);
}

function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Máximo de días de backfill por tenant en una sola corrida — Cost
// Management ya se satura con solo "ayer" × N tenants (ver 429s en
// [BillingService]); intentar rellenar toda la ventana de una vez
// amplificaría el throttling. Se autocura de a poco, corrida tras corrida.
const MAX_BACKFILL_DAYS_PER_RUN = 2;
// Ventana hacia atrás en la que se buscan huecos (más allá de esto, se
// considera que el dato ya no es recuperable / no vale la pena reintentar).
const BACKFILL_WINDOW_DAYS = 7;

/**
 * Detecta qué días de los últimos BACKFILL_WINDOW_DAYS (sin contar ayer, que
 * siempre se sincroniza aparte, ni hoy, que Azure todavía no cerró) no
 * tienen ninguna fila en CostSnapshots para este tenant — típicamente por
 * throttling 429 de Cost Management que agotó los reintentos ese día (ver
 * investigación 2026-07-17). Devuelve las fechas más viejas primero, capadas
 * a MAX_BACKFILL_DAYS_PER_RUN.
 */
async function findGapDays(tenantId: string): Promise<Date[]> {
    const today = new Date();
    const candidates: Date[] = [];
    // i=1 es "ayer" (se sincroniza siempre, no como backfill); arrancamos en i=2.
    for (let i = 2; i <= BACKFILL_WINDOW_DAYS; i++) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        candidates.push(d);
    }
    const dateStrs = candidates.map(toDateStr);
    const [rows] = await pool.query<any[]>(
        `SELECT DISTINCT DATE(COALESCE(ChargePeriodStart, date)) AS d
         FROM CostSnapshots
         WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) IN (${dateStrs.map(() => '?').join(',')})`,
        [tenantId, ...dateStrs]
    );
    const present = new Set((rows as any[]).map(r => String(r.d).substring(0, 10)));
    const missing = candidates.filter(d => !present.has(toDateStr(d)));
    // Más viejo primero: prioriza cerrar el hueco más antiguo antes de que
    // salga de la ventana de backfill.
    missing.sort((a, b) => a.getTime() - b.getTime());
    return missing.slice(0, MAX_BACKFILL_DAYS_PER_RUN);
}

/** Sincroniza el aggregate + detalle FOCUS de un tenant para un día puntual. */
async function syncDay(tenantId: string, day: Date): Promise<{ dateStr: string; detailedRows: number }> {
    const dateStr = toDateStr(day);
    const totalCost = await getYesterdaysCost(tenantId, day);
    await insertCostSnapshot(tenantId, dateStr, totalCost, 'USD');

    const detailedRows = await getYesterdaysDetailedCosts(tenantId, day);
    for (const row of detailedRows) {
        if (row.kind === 'meter') {
            await insertCostMeterSnapshotRow(tenantId, dateStr, row);
        } else if (row.kind === 'category') {
            await insertCostCategorySnapshotRow(tenantId, dateStr, row);
        } else {
            await insertCostSnapshotRow(tenantId, dateStr, row);
        }
    }
    return { dateStr, detailedRows: detailedRows.length };
}

async function runSync(request: NextRequest) {
    try {
        // 1. Security Check — fail-closed if secret is not configured
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error('CRON_SECRET not configured or too short');
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        // 2. Define YYYY-MM-DD for yesterday
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = toDateStr(yesterday);

        // 3. Fetch all active tenants (only IDs — credentials come from KV per-tenant)
        //    El filtro por `provider_archived` es residuo del modelo multi-cloud
        //    retirado el 2026-07-29: la columna sigue en el esquema y hoy es
        //    siempre NULL, asi que el predicado no excluye a nadie. Se conserva
        //    porque es inofensivo y hace explicito que un tenant con la ingesta
        //    de Azure cortada no debe sincronizarse.
        const [tenants] = await pool.query<any[]>(
            `SELECT tenant_id as id FROM Tenants
              WHERE status = "active"
                AND (provider_archived IS NULL OR provider_archived <> 'azure')`
        );

        let tenantCount = 0;
        let detailRowsTotal = 0;
        let backfilledDaysTotal = 0;

        // 4. Sequential Loop (for...of) to avoid rate limits
        for (const tenant of tenants) {
            try {
                const creds = await getTenantCredentials(tenant.id);
                if (!creds) {
                    throw new Error("Azure client credentials are not configured for this tenant.");
                }

                // a) Aggregate total (legacy table cost_snapshots used by dashboard)
                const totalCost = await getYesterdaysCost(tenant.id);
                await insertCostSnapshot(tenant.id, yesterdayStr, totalCost, 'USD');

                // b) Detailed FOCUS rows (CostSnapshots — powers storage-efficiency,
                //    billing, chargeback, ai-analytics, etc.)
                try {
                    const detailedRows = await getYesterdaysDetailedCosts(tenant.id);
                    for (const row of detailedRows) {
                        // Mismo costo, dos desgloses: chargeback (por RG) va a
                        // CostSnapshots; meter (por subcategoría) a su propia
                        // tabla para no duplicar sumas ni colapsar tiers.
                        if (row.kind === 'meter') {
                            await insertCostMeterSnapshotRow(tenant.id, yesterdayStr, row);
                        } else if (row.kind === 'category') {
                            await insertCostCategorySnapshotRow(tenant.id, yesterdayStr, row);
                        } else {
                            await insertCostSnapshotRow(tenant.id, yesterdayStr, row);
                        }
                    }
                    detailRowsTotal += detailedRows.length;
                    console.log(`[cron-sync] tenant=${tenant.id} detailed rows inserted=${detailedRows.length}`);
                } catch (detailErr: any) {
                    console.error(`[cron-sync] detailed fetch failed for tenant ${tenant.id}:`, detailErr.message);
                }

                // b2) Backfill de huecos recientes: si un día previo se quedó sin
                // filas en CostSnapshots (típicamente 429 de Cost Management que
                // agotó reintentos ese día), lo reintenta acá — de a poco por
                // corrida para no sumar más presión de rate-limit sobre "ayer".
                try {
                    const gapDays = await findGapDays(tenant.id);
                    for (const gapDay of gapDays) {
                        try {
                            const { dateStr, detailedRows } = await syncDay(tenant.id, gapDay);
                            detailRowsTotal += detailedRows;
                            backfilledDaysTotal++;
                            console.log(`[cron-sync] tenant=${tenant.id} backfill ${dateStr} rows=${detailedRows}`);
                        } catch (gapErr: any) {
                            console.warn(`[cron-sync] backfill failed tenant=${tenant.id} day=${toDateStr(gapDay)}:`, gapErr.message);
                        }
                    }
                } catch (gapDetectErr: any) {
                    console.warn(`[cron-sync] findGapDays failed for tenant ${tenant.id}:`, gapDetectErr.message);
                }

                // c) Uso real de Azure OpenAI/Cognitive Services (tokens por modelo,
                //    vía Azure Monitor Metrics) — powers AI Cost Analytics. Falla
                //    aislada: si el SP no tiene Monitoring Reader o el tenant no
                //    tiene cuentas Cognitive Services, no interrumpe el resto del sync.
                try {
                    const aiRows = await getYesterdaysAIUsage(tenant.id);
                    for (const row of aiRows) {
                        await insertAICostSnapshotRow(tenant.id, yesterdayStr, row);
                    }
                    if (aiRows.length > 0) {
                        console.log(`[cron-sync] tenant=${tenant.id} AI usage rows inserted=${aiRows.length}`);
                    }
                } catch (aiErr: any) {
                    console.error(`[cron-sync] AI usage fetch failed for tenant ${tenant.id}:`, aiErr.message);
                }

                // d) Health OK
                await updateTenantHealth(tenant.id, 'OK');
                tenantCount++;
            } catch (err: any) {
                console.error(`Cron sync error for tenant ${tenant.id}:`, err.message);
                await updateTenantHealth(tenant.id, 'ERROR', err.message);
            }
        }

        return NextResponse.json({
            status: 'Sync completed',
            processed: tenantCount,
            detailedRows: detailRowsTotal,
            backfilledDays: backfilledDaysTotal
        });

    } catch (e: any) {
        console.error("Cron sync fatal failure:", e);
        return NextResponse.json({ error: "Internal Server Error", details: e.message }, { status: 500 });
    }
}

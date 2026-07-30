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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * REPARTO DEL BARRIDO (2026-07-30).
 *
 * El barrido ya era secuencial por tenant, pero sin ninguna pausa: cada tenant
 * disparaba "ayer" + detalle (3 desgloses) + días de hueco + uso de IA
 * pegados, y el siguiente arrancaba de inmediato. Cost Management responde a esa
 * ráfaga con 429 y, si un tenant agota sus reintentos, ese día NO se escribe en
 * CostSnapshots — que es la razón de fondo de que la tabla quede rala.
 *
 * Además desde el fix del scope de management group `getYesterdaysCost` consulta
 * UNA vez por suscripción en vez de una sola al MG, así que el volumen por tenant
 * subió y espaciar dejó de ser opcional.
 *
 * El job tiene timeout_seconds = 3600 y el barrido es secuencial, así que hay
 * presupuesto de sobra para pausar. PACE_BUDGET_MS es el cinturón de seguridad:
 * pasado ese punto se deja de pausar, porque terminar el barrido importa más que
 * espaciarlo — un job cortado por timeout no escribe nada.
 */
const TENANT_PACE_MS = Number(process.env.CRON_SYNC_TENANT_PACE_MS || 45_000);
const GAP_DAY_PACE_MS = Number(process.env.CRON_SYNC_GAP_PACE_MS || 10_000);
const PACE_BUDGET_MS = Number(process.env.CRON_SYNC_PACE_BUDGET_MS || 40 * 60 * 1000);

/**
 * Rota el orden de los tenants un puesto por día. Sin esto, el último tenant de
 * la lista es siempre el que corre con el rate-limit más gastado y el que más
 * días pierde. Con la rotación, el costo de ir último se reparte.
 */
export function rotateDaily<T>(items: T[], day: Date): T[] {
    if (items.length < 2) return items;
    const dayNumber = Math.floor(day.getTime() / 86400000);
    const offset = dayNumber % items.length;
    return [...items.slice(offset), ...items.slice(0, offset)];
}

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

/**
 * Techo de tiempo por tenant. El barrido es secuencial, así que sin esto UNA
 * llamada colgada a Azure se come la corrida entera.
 *
 * PASÓ DE VERDAD: en los logs de prod no existe NI UNA línea de fin de barrido en
 * 30 h. La corrida del 2026-07-30 escribió su última línea a las 06:01:41 —
 * 20 segundos después de arrancar, o sea no fue el timeout del job (3600 s) — y
 * nunca llegó al segundo tenant. Se quedó esperando una llamada a Azure sin
 * timeout propio, y el fetch del cron recién aborta a los 59,5 min: ni línea de
 * fin, ni error, y `CostSnapshots` con un solo día cargado.
 *
 * LIMITACIÓN QUE HAY QUE CONOCER: Promise.race NO cancela el trabajo de abajo. La
 * llamada colgada sigue viva en background; lo que se corta es la ESPERA, para que
 * el barrido siga con el resto de los tenants. Cancelarla de verdad requiere
 * propagar un AbortSignal hasta los SDK de Azure, que hoy no lo reciben. Aun así
 * esto es lo que evita que un tenant colgado deje a todos los demás sin datos.
 */
const TENANT_TIMEOUT_MS = Number(process.env.CRON_SYNC_TENANT_TIMEOUT_MS || 6 * 60 * 1000);

/** Se distingue del resto de errores para poder reportar "colgado" vs "falló". */
export class TenantSyncTimeout extends Error {
    constructor(label: string, ms: number) {
        super(`${label} superó el techo de ${ms}ms y se abandonó la espera`);
        this.name = 'TenantSyncTimeout';
    }
}

export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    if (!(ms > 0)) return work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TenantSyncTimeout(label, ms)), ms);
    });
    // El catch vacío evita un unhandledRejection cuando `work` falla DESPUÉS de que
    // el deadline ya rechazó: la promesa perdedora sigue viva y nadie la escucha.
    work.catch(() => { /* ya reportado por la race */ });
    return Promise.race([work, deadline]).finally(() => {
        if (timer) clearTimeout(timer);
    }) as Promise<T>;
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

/**
 * Todo el trabajo de UN tenant. Extraído del bucle para poder correrlo con un
 * deadline propio (withDeadline) — mientras estaba inline no había forma de acotar
 * el tiempo de un tenant sin acotar el barrido entero.
 *
 * Devuelve los contadores en vez de mutar variables de afuera, así el llamador
 * decide qué sumar: si el tenant se abandona por timeout, no se suma nada.
 *
 * `pace` es la pausa entre tandas de consultas al mismo scope; la inyecta el
 * llamador porque conoce el presupuesto del barrido.
 */
async function syncTenant(
    tenantId: string,
    yesterdayStr: string,
    pace: (ms: number) => Promise<void>
): Promise<{ detailRows: number; backfilledDays: number }> {
    let detailRows = 0;
    let backfilledDays = 0;

    const creds = await getTenantCredentials(tenantId);
    if (!creds) {
        throw new Error("Azure client credentials are not configured for this tenant.");
    }

    // a) Aggregate total (legacy table cost_snapshots used by dashboard)
    const totalCost = await getYesterdaysCost(tenantId);
    await insertCostSnapshot(tenantId, yesterdayStr, totalCost, 'USD');

    // b) Detailed FOCUS rows (CostSnapshots — powers storage-efficiency,
    //    billing, chargeback, ai-analytics, etc.)
    try {
        const detailedRows = await getYesterdaysDetailedCosts(tenantId);
        for (const row of detailedRows) {
            // Mismo costo, dos desgloses: chargeback (por RG) va a
            // CostSnapshots; meter (por subcategoría) a su propia
            // tabla para no duplicar sumas ni colapsar tiers.
            if (row.kind === 'meter') {
                await insertCostMeterSnapshotRow(tenantId, yesterdayStr, row);
            } else if (row.kind === 'category') {
                await insertCostCategorySnapshotRow(tenantId, yesterdayStr, row);
            } else {
                await insertCostSnapshotRow(tenantId, yesterdayStr, row);
            }
        }
        detailRows += detailedRows.length;
        console.log(`[cron-sync] tenant=${tenantId} detailed rows inserted=${detailedRows.length}`);
    } catch (detailErr: any) {
        console.error(`[cron-sync] detailed fetch failed for tenant ${tenantId}:`, detailErr.message);
    }

    // b2) Backfill de huecos recientes: si un día previo se quedó sin
    // filas en CostSnapshots (típicamente 429 de Cost Management que
    // agotó reintentos ese día), lo reintenta acá — de a poco por
    // corrida para no sumar más presión de rate-limit sobre "ayer".
    try {
        const gapDays = await findGapDays(tenantId);
        for (const gapDay of gapDays) {
            // Cada día de hueco es otra tanda completa de consultas
            // sobre los MISMOS scopes que acaba de usar "ayer" (por eso
            // se pausa también antes del primero).
            await pace(GAP_DAY_PACE_MS);
            try {
                const { dateStr, detailedRows } = await syncDay(tenantId, gapDay);
                detailRows += detailedRows;
                backfilledDays++;
                console.log(`[cron-sync] tenant=${tenantId} backfill ${dateStr} rows=${detailedRows}`);
            } catch (gapErr: any) {
                console.warn(`[cron-sync] backfill failed tenant=${tenantId} day=${toDateStr(gapDay)}:`, gapErr.message);
            }
        }
    } catch (gapDetectErr: any) {
        console.warn(`[cron-sync] findGapDays failed for tenant ${tenantId}:`, gapDetectErr.message);
    }

    // c) Uso real de Azure OpenAI/Cognitive Services (tokens por modelo,
    //    vía Azure Monitor Metrics) — powers AI Cost Analytics. Falla
    //    aislada: si el SP no tiene Monitoring Reader o el tenant no
    //    tiene cuentas Cognitive Services, no interrumpe el resto del sync.
    try {
        const aiRows = await getYesterdaysAIUsage(tenantId);
        for (const row of aiRows) {
            await insertAICostSnapshotRow(tenantId, yesterdayStr, row);
        }
        if (aiRows.length > 0) {
            console.log(`[cron-sync] tenant=${tenantId} AI usage rows inserted=${aiRows.length}`);
        }
    } catch (aiErr: any) {
        console.error(`[cron-sync] AI usage fetch failed for tenant ${tenantId}:`, aiErr.message);
    }

    return { detailRows, backfilledDays };
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

        // 4. Barrido secuencial y ESPACIADO (ver TENANT_PACE_MS), con el orden
        //    rotado un puesto por día para que ir último no le toque siempre al
        //    mismo tenant.
        const sweepStartedAt = Date.now();
        const withinPaceBudget = () => Date.now() - sweepStartedAt < PACE_BUDGET_MS;
        // Pausa que respeta el presupuesto del barrido: pasado PACE_BUDGET_MS deja de
        // pausar, porque terminar importa más que espaciar.
        const pace = async (ms: number) => {
            if (ms > 0 && withinPaceBudget()) await sleep(ms);
        };
        const sweep = rotateDaily(tenants, yesterday);
        console.log(`[cron-sync] barrido de ${sweep.length} tenants, pausa ${TENANT_PACE_MS}ms entre cada uno`);

        let timedOutTenants = 0;

        for (const [index, tenant] of sweep.entries()) {
            if (index > 0 && TENANT_PACE_MS > 0 && withinPaceBudget()) {
                await sleep(TENANT_PACE_MS);
            }
            const tenantStartedAt = Date.now();
            try {
                // Techo de tiempo por tenant: uno colgado no puede dejar sin datos a
                // los que vienen detrás. Ver TENANT_TIMEOUT_MS.
                const result = await withDeadline(
                    syncTenant(tenant.id, yesterdayStr, pace),
                    TENANT_TIMEOUT_MS,
                    `[cron-sync] tenant ${tenant.id}`
                );
                detailRowsTotal += result.detailRows;
                backfilledDaysTotal += result.backfilledDays;
                await updateTenantHealth(tenant.id, 'OK');
                tenantCount++;
                console.log(`[cron-sync] tenant=${tenant.id} listo en ${Date.now() - tenantStartedAt}ms (${index + 1}/${sweep.length})`);
            } catch (err: any) {
                if (err instanceof TenantSyncTimeout) {
                    timedOutTenants++;
                    console.error(`[cron-sync] tenant=${tenant.id} COLGADO tras ${Date.now() - tenantStartedAt}ms — se abandona y se sigue con el resto`);
                } else {
                    console.error(`Cron sync error for tenant ${tenant.id}:`, err.message);
                }
                await updateTenantHealth(tenant.id, 'ERROR', err.message);
            }
        }

        // Línea de cierre explícita: su AUSENCIA en los logs es lo que delata un
        // barrido cortado. Antes no existía y por eso el corte pasó desapercibido.
        console.log(
            `[cron-sync] barrido terminado en ${Date.now() - sweepStartedAt}ms — ` +
            `tenants ok=${tenantCount}/${sweep.length}, colgados=${timedOutTenants}, ` +
            `filas=${detailRowsTotal}, días rellenados=${backfilledDaysTotal}`
        );

        return NextResponse.json({
            status: 'Sync completed',
            timedOutTenants,
            processed: tenantCount,
            detailedRows: detailRowsTotal,
            backfilledDays: backfilledDaysTotal
        });

    } catch (e: any) {
        console.error("Cron sync fatal failure:", e);
        return NextResponse.json({ error: "Internal Server Error", details: e.message }, { status: 500 });
    }
}

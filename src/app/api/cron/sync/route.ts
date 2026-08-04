import { NextRequest, NextResponse } from "next/server";
import pool, { insertCostSnapshot, insertCostSnapshotRow, insertCostMeterSnapshotRow, insertCostCategorySnapshotRow, insertAICostSnapshotRow, updateTenantHealth } from "@/modules/storage/db";
import { getYesterdaysCost, getYesterdaysDetailedCosts } from "@/modules/collectors/azure/billingService";
import { getYesterdaysAIUsage } from "@/modules/collectors/azure/aiUsageCollector";
import { getTenantCredentials } from "@/lib/secrets/tenantCredentials";
import { redis } from "@/lib/redis";
import { recordCronRun } from "@/lib/cronRunTracker";

/**
 * DISPARAR Y CONSULTAR, NO ESPERAR (2026-07-30).
 *
 * El job de Container Apps que invoca este endpoint hace un fetch() y espera la
 * respuesta completa. El ingress de Azure Container Apps mata esa conexión a los
 * ~240s con 504 "stream timeout" — techo de plataforma, no configurable (se
 * verificó: no hay `requestTimeout` en `properties.configuration.ingress`). Con
 * 2+ tenants a ~140s cada uno el barrido SIEMPRE supera esos 240s, así que el job
 * quedaba marcado `Failed` en Azure —y la alerta correspondiente disparaba todos
 * los días— aunque el sync completara bien del lado del servidor (confirmado:
 * "barrido terminado ok=2/2, colgados=0" en el log, job igual Failed).
 *
 * Migrar el sync a un proceso propio del job (como hace `migrate`) NO es opción:
 * es una decisión ya tomada y documentada en el módulo de Terraform
 * (infra/terraform/modules/cronjobs/main.tf) — la lógica se queda DENTRO de la
 * app para reusar el pool de MySQL, los servicios y los guards de auth, en vez de
 * duplicarla en un script aparte.
 *
 * Así que el contrato HTTP cambia: `?status=1` sólo LEE el último estado desde
 * Redis (nunca dispara nada); sin ese parámetro DISPARA el barrido en background
 * y responde de inmediato — el proceso de la app sigue vivo después de responder
 * (no es una función serverless que se congela), así que el trabajo continúa. El
 * job pasa a hacer polling corto (cada request < 240s) hasta ver `done: true`.
 *
 * El lock en Redis de paso resuelve otra cosa que pasó en producción el mismo
 * día: dos disparos manuales del sync a 24 minutos de distancia, duplicando la
 * carga sobre Cost Management. Con el lock, el segundo disparo mientras el
 * primero sigue corriendo devuelve el estado actual en vez de arrancar de nuevo.
 */
const SYNC_STATUS_KEY = "cron:sync:status:v1";
const SYNC_LOCK_KEY = "cron:sync:lock:v1";
// Un poco por debajo del timeout del job (3600s): si una corrida se cuelga de
// verdad más allá de esto, el lock expira solo y el próximo tick puede
// reintentar — mismo espíritu que "sin retry automático, el próximo tick
// reintenta solo" del comentario en el módulo de Terraform.
const SYNC_LOCK_TTL_SECONDS = Number(process.env.CRON_SYNC_LOCK_TTL_SECONDS || 3300);

type SyncStatus = {
    startedAt: number;
    finishedAt: number | null;
    done: boolean;
    ok: boolean | null;
    processed?: number;
    tenantsTotal?: number;
    timedOutTenants?: number;
    detailedRows?: number;
    backfilledDays?: number;
    error?: string;
};

async function writeSyncStatus(status: SyncStatus): Promise<void> {
    // TTL generoso (24h): alcanza para que el próximo poll o una revisión manual
    // vea el resultado de la corrida anterior aunque no haya arrancado la de hoy.
    await redis.set(SYNC_STATUS_KEY, JSON.stringify(status), "EX", 86400);
}

async function readSyncStatus(): Promise<SyncStatus | null> {
    const raw = await redis.get(SYNC_STATUS_KEY);
    return raw ? JSON.parse(raw) : null;
}

export async function GET(request: NextRequest) {
    return handleRequest(request);
}

export async function POST(request: NextRequest) {
    return handleRequest(request);
}

async function handleRequest(request: NextRequest): Promise<NextResponse> {
    // Mismo chequeo que antes, sin tocar: sólo header Bearer, fail-closed.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.length < 16) {
        console.error('CRON_SECRET not configured or too short');
        return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    if (request.nextUrl.searchParams.get("status") === "1") {
        const status = await readSyncStatus();
        return NextResponse.json(status || { done: null });
    }

    const acquired = await redis.set(SYNC_LOCK_KEY, "1", "EX", SYNC_LOCK_TTL_SECONDS, "NX");
    if (!acquired) {
        const status = await readSyncStatus();
        return NextResponse.json({ alreadyRunning: true, status: status || { done: false } });
    }

    const startedAt = Date.now();
    await writeSyncStatus({ startedAt, finishedAt: null, done: false, ok: null });

    // Fire-and-forget deliberado: NO se espera acá (ver comentario grande arriba).
    runSyncCore()
        .then(async (result) => {
            const finishedAt = Date.now();
            await writeSyncStatus({ startedAt, finishedAt, done: true, ok: true, ...result });
            await recordCronRun({
                cronName: "sync",
                status: result.timedOutTenants > 0 ? "warning" : "ok",
                durationMs: finishedAt - startedAt,
                summary: `processed=${result.processed}/${result.tenantsTotal} timedOut=${result.timedOutTenants}`,
                details: {
                    processed: result.processed,
                    tenantsTotal: result.tenantsTotal,
                    timedOutTenants: result.timedOutTenants,
                    detailedRows: result.detailedRows,
                    backfilledDays: result.backfilledDays,
                },
            });
        })
        .catch((e: any) => {
            console.error("Cron sync fatal failure:", e);
            return Promise.all([
                writeSyncStatus({ startedAt, finishedAt: Date.now(), done: true, ok: false, error: e?.message || String(e) }),
                recordCronRun({
                    cronName: "sync",
                    status: "error",
                    durationMs: Date.now() - startedAt,
                    summary: e?.message || "sync failed",
                    details: { error: e?.message || String(e) },
                }),
            ]);
        })
        .finally(() => redis.del(SYNC_LOCK_KEY));

    return NextResponse.json({ status: "started", startedAt });
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
            await insertAICostSnapshotRow(tenantId, row.date || yesterdayStr, row);
        }
        if (aiRows.length > 0) {
            console.log(`[cron-sync] tenant=${tenantId} AI usage rows inserted=${aiRows.length}`);
        }
    } catch (aiErr: any) {
        console.error(`[cron-sync] AI usage fetch failed for tenant ${tenantId}:`, aiErr.message);
    }

    await invalidateCostCaches(tenantId);

    return { detailRows, backfilledDays };
}

/**
 * Sin esto, tarjetas como "Proyección de Gastos" (cache 6h) o el Whiteboard
 * (cache 1h) siguen mostrando el gasto de AYER hasta que su TTL expira solo,
 * aunque CostSnapshots ya tenga el dato de hoy — el mismo bug de fondo que
 * dashboard/summary (ver fetchMTDBreakdown), pero acá ninguna corrida lo
 * bustea nunca porque no depende de un query param `bust=1` manual.
 * `redis.keys` es aceptable acá: corre una vez por tenant al final del sync
 * diario, no en el hot path de un request de usuario.
 */
async function invalidateCostCaches(tenantId: string): Promise<void> {
    try {
        const patterns = [
            `costProjection:v4:${tenantId}:*`,
            `whiteboard:v2:azure:${tenantId}`,
        ];
        const keys = (await Promise.all(patterns.map((p) => redis.keys(p)))).flat();
        if (keys.length > 0) {
            await redis.del(...keys);
            console.log(`[cron-sync] tenant=${tenantId} cache invalidado: ${keys.join(', ')}`);
        }
    } catch (e: any) {
        console.warn(`[cron-sync] invalidateCostCaches falló para tenant ${tenantId}:`, e?.message);
    }
}

/**
 * El barrido en sí — sin auth (ya la resolvió `handleRequest`) y sin envolver en
 * NextResponse: quien la llama decide qué hacer con el resultado o el error
 * (hoy, escribirlo en el status de Redis). Antes esto vivía inline en el handler
 * HTTP y esperaba a que terminara para recién ahí responder; ver el comentario
 * grande al principio del archivo sobre por qué eso dejó de ser viable.
 */
async function runSyncCore() {
    // 1. Define YYYY-MM-DD for yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toDateStr(yesterday);

    // 2. Fetch all active tenants (only IDs — credentials come from KV per-tenant)
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

    // 3. Barrido secuencial y ESPACIADO (ver TENANT_PACE_MS), con el orden
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

    return {
        processed: tenantCount,
        tenantsTotal: sweep.length,
        timedOutTenants,
        detailedRows: detailRowsTotal,
        backfilledDays: backfilledDaysTotal,
    };
}

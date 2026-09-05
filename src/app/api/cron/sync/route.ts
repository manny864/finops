import { NextRequest, NextResponse } from "next/server";
import pool, { insertCostSnapshot, insertCostSnapshotRow, insertCostMeterSnapshotRow, insertCostCategorySnapshotRow, insertCostTagSnapshotRow, insertAICostSnapshotRow, updateTenantHealth } from "@/modules/storage/db";
import { getYesterdaysCost, getYesterdaysDetailedCosts } from "@/modules/collectors/azure/billingService";
import { getYesterdaysTagCosts } from "@/modules/collectors/azure/billing/yesterdayBillingService";
import { getTagKeysToFetch, hasRecentExportTagData } from "@/services/costTagSync.service";
import { getYesterdaysAIUsage } from "@/modules/collectors/azure/aiUsageCollector";
import { getTenantCredentials } from "@/lib/secrets/tenantCredentials";
import { redis } from "@/lib/redis";
import { recordCronRun } from "@/lib/cronRunTracker";
import { errorMessage } from '@/lib/apiErrors';
import { rotateDaily } from "@/lib/rotacionDiaria";

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
const SYNC_STALE_MS = Number(process.env.CRON_SYNC_STALE_MS || 20 * 60 * 1000);

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

/**
 * Claves de Redis del barrido global, o de un tenant puntual.
 *
 * Una corrida manual de UN tenant NO puede compartir clave con el barrido: el
 * job de Terraform hace polling de `?status=1` hasta ver `done: true`, y si un
 * disparo manual pisara ese estado el job daria por terminado un barrido que
 * sigue corriendo. Con claves separadas, el contrato del barrido queda igual
 * que antes byte por byte.
 */
function clavesDe(tenantId?: string) {
    return tenantId
        ? { status: `${SYNC_STATUS_KEY}:${tenantId}`, lock: `${SYNC_LOCK_KEY}:${tenantId}` }
        : { status: SYNC_STATUS_KEY, lock: SYNC_LOCK_KEY };
}

async function writeSyncStatus(status: SyncStatus, key: string = SYNC_STATUS_KEY): Promise<void> {
    // TTL generoso (24h): alcanza para que el próximo poll o una revisión manual
    // vea el resultado de la corrida anterior aunque no haya arrancado la de hoy.
    await redis.set(key, JSON.stringify(status), "EX", 86400);
}

async function readSyncStatus(key: string = SYNC_STATUS_KEY): Promise<SyncStatus | null> {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
}

function launchSync(startedAt: number, soloTenantId?: string): void {
    const { status: claveStatus, lock: claveLock } = clavesDe(soloTenantId);
    // Fire-and-forget deliberado: NO se espera acá (ver comentario grande arriba).
    runSyncCore(soloTenantId)
        .then(async (result) => {
            const finishedAt = Date.now();
            await writeSyncStatus({ startedAt, finishedAt, done: true, ok: true, ...result }, claveStatus);
            await recordCronRun({
                // Nombre propio para el disparo manual: si compartiera el del
                // barrido, el historial de corridas mezclaria "sincronice un
                // tenant" con "corrio el barrido de todos".
                cronName: soloTenantId ? "sync-manual" : "sync",
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
                writeSyncStatus({ startedAt, finishedAt: Date.now(), done: true, ok: false, error: e?.message || String(e) }, claveStatus),
                recordCronRun({
                    cronName: soloTenantId ? "sync-manual" : "sync",
                    status: "error",
                    durationMs: Date.now() - startedAt,
                    summary: e?.message || "sync failed",
                    details: { error: e?.message || String(e) },
                }),
            ]);
        })
        .finally(() => redis.del(claveLock));
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

    // Un `tenantId` en la query acota el barrido a ESE tenant. Lo manda el
    // disparo manual desde Cuentas Cloud (`account-status/sync-now`), que hasta
    // ahora lo pasaba y nadie lo leia: el boton decia "sincronizar este tenant"
    // y arrancaba el barrido completo. Sin el parametro --el caso del cron
    // programado-- no cambia nada.
    //
    // El guard de esta ruta es el Bearer CRON_SECRET de arriba, fail-closed: no
    // hay sesion de usuario que chequear acá. El `tenantId` no otorga acceso por
    // si mismo --sólo ACOTA el barrido, y contra la misma consulta filtrada por
    // `status = "active"`--, y quien lo manda es `account-status/sync-now`, que
    // ya corrió `requireTenantRole(['Admin','Owner'])` sobre ese tenant. Mismo
    // criterio y misma excepción que `cron/sync-azure-ai`.
    // eslint-disable-next-line local/no-unauth-tenant-id
    const soloTenantId = request.nextUrl.searchParams.get("tenantId") || undefined;
    const { status: claveStatus, lock: claveLock } = clavesDe(soloTenantId);

    if (request.nextUrl.searchParams.get("status") === "1") {
        const status = await readSyncStatus(claveStatus);
        return NextResponse.json(status || { done: null });
    }

    if (request.nextUrl.searchParams.get("force") === "1") {
        await redis.del(claveLock);
        const previous = await readSyncStatus(claveStatus);
        if (previous && previous.done === false) {
            await writeSyncStatus({
                ...previous,
                done: true,
                ok: false,
                finishedAt: Date.now(),
                error: "Sync anterior interrumpido por reinicio forzado.",
            }, claveStatus);
        }
    }

    const acquired = await redis.set(claveLock, "1", "EX", SYNC_LOCK_TTL_SECONDS, "NX");
    if (!acquired) {
        const status = await readSyncStatus(claveStatus);
        const stale =
            !!status &&
            status.done === false &&
            typeof status.startedAt === "number" &&
            Date.now() - status.startedAt > SYNC_STALE_MS;
        if (stale) {
            await redis.del(claveLock);
            await writeSyncStatus({
                ...status,
                done: true,
                ok: false,
                finishedAt: Date.now(),
                error: "Sync anterior marcado como stale y finalizado automáticamente.",
            }, claveStatus);
            const recovered = await redis.set(claveLock, "1", "EX", SYNC_LOCK_TTL_SECONDS, "NX");
            if (recovered) {
                const startedAt = Date.now();
                await writeSyncStatus({ startedAt, finishedAt: null, done: false, ok: null }, claveStatus);
                launchSync(startedAt, soloTenantId);
                return NextResponse.json({ status: "started", recoveredFromStale: true, startedAt });
            }
        }
        return NextResponse.json({ alreadyRunning: true, status: status || { done: false } });
    }

    const startedAt = Date.now();
    await writeSyncStatus({ startedAt, finishedAt: null, done: false, ok: null }, claveStatus);
    launchSync(startedAt, soloTenantId);

    return NextResponse.json({ status: "started", startedAt, tenantId: soloTenantId ?? null });
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

// `rotateDaily` vive en `@/lib/rotacionDiaria` desde el 2026-09-05: la usa
// tambien `historical-gap-backfill`, y una ruta no es lugar para un helper
// compartido (ver SEC-02 de la auditoria 2026-09-04). Se reexporta para no
// tocar los llamadores ni los tests que ya la importaban de aca.
export { rotateDaily };

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
 * El deadline aborta cooperativamente las llamadas Azure, esperas y mutaciones
 * compatibles. Si una dependencia ignora la señal, el timeout se reporta como
 * deadline excedido y las guardas posteriores impiden que escriba datos tarde.
 */
const TENANT_TIMEOUT_MS = Number(process.env.CRON_SYNC_TENANT_TIMEOUT_MS || 6 * 60 * 1000);

/** Se distingue del resto de errores para poder reportar "colgado" vs "falló". */
export class TenantSyncTimeout extends Error {
    constructor(label: string, ms: number) {
        super(`${label} superó el techo de ${ms}ms y se abandonó la espera`);
        this.name = 'TenantSyncTimeout';
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError');
    }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, label: string): Promise<T> {
    const controller = new AbortController();
    const task = work(controller.signal);
    if (!(ms > 0)) return task;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            const error = new TenantSyncTimeout(label, ms);
            controller.abort(error);
            reject(error);
        }, ms);
    });
    // El catch vacío evita un unhandledRejection cuando `work` falla DESPUÉS de que
    // el deadline ya rechazó: la promesa perdedora sigue viva y nadie la escucha.
    task.catch(() => { /* la tarea puede terminar después del deadline */ });
    return Promise.race([task, deadline]).finally(() => {
        if (timer) clearTimeout(timer);
    }) as Promise<T>;
}

/** Sincroniza el aggregate + detalle FOCUS de un tenant para un día puntual. */
async function syncDay(tenantId: string, day: Date, signal: AbortSignal): Promise<{ dateStr: string; detailedRows: number }> {
    const dateStr = toDateStr(day);
    const totalCost = await getYesterdaysCost(tenantId, day, signal);
    throwIfAborted(signal);
    await insertCostSnapshot(tenantId, dateStr, totalCost, 'USD');

    const detailedRows = await getYesterdaysDetailedCosts(tenantId, day, signal);
    for (const row of detailedRows) {
        throwIfAborted(signal);
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
 * MEJ-30 paso 2: trae el costo de ayer desglosado por etiqueta y lo persiste
 * en `CostTagSnapshots`.
 *
 * Devuelve cuántas filas escribió: 0 puede significar "no hacía falta" (el
 * tenant tiene export) o "no hay gasto etiquetado". El log distingue los dos
 * casos -- la query B de `getYesterdaysDetailedCosts` enseñó que un fallo
 * silencioso en una consulta de este pipeline puede quedar años sin que nadie
 * lo note.
 */
async function syncTagCosts(tenantId: string, dateStr: string, signal: AbortSignal): Promise<number> {
    if (await hasRecentExportTagData(tenantId)) {
        console.log(`[cron-sync] tenant=${tenantId} tag costs: omitido (ya llegan por export FOCUS)`);
        return 0;
    }

    const tagKeys = await getTagKeysToFetch(tenantId);
    const rows = await getYesterdaysTagCosts(tenantId, tagKeys, undefined, signal);
    for (const row of rows) {
        throwIfAborted(signal);
        await insertCostTagSnapshotRow(tenantId, dateStr, row);
    }
    console.log(`[cron-sync] tenant=${tenantId} tag costs: claves=[${tagKeys.join(', ')}] filas=${rows.length}`);
    return rows.length;
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
    pace: (ms: number, signal: AbortSignal) => Promise<void>,
    signal: AbortSignal,
): Promise<{ detailRows: number; backfilledDays: number; tagRows: number }> {
    let detailRows = 0;
    let backfilledDays = 0;
    let tagRows = 0;

    throwIfAborted(signal);
    const creds = await getTenantCredentials(tenantId);
    if (!creds) {
        throw new Error("Azure client credentials are not configured for this tenant.");
    }

    // a) Aggregate total (legacy table cost_snapshots used by dashboard)
    const totalCost = await getYesterdaysCost(tenantId, undefined, signal);
    throwIfAborted(signal);
    await insertCostSnapshot(tenantId, yesterdayStr, totalCost, 'USD');

    // b) Detailed FOCUS rows (CostSnapshots — powers storage-efficiency,
    //    billing, chargeback, ai-analytics, etc.)
    try {
        const detailedRows = await getYesterdaysDetailedCosts(tenantId, undefined, signal);
        for (const row of detailedRows) {
            throwIfAborted(signal);
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
    } catch (detailErr) {
        throwIfAborted(signal);
        console.error(`[cron-sync] detailed fetch failed for tenant ${tenantId}:`, errorMessage(detailErr));
    }

    // b1) MEJ-30 paso 2: desglose por etiqueta, SÓLO para tenants sin export
    //     FOCUS. Los que tienen export ya reciben `Tags` exacto por esa vía y
    //     no deben pagar consultas extra (criterio de aceptación 3).
    //
    //     En su propio try: si esto falla NO es un fallo del detalle, y
    //     reportarlo como tal mandaría a leer el log equivocado.
    try {
        tagRows += await syncTagCosts(tenantId, yesterdayStr, signal);
    } catch (tagErr) {
        throwIfAborted(signal);
        console.error(`[cron-sync] tag cost fetch failed for tenant ${tenantId}:`, errorMessage(tagErr));
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
            await pace(GAP_DAY_PACE_MS, signal);
            try {
                const { dateStr, detailedRows } = await syncDay(tenantId, gapDay, signal);
                detailRows += detailedRows;
                backfilledDays++;
                console.log(`[cron-sync] tenant=${tenantId} backfill ${dateStr} rows=${detailedRows}`);
            } catch (gapErr) {
                throwIfAborted(signal);
                console.warn(`[cron-sync] backfill failed tenant=${tenantId} day=${toDateStr(gapDay)}:`, errorMessage(gapErr));
            }
        }
    } catch (gapDetectErr) {
        throwIfAborted(signal);
        console.warn(`[cron-sync] findGapDays failed for tenant ${tenantId}:`, errorMessage(gapDetectErr));
    }

    // c) Uso real de Azure OpenAI/Cognitive Services (tokens por modelo,
    //    vía Azure Monitor Metrics) — powers AI Cost Analytics. Falla
    //    aislada: si el SP no tiene Monitoring Reader o el tenant no
    //    tiene cuentas Cognitive Services, no interrumpe el resto del sync.
    try {
        const aiRows = await getYesterdaysAIUsage(tenantId, signal);
        for (const row of aiRows) {
            throwIfAborted(signal);
            await insertAICostSnapshotRow(tenantId, row.date || yesterdayStr, row);
        }
        if (aiRows.length > 0) {
            console.log(`[cron-sync] tenant=${tenantId} AI usage rows inserted=${aiRows.length}`);
        }
    } catch (aiErr) {
        throwIfAborted(signal);
        console.error(`[cron-sync] AI usage fetch failed for tenant ${tenantId}:`, errorMessage(aiErr));
    }

    throwIfAborted(signal);
    await invalidateCostCaches(tenantId, signal);

    return { detailRows, backfilledDays, tagRows };
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
async function invalidateCostCaches(tenantId: string, signal?: AbortSignal): Promise<void> {
    try {
    throwIfAborted(signal);
        const patterns = [
            `costProjection:v4:${tenantId}:*`,
            // OJO: al bumpear la version de una clave hay que actualizarla ACA
            // tambien, o el cron deja de invalidarla y el dato viejo sobrevive
            // hasta que expire el TTL. Se dejan los comodines por version para
            // barrer tambien las claves de la version anterior tras un deploy.
            `whiteboard:v*:azure:${tenantId}:*`,
            `whiteboard:v*:${tenantId}:*`,
            `dashboard:summary:v*:${tenantId}:*`,
            `advisor:v*:${tenantId}:*`,
            // AI Cost Analytics (7/30/60/90 días): sin invalidación explícita
            // puede mostrar ceros/datos viejos hasta que expire el TTL.
            `ai-analytics:v2:${tenantId}:*`,
            `ai-analytics:v3:${tenantId}:*`,
            `ai-analytics:v4:${tenantId}:*`,
            `ai-analytics:v5:${tenantId}:*`,
            `ai-analytics:v6:${tenantId}:*`,
            `ai-analytics:v7:${tenantId}:*`,
        ];
        const keys = (await Promise.all(patterns.map((p) => redis.keys(p)))).flat();
        if (keys.length > 0) {
            throwIfAborted(signal);
            await redis.del(...keys);
            console.log(`[cron-sync] tenant=${tenantId} cache invalidado: ${keys.join(', ')}`);
        }
    } catch (e) {
        console.warn(`[cron-sync] invalidateCostCaches falló para tenant ${tenantId}:`, errorMessage(e));
    }
}

/**
 * El barrido en sí — sin auth (ya la resolvió `handleRequest`) y sin envolver en
 * NextResponse: quien la llama decide qué hacer con el resultado o el error
 * (hoy, escribirlo en el status de Redis). Antes esto vivía inline en el handler
 * HTTP y esperaba a que terminara para recién ahí responder; ver el comentario
 * grande al principio del archivo sobre por qué eso dejó de ser viable.
 */
async function runSyncCore(soloTenantId?: string) {
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
    //    Con `soloTenantId` se acota a ese tenant, pero SIN levantar los otros
    //    dos filtros: un tenant inactivo o con la ingesta de Azure archivada no
    //    debe sincronizarse ni aunque alguien lo pida a mano. Si no matchea, el
    //    barrido queda vacio y la corrida termina ok con processed=0.
    const [tenants] = await pool.query<any[]>(
        `SELECT tenant_id as id FROM Tenants
          WHERE status = "active"
            AND (provider_archived IS NULL OR provider_archived <> 'azure')` +
        (soloTenantId ? ` AND tenant_id = ?` : ``),
        soloTenantId ? [soloTenantId] : []
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
    const pace = async (ms: number, signal: AbortSignal) => {
        if (ms > 0 && withinPaceBudget()) await sleep(ms, signal);
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
                (signal) => syncTenant(tenant.id, yesterdayStr, pace, signal),
                TENANT_TIMEOUT_MS,
                `[cron-sync] tenant ${tenant.id}`
            );
            detailRowsTotal += result.detailRows;
            backfilledDaysTotal += result.backfilledDays;
            await updateTenantHealth(tenant.id, 'OK');
            tenantCount++;
            console.log(`[cron-sync] tenant=${tenant.id} listo en ${Date.now() - tenantStartedAt}ms (${index + 1}/${sweep.length})`);
        } catch (err) {
            if (err instanceof TenantSyncTimeout) {
                timedOutTenants++;
                console.error(`[cron-sync] tenant=${tenant.id} COLGADO tras ${Date.now() - tenantStartedAt}ms — se abandona y se sigue con el resto`);
            } else {
                console.error(`Cron sync error for tenant ${tenant.id}:`, errorMessage(err));
            }
            await updateTenantHealth(tenant.id, 'ERROR', errorMessage(err));
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

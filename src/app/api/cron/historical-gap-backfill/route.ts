/**
 * Backfill de huecos históricos (upsert-only), todos los tenants activos.
 *
 * DISPARAR Y CONSULTAR, NO ESPERAR. El ingress de Container Apps corta a los
 * ~240 s con 504 "stream timeout" — techo de plataforma, no configurable. Este
 * job puede tardar mucho más: con el relleno día por día, cada hueco es una
 * tanda de consultas más una pausa (GAP_BACKFILL_PACE_MS). Esperando la
 * respuesta, el job quedaba marcado Failed en Azure y disparaba la alerta
 * aunque el backfill terminara bien del lado del servidor.
 *
 * Contrato con el runner de `async_poll = true` (infra/terraform/modules/cronjobs):
 *   - Un GET/POST normal DISPARA el trabajo en background y responde de inmediato.
 *   - `?status=1` sólo LEE el último estado desde Redis; nunca dispara nada.
 *     Es crítico: si esa lectura ejecutara el backfill, cada poll (uno cada 15 s)
 *     lanzaría una corrida nueva contra Cost Management.
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { backfillMissingDaysOneByOne, backfillTenantHistoricalGaps } from "@/lib/historicalGapBackfill";
import { recordCronRun } from "@/lib/cronRunTracker";
import { rotateDaily } from "@/lib/rotacionDiaria";
import { redis } from "@/lib/redis";
import { errorMessage } from '@/lib/apiErrors';

const STATUS_KEY = "cron:historical-gap-backfill:status";
const LOCK_KEY = "cron:historical-gap-backfill:lock";
const LOCK_TTL_SECONDS = 60 * 60; // 1 h, alineado con timeout_seconds del job

type BackfillStatus = {
    startedAt: number;
    finishedAt?: number;
    done: boolean;
    ok?: boolean;
    tenantsTotal?: number;
    tenantsProcessed?: number;
    daysRecovered?: number;
    rowsUpserted?: number;
    throttledTenants?: number;
    tenantErrors?: Record<string, string>;
    error?: string;
};

async function writeStatus(status: BackfillStatus): Promise<void> {
    await redis.set(STATUS_KEY, JSON.stringify(status), "EX", 86400);
}

async function readStatus(): Promise<BackfillStatus | null> {
    const raw = await redis.get(STATUS_KEY);
    return raw ? JSON.parse(raw) : null;
}

/**
 * Techo de tiempo del barrido.
 *
 * No lo tenia, y por eso fallaba TODOS los dias con `poll timeout sin done` a
 * los ~3576 s: agotaba el presupuesto completo de sondeo del runner sin
 * terminar nunca. En tres dias de logs no hay una sola corrida completa, o sea
 * que los huecos historicos no se estaban rellenando.
 *
 * Cortar antes no pierde trabajo: el progreso se persiste dia a dia (ver el
 * comentario de `backfillMissingDaysOneByOne`), asi que lo recuperado queda y
 * la proxima corrida sigue desde donde se dejo.
 *
 * 45 min contra los 59.6 del presupuesto de sondeo: el margen es para que el
 * barrido termine y REPORTE, en vez de que lo mate el runner sin decir cuanto
 * alcanzo a hacer.
 */
const PRESUPUESTO_MS = Number(process.env.CRON_BACKFILL_BUDGET_MS || 45 * 60 * 1000);

async function runBackfillCore() {
    const [tenants] = await pool.query<any[]>(
        'SELECT tenant_id as id FROM Tenants WHERE status = "active"'
    );

    // Rotado un puesto por dia. Sin esto el presupuesto seria peor que no
    // tenerlo: los mismos tenants se procesarian siempre primero y los ultimos
    // no se rellenarian NUNCA. Mismo criterio y misma funcion que el barrido de
    // /api/cron/sync.
    const orden = rotateDaily(tenants, new Date());
    const arranque = Date.now();
    const tenantsPendientes: string[] = [];

    let tenantsProcessed = 0;
    let daysRecovered = 0;
    let rowsUpserted = 0;
    let throttledTenants = 0;
    const tenantErrors: Record<string, string> = {};

    // Secuencial (no Promise.all) — mismo criterio que /api/cron/sync:
    // correr todos los tenants en paralelo amplificaría el 429 de Cost
    // Management en vez de evitarlo.
    for (const tenant of orden) {
        if (Date.now() - arranque > PRESUPUESTO_MS) {
            tenantsPendientes.push(tenant.id);
            continue;
        }
        try {
            // Día por día primero: la consulta mensual es una sola llamada
            // enorme que Cost Management throttlea entera, y un 429 se lleva la
            // corrida completa. Acá el progreso queda persistido día a día.
            const daily = await backfillMissingDaysOneByOne(tenant.id);
            daysRecovered += daily.daysRecovered;
            rowsUpserted += daily.rowsUpserted;
            if (daily.abortedByThrottling) throttledTenants++;

            // Sólo si no recuperó nada Y no fue por throttling: ahí el problema
            // no es la cuota, así que vale la pena la consulta ancha.
            if (daily.daysRecovered === 0 && !daily.abortedByThrottling) {
                const wide = await backfillTenantHistoricalGaps(tenant.id);
                rowsUpserted += wide.detailedRowsUpserted;
            }
            tenantsProcessed++;
        } catch (err) {
            console.error(`[historical-gap-backfill] tenant=${tenant.id} failed:`, errorMessage(err));
            tenantErrors[tenant.id] = errorMessage(err);
        }
    }

    if (tenantsPendientes.length > 0) {
        console.warn(
            `[historical-gap-backfill] presupuesto de ${PRESUPUESTO_MS / 60000} min agotado; ` +
            `quedan ${tenantsPendientes.length} tenants para la proxima corrida (la rotacion diaria los pone primero)`
        );
    }

    return {
        tenantsTotal: tenants.length,
        tenantsProcessed,
        tenantsPendientes: tenantsPendientes.length,
        presupuestoAgotado: tenantsPendientes.length > 0,
        daysRecovered,
        rowsUpserted,
        throttledTenants,
        tenantErrors,
    };
}

function launchBackfill(startedAt: number): void {
    // Fire-and-forget deliberado: no se espera acá (ver comentario de arriba).
    runBackfillCore()
        .then(async (result) => {
            const finishedAt = Date.now();
            const hadErrors = Object.keys(result.tenantErrors).length > 0;
            await writeStatus({ startedAt, finishedAt, done: true, ok: true, ...result });
            await recordCronRun({
                cronName: "historical-gap-backfill",
                status: hadErrors || result.throttledTenants > 0 ? "warning" : "ok",
                durationMs: finishedAt - startedAt,
                summary: `processed=${result.tenantsProcessed}/${result.tenantsTotal} days=${result.daysRecovered} throttled=${result.throttledTenants}`,
                details: result as unknown as Record<string, unknown>,
            });
        })
        .catch(async (e: any) => {
            console.error("Historical gap backfill fatal failure:", e);
            await writeStatus({ startedAt, finishedAt: Date.now(), done: true, ok: false, error: errorMessage(e) });
            await recordCronRun({
                cronName: "historical-gap-backfill",
                status: "error",
                durationMs: Date.now() - startedAt,
                summary: errorMessage(e) || "backfill failed",
                details: { error: errorMessage(e) },
            });
        })
        .finally(() => {
            redis.del(LOCK_KEY).catch(() => {});
        });
}

export async function GET(request: NextRequest) {
    return handle(request);
}

export async function POST(request: NextRequest) {
    return handle(request);
}

async function handle(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.length < 16) {
        console.error("CRON_SECRET not configured or too short");
        return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    // SÓLO lectura. El runner llama esto cada 15 s; disparar acá lanzaría una
    // corrida nueva por cada poll.
    // new URL(request.url) y no request.nextUrl: equivalente en runtime y no
    // depende del wrapper de Next, así el contrato es testeable directamente.
    const { searchParams } = new URL(request.url);
    if (searchParams.get("status") === "1") {
        const status = await readStatus();
        return NextResponse.json(status || { done: null });
    }

    const startedAt = Date.now();
    const acquired = await redis.set(LOCK_KEY, "1", "EX", LOCK_TTL_SECONDS, "NX");
    if (!acquired) {
        // Ya hay una corrida en vuelo: se devuelve su estado en vez de arrancar
        // otra en paralelo contra la misma cuota de Cost Management.
        const status = await readStatus();
        return NextResponse.json(
            { status: "already-running", ...(status || {}) },
            { status: 202 }
        );
    }

    await writeStatus({ startedAt, done: false });
    launchBackfill(startedAt);

    return NextResponse.json(
        { status: "started", startedAt, poll: "?status=1" },
        { status: 202 }
    );
}

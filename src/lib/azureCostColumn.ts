/**
 * Selección de columna de costo para Azure Cost Management (Regla Cero).
 *
 * `PreTaxCost` viene en la MONEDA DE FACTURACIÓN de la suscripción (p.ej. ARS)
 * — la plataforma lo trataba como USD, inflando todos los montos órdenes de
 * magnitud para tenants no facturados en dólares. `CostUSD` es el costo ya
 * normalizado a USD por Azure, pero no todas las ofertas lo exponen (algunos
 * contratos legacy/EA lo rechazan con 400).
 *
 * Estrategia: una ÚNICA agregación por query (la forma de la respuesta no
 * cambia, así los parsers index-based `row[0]` siguen funcionando), cuyo
 * nombre se resuelve por tenant:
 *   1. Default: 'CostUSD'.
 *   2. Si Azure rechaza la agregación, se reintenta la misma query con
 *      'PreTaxCost' y la preferencia se recuerda en Redis (7 días) para no
 *      duplicar queries en cada llamada.
 *
 * Los lectores name-based deben aceptar ambas columnas: usar
 * `findCostColumnIndex(columns)`.
 */
import { redis } from "@/lib/redis";

export type CostColumn = "CostUSD" | "PreTaxCost";

const REDIS_KEY = (tenantId: string) => `billing:costcol:v1:${tenantId}`;
const REDIS_TTL_SECONDS = 7 * 24 * 3600;

// Cache in-memory (por proceso) para no pegarle a Redis en cada query del
// mismo request/batch. TTL corto: la fuente de verdad es Redis.
const memCache = new Map<string, { col: CostColumn; expires: number }>();
const MEM_TTL_MS = 5 * 60 * 1000;

export async function resolveCostColumn(tenantId: string): Promise<CostColumn> {
    const cached = memCache.get(tenantId);
    if (cached && cached.expires > Date.now()) return cached.col;

    try {
        const fromRedis = await redis.get(REDIS_KEY(tenantId));
        if (fromRedis === "PreTaxCost" || fromRedis === "CostUSD") {
            memCache.set(tenantId, { col: fromRedis, expires: Date.now() + MEM_TTL_MS });
            return fromRedis;
        }
    } catch {
        /* Redis caído: seguimos con el default */
    }
    return "CostUSD";
}

async function rememberCostColumn(tenantId: string, col: CostColumn): Promise<void> {
    memCache.set(tenantId, { col, expires: Date.now() + MEM_TTL_MS });
    try {
        await redis.set(REDIS_KEY(tenantId), col, "EX", REDIS_TTL_SECONDS);
    } catch {
        /* best-effort */
    }
}

/** Fuerza y recuerda PreTaxCost para este tenant (7 días) tras un 400 de CostUSD. */
export async function degradeCostColumn(tenantId: string): Promise<void> {
    await rememberCostColumn(tenantId, "PreTaxCost");
}

/** ¿El error es específicamente por la agregación CostUSD no soportada? */
export function isCostUsdUnsupportedError(e: any): boolean {
    const status = e?.statusCode ?? e?.status ?? e?.response?.status;
    const msg = String(e?.message || e?.body?.message || "");
    if (status !== undefined && status !== 400) return false;
    return /costusd/i.test(msg) || (/aggregation/i.test(msg) && /invalid|not supported|no válid/i.test(msg));
}

/**
 * Ejecuta `run(col)` con la columna preferida del tenant; si Azure rechaza
 * CostUSD, degrada a PreTaxCost, lo recuerda y reintenta UNA vez. Cualquier
 * otro error (auth, 429, scope) se propaga intacto para no interferir con
 * los fallbacks existentes (MG→subscripciones, etc.).
 */
export async function withCostColumn<T>(
    tenantId: string,
    run: (col: CostColumn) => Promise<T>
): Promise<T> {
    const col = await resolveCostColumn(tenantId);
    try {
        return await run(col);
    } catch (e: any) {
        if (col === "CostUSD" && isCostUsdUnsupportedError(e)) {
            console.warn(`[costColumn] CostUSD no soportado para tenant ${tenantId} — degradando a PreTaxCost (7d).`);
            await rememberCostColumn(tenantId, "PreTaxCost");
            return await run("PreTaxCost");
        }
        throw e;
    }
}

/**
 * Índice de la columna de costo en la respuesta de Cost Management,
 * aceptando cualquiera de las dos agregaciones posibles.
 */
export function findCostColumnIndex(columns: Array<{ name?: string }>): number {
    const usd = columns.findIndex((c) => /^costusd$/i.test(c?.name || ""));
    if (usd >= 0) return usd;
    return columns.findIndex((c) => /^pretaxcost$/i.test(c?.name || ""));
}

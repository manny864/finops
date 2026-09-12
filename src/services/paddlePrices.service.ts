/**
 * Lee los precios de los planes desde Paddle, que es quien cobra.
 *
 * POR QUÉ EXISTE
 * `PricingPage` mostraba los montos escritos a mano en el JSX y calculaba el
 * anual como `mensual * 0.88`. Daba el número correcto, pero por coincidencia
 * del redondeo contra la oferta de Paddle: nada ataba las dos cosas. El día que
 * cambie un precio o el descuento, la página seguiría mostrando el viejo y el
 * cliente vería un número y le cobrarían otro a un click de distancia.
 *
 * `pricing.ts` sigue existiendo y sigue siendo útil: es el fallback cuando
 * Paddle no responde, y es la fuente de los add-ons, que no tienen página
 * pública. Lo que cambia es cuál manda para el precio del plan.
 */

import { tierToPriceId, getPaddleBaseUrl, type TierName } from "@/lib/paddleTierMap";
import { ADDON_CATALOG } from "@/lib/addonCatalog";

export interface PlanPrices {
    /** Precio mensual, en la unidad mayor de la divisa (299.99, no 29999). */
    monthly: number | null;
    /** Precio ANUAL TOTAL, no el equivalente mensual. */
    annual: number | null;
    currency: string | null;
}

export interface PlanPricesResult {
    /** `paddle` si al menos un precio se leyó; `catalog` si hay que usar el fallback. */
    source: "paddle" | "catalog";
    plans: Record<string, PlanPrices>;
}

export interface ModulePrices {
    monthly: number;
    annual?: number;
    pass1m: number;
    pass3m: number;
    pass6m: number;
    pass9m: number;
    pass12m: number;
    currency: string;
}

export interface ModulePricesResult {
    source: "paddle" | "catalog";
    modules: Record<string, ModulePrices>;
}

/**
 * Divisas sin decimales. Paddle devuelve el monto en la denominación MÍNIMA, y
 * en estas el mínimo ES la unidad: 1000 JPY son 1000, no 10.
 *
 * Hoy la oferta está en USD y dividir siempre por 100 andaría. Está igual
 * porque es un camino de dinero: si algún día se agrega un precio en JPY, el
 * error sería de 100× y se vería recién en la factura del cliente.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
    "JPY", "KRW", "CLP", "ISK", "HUF", "TWD", "UGX", "VND", "VUV", "XAF", "XOF", "XPF", "BIF", "DJF", "GNF", "KMF", "RWF",
]);

/**
 * Convierte el `unit_price` de Paddle a la unidad mayor de la divisa.
 *
 * La doc de Paddle es explícita: `amount` viene como string en la denominación
 * más baja y **debe ser un entero válido** ("10 USD = 1000"). El regex no es
 * paranoia: si Paddle devolviera `"299.99"` en vez de `"29999"`, dividir por
 * 100 daría 2.9999 —un error de 100× en un precio— sin lanzar nada. Ante
 * cualquier forma inesperada devuelve `null` y el llamador cae al catálogo, que
 * es un número viejo pero no uno inventado.
 */
export function parsePaddleUnitPrice(unitPrice: unknown): { amount: number; currency: string } | null {
    if (!unitPrice || typeof unitPrice !== "object") return null;
    const { amount, currency_code: currencyCode } = unitPrice as { amount?: unknown; currency_code?: unknown };
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) return null;
    if (typeof currencyCode !== "string" || currencyCode.length !== 3) return null;
    const exponent = ZERO_DECIMAL_CURRENCIES.has(currencyCode.toUpperCase()) ? 0 : 2;
    return { amount: Number(amount) / 10 ** exponent, currency: currencyCode.toUpperCase() };
}

async function fetchPrice(priceId: string, apiKey: string): Promise<{ amount: number; currency: string } | null> {
    try {
        const resp = await fetch(`${getPaddleBaseUrl()}/prices/${priceId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!resp.ok) {
            console.warn(`[paddlePrices] ${priceId} devolvió ${resp.status}`);
            return null;
        }
        const json: any = await resp.json();
        const parsed = parsePaddleUnitPrice(json?.data?.unit_price);
        if (!parsed) {
            console.warn(`[paddlePrices] ${priceId}: unit_price con forma inesperada`);
        }
        return parsed;
    } catch (error) {
        console.warn(`[paddlePrices] ${priceId} falló:`, (error as Error).message);
        return null;
    }
}

/**
 * Caché en memoria. Los precios de lista cambian una vez por año si acaso, y
 * `/upgrade` es una página pública: sin caché, cada visita serían cuatro
 * llamadas a Paddle y un candidato a rate limit ajeno a nuestro control.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Un fallo se cachea sólo un minuto, no una hora.
 *
 * La primera versión guardaba el resultado con un único TTL, así que una
 * respuesta degradada --Paddle caído, o la API key sin permiso `price:read`,
 * que fue el caso real del 2026-09-03-- quedaba fijada 60 minutos y la página
 * seguía mostrando el catálogo mucho después de que el problema estuviera
 * resuelto. Mismo criterio que la caché del whiteboard.
 */
const CACHE_TTL_DEGRADED_MS = 60 * 1000;
let cache: { at: number; ttl: number; result: PlanPricesResult } | null = null;

export function clearPaddlePriceCache(): void {
    cache = null;
    moduleCache = null;
}

export function clearPaddleModulePriceCache(): void {
    moduleCache = null;
}

const TIERS: TierName[] = ["Professional", "Business"];

export async function getPlanPrices(): Promise<PlanPricesResult> {
    if (cache && Date.now() - cache.at < cache.ttl) return cache.result;

    const apiKey = process.env.PADDLE_API_KEY;
    const plans: Record<string, PlanPrices> = {};
    let algunoLeido = false;

    for (const tier of TIERS) {
        const monthlyId = tierToPriceId(tier, "monthly");
        const annualId = tierToPriceId(tier, "yearly");
        // Sin API key no se intenta: no es un error, es un entorno sin Paddle
        // configurado (dev local, CI). El fallback al catálogo es lo correcto.
        const monthly = apiKey && monthlyId ? await fetchPrice(monthlyId, apiKey) : null;
        const annual = apiKey && annualId ? await fetchPrice(annualId, apiKey) : null;
        if (monthly || annual) algunoLeido = true;
        plans[tier] = {
            monthly: monthly?.amount ?? null,
            annual: annual?.amount ?? null,
            currency: monthly?.currency ?? annual?.currency ?? null,
        };
    }

    const result: PlanPricesResult = { source: algunoLeido ? "paddle" : "catalog", plans };
    cache = {
      at: Date.now(),
      ttl: algunoLeido ? CACHE_TTL_MS : CACHE_TTL_DEGRADED_MS,
      result,
    };
    return result;
}

/**
 * Consulta múltiples precios en Paddle en un único llamado HTTP por lote.
 * Evita múltiples roundtrips secuenciales y protege de rate limits.
 */
export async function fetchPricesBatch(
    priceIds: string[],
    apiKey: string
): Promise<Record<string, { amount: number; currency: string }>> {
    const results: Record<string, { amount: number; currency: string }> = {};
    if (!priceIds.length || !apiKey) return results;

    const CHUNK_SIZE = 50;
    for (let i = 0; i < priceIds.length; i += CHUNK_SIZE) {
        const chunk = priceIds.slice(i, i + CHUNK_SIZE);
        try {
            const resp = await fetch(
                `${getPaddleBaseUrl()}/prices?id=${chunk.join(",")}&per_page=${CHUNK_SIZE}`,
                {
                    headers: { Authorization: `Bearer ${apiKey}` },
                }
            );
            if (!resp.ok) {
                console.warn(`[paddlePrices] fetchPricesBatch devolvió status ${resp.status}`);
                continue;
            }
            const json: any = await resp.json();
            const data = json?.data;
            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item?.id && item?.unit_price) {
                        const parsed = parsePaddleUnitPrice(item.unit_price);
                        if (parsed) {
                            results[item.id] = parsed;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn(`[paddlePrices] fetchPricesBatch falló:`, (error as Error).message);
        }
    }
    return results;
}

let moduleCache: { at: number; ttl: number; result: ModulePricesResult } | null = null;

/**
 * Lee los precios de todos los módulos y add-ons desde Paddle.
 * Si Paddle no responde o no hay API key (dev/CI), utiliza los valores base
 * de ADDON_CATALOG como fallback determinista e identifica source: "catalog".
 */
export async function getModulePrices(): Promise<ModulePricesResult> {
    if (moduleCache && Date.now() - moduleCache.at < moduleCache.ttl) return moduleCache.result;

    const apiKey = process.env.PADDLE_API_KEY;
    const catalog = ADDON_CATALOG;

    const priceIdsSet = new Set<string>();
    for (const product of Object.values(catalog)) {
        for (const id of Object.values(product.prices)) {
            if (id && typeof id === "string") priceIdsSet.add(id);
        }
    }

    const priceMap = apiKey && priceIdsSet.size > 0
        ? await fetchPricesBatch(Array.from(priceIdsSet), apiKey)
        : {};

    let algunoLeido = false;
    const modules: Record<string, ModulePrices> = {};

    for (const [key, product] of Object.entries(catalog)) {
        const p = product.prices;
        const b = product.basePriceUSD;

        const monthlyParsed = p.monthly ? priceMap[p.monthly] : null;
        const pass1mParsed = p.pass1m ? priceMap[p.pass1m] : null;
        const pass3mParsed = p.pass3m ? priceMap[p.pass3m] : null;
        const pass6mParsed = p.pass6m ? priceMap[p.pass6m] : null;
        const pass9mParsed = p.pass9m ? priceMap[p.pass9m] : null;
        const pass12mParsed = (p.pass12m ? priceMap[p.pass12m] : null) ?? (p.annual ? priceMap[p.annual] : null);
        const annualParsed = p.annual ? priceMap[p.annual] : null;

        if (monthlyParsed || pass1mParsed || pass3mParsed || pass6mParsed || pass9mParsed || pass12mParsed) {
            algunoLeido = true;
        }

        const currency =
            monthlyParsed?.currency ||
            pass1mParsed?.currency ||
            pass12mParsed?.currency ||
            "USD";

        modules[key] = {
            monthly: monthlyParsed?.amount ?? b.monthly,
            pass1m: pass1mParsed?.amount ?? b.pass1m,
            pass3m: pass3mParsed?.amount ?? b.pass3m,
            pass6m: pass6mParsed?.amount ?? b.pass6m,
            pass9m: pass9mParsed?.amount ?? b.pass9m,
            pass12m: pass12mParsed?.amount ?? b.pass12m,
            annual: annualParsed?.amount,
            currency,
        };
    }

    const result: ModulePricesResult = {
        source: algunoLeido ? "paddle" : "catalog",
        modules,
    };

    moduleCache = {
        at: Date.now(),
        ttl: algunoLeido ? CACHE_TTL_MS : CACHE_TTL_DEGRADED_MS,
        result,
    };

    return result;
}

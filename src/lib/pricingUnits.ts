import pool from "@/modules/storage/db";
import Decimal from "decimal.js";

/**
 * Pricing Unit Normalizer — feature B (FinOps toolkit derived).
 *
 * El billing de Azure reporta `UnitOfMeasure` en formatos heterogéneos:
 * `1 Hour`, `100 Hours`, `1 GB/Month`, `1 GB`, `10K Transactions`, etc.
 * Esto distorsiona agregados cross-servicio.
 *
 * `normalizeUnit(uomRaw, qty)` devuelve la cantidad expresada en la unidad
 * base (Hour, GB, Transaction) sin importar el block_size.
 *
 * Ej: normalizeUnit("100 Hours", 7.30) → { baseUnit: "Hour", normalizedQty: 730, display: "Hours" }
 */

export interface NormalizedUnit {
    baseUnit: string;
    normalizedQty: Decimal;
    display: string;
    category: string;
    /** True si el UoM no estaba en la tabla y se infirió desde el string. */
    inferred: boolean;
}

// In-memory cache cargado al primer acceso. Resetable vía resetCache().
let UNIT_CACHE: Map<string, { block: Decimal; baseUnit: string; display: string; category: string }> | null = null;

async function loadCache(): Promise<void> {
    const [rows]: any = await pool.query(
        "SELECT uom_raw, block_size, base_unit, display_unit, category FROM PricingUnits"
    );
    const m = new Map<string, { block: Decimal; baseUnit: string; display: string; category: string }>();
    for (const r of rows || []) {
        m.set(String(r.uom_raw).toLowerCase(), {
            block: new Decimal(r.block_size || 1),
            baseUnit: r.base_unit,
            display: r.display_unit || r.base_unit,
            category: r.category || "Other",
        });
    }
    UNIT_CACHE = m;
}

export function resetCache(): void {
    UNIT_CACHE = null;
}

/**
 * Fallback parser para UoM no mapeados. Detecta patrones tipo:
 *   "1 Hour", "100 Hours", "1/Hour", "10 GB", "1K Transactions", "1 GB/Month"
 */
function inferFromString(uomRaw: string): { block: Decimal; baseUnit: string; display: string; category: string } {
    const raw = uomRaw.trim();
    // patrón principal: "<num>[K|M] <unidad>[/period]"
    const m = raw.match(/^([\d.,]+)\s*([KMG]?)\s+(.+?)(?:\s*\/\s*(\w+))?$/i);
    if (m) {
        const num = new Decimal(m[1].replace(/,/g, ""));
        const mult = m[2]?.toUpperCase() === "K" ? 1000 : m[2]?.toUpperCase() === "M" ? 1_000_000 : m[2]?.toUpperCase() === "G" ? 1_000_000_000 : 1;
        const baseName = m[3].replace(/s$/i, ""); // singular
        return {
            block: num.mul(mult),
            baseUnit: baseName,
            display: m[3] + (m[4] ? `/${m[4]}` : ""),
            category: guessCategory(baseName),
        };
    }
    return { block: new Decimal(1), baseUnit: raw, display: raw, category: "Other" };
}

function guessCategory(baseUnit: string): string {
    const u = baseUnit.toLowerCase();
    if (/hour|second|minute|day/.test(u)) return "Time";
    if (/gb|tb|mb|byte/.test(u)) return "Storage";
    if (/transaction|operation|request|call/.test(u)) return "Transaction";
    if (/token/.test(u)) return "AI";
    return "Other";
}

/**
 * Normaliza una cantidad expresada en `uomRaw` a su unidad base.
 * Si el UoM no está en la tabla, infiere desde el string (con `inferred:true`).
 */
export async function normalizeUnit(uomRaw: string | null | undefined, qty: number | string | Decimal): Promise<NormalizedUnit> {
    const decimalQty = qty instanceof Decimal ? qty : new Decimal(qty || 0);
    if (!uomRaw) {
        return { baseUnit: "Unit", normalizedQty: decimalQty, display: "Unit", category: "Other", inferred: true };
    }
    if (UNIT_CACHE === null) await loadCache();
    const key = uomRaw.toLowerCase();
    const hit = UNIT_CACHE!.get(key);
    if (hit) {
        return {
            baseUnit: hit.baseUnit,
            normalizedQty: decimalQty.mul(hit.block),
            display: hit.display,
            category: hit.category,
            inferred: false,
        };
    }
    const inferred = inferFromString(uomRaw);
    return {
        baseUnit: inferred.baseUnit,
        normalizedQty: decimalQty.mul(inferred.block),
        display: inferred.display,
        category: inferred.category,
        inferred: true,
    };
}

/**
 * Versión síncrona para hot-paths una vez cargada la caché.
 * `preloadCache()` debe haberse llamado antes.
 */
export function normalizeUnitSync(uomRaw: string | null | undefined, qty: number | string | Decimal): NormalizedUnit {
    if (UNIT_CACHE === null) {
        const decimalQty = qty instanceof Decimal ? qty : new Decimal(qty || 0);
        return { baseUnit: "Unit", normalizedQty: decimalQty, display: uomRaw || "Unit", category: "Other", inferred: true };
    }
    const decimalQty = qty instanceof Decimal ? qty : new Decimal(qty || 0);
    if (!uomRaw) return { baseUnit: "Unit", normalizedQty: decimalQty, display: "Unit", category: "Other", inferred: true };
    const hit = UNIT_CACHE.get(uomRaw.toLowerCase());
    if (hit) {
        return { baseUnit: hit.baseUnit, normalizedQty: decimalQty.mul(hit.block), display: hit.display, category: hit.category, inferred: false };
    }
    const inferred = inferFromString(uomRaw);
    return { baseUnit: inferred.baseUnit, normalizedQty: decimalQty.mul(inferred.block), display: inferred.display, category: inferred.category, inferred: true };
}

export async function preloadCache(): Promise<void> {
    if (UNIT_CACHE === null) await loadCache();
}

export async function getCacheSize(): Promise<number> {
    if (UNIT_CACHE === null) await loadCache();
    return UNIT_CACHE!.size;
}

/**
 * Multi-currency helper (Feature D).
 *
 * Convierte montos USD a divisas display usando la tabla `FxRates` con
 * fallback a un seed estático embebido. Usa Decimal.js para evitar floats.
 *
 * Refresh oficial: cron diario que llama a `refreshRatesFromAPI` (no
 * incluido por defecto; provider externo configurable).
 */

import Decimal from "decimal.js";
import pool from "@/modules/storage/db";

export type CurrencyCode =
    | "USD" | "EUR" | "GBP" | "ARS" | "BRL" | "MXN" | "CLP" | "COP" | "PEN"
    | "CAD" | "AUD" | "JPY" | "CHF" | "CNY" | "INR";

export const SUPPORTED_CURRENCIES: CurrencyCode[] = [
    "USD", "EUR", "GBP", "ARS", "BRL", "MXN", "CLP", "COP", "PEN",
    "CAD", "AUD", "JPY", "CHF", "CNY", "INR",
];

// Fallback rates (aprox dic 2024). En prod los reemplaza el cron.
const FALLBACK_RATES: Record<CurrencyCode, string> = {
    USD: "1",
    EUR: "0.92",
    GBP: "0.79",
    ARS: "1020",
    BRL: "5.80",
    MXN: "20.20",
    CLP: "980",
    COP: "4350",
    PEN: "3.75",
    CAD: "1.40",
    AUD: "1.55",
    JPY: "157",
    CHF: "0.88",
    CNY: "7.30",
    INR: "84.50",
};

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
    USD: "$", EUR: "€", GBP: "£", ARS: "AR$", BRL: "R$", MXN: "MX$",
    CLP: "CLP$", COP: "COL$", PEN: "S/", CAD: "CA$", AUD: "AU$",
    JPY: "¥", CHF: "CHF", CNY: "¥", INR: "₹",
};

// Cache in-memory: clave `${target}|${dateOrLatest}` -> Decimal
const rateCache = new Map<string, { rate: Decimal; fetchedAt: number }>();
const TTL_MS = 60 * 60 * 1000; // 1h

export function isSupportedCurrency(c: string): c is CurrencyCode {
    return SUPPORTED_CURRENCIES.includes(c as CurrencyCode);
}

export function getCurrencySymbol(c: CurrencyCode): string {
    return CURRENCY_SYMBOLS[c] || c;
}

export async function getRate(target: CurrencyCode): Promise<Decimal> {
    if (target === "USD") return new Decimal(1);

    const cacheKey = `latest|${target}`;
    const cached = rateCache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < TTL_MS) {
        return cached.rate;
    }

    try {
        const [rows] = await pool.query(
            `SELECT rate FROM FxRates WHERE base_currency='USD' AND target_currency=? ORDER BY rate_date DESC LIMIT 1`,
            [target]
        );
        const arr = rows as Array<{ rate: string | number }>;
        if (arr.length > 0) {
            const r = new Decimal(arr[0].rate);
            rateCache.set(cacheKey, { rate: r, fetchedAt: Date.now() });
            return r;
        }
    } catch {
        // tabla puede no existir si la migración no corrió en este entorno
    }

    const fallback = new Decimal(FALLBACK_RATES[target] || "1");
    rateCache.set(cacheKey, { rate: fallback, fetchedAt: Date.now() });
    return fallback;
}

/**
 * Convierte `amountUSD` (number o Decimal) a la divisa objetivo.
 */
export async function convertFromUSD(
    amountUSD: number | string | Decimal,
    target: CurrencyCode
): Promise<Decimal> {
    const usd = new Decimal(amountUSD);
    if (target === "USD") return usd;
    const rate = await getRate(target);
    return usd.mul(rate);
}

/**
 * Formato display: símbolo + número con separadores locales.
 * Para divisas sin decimales (JPY, CLP, COP) redondea a 0.
 */
export function formatCurrency(
    amount: number | string | Decimal,
    currency: CurrencyCode,
    options: { locale?: string; compact?: boolean } = {}
): string {
    const d = new Decimal(amount);
    const noDecimals = ["JPY", "CLP", "COP", "ARS"].includes(currency);
    const fractionDigits = noDecimals ? 0 : 2;

    const num = Number(d.toFixed(fractionDigits));
    const locale = options.locale || "en-US";

    try {
        const formatted = new Intl.NumberFormat(locale, {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
            notation: options.compact ? "compact" : "standard",
        }).format(num);
        return `${getCurrencySymbol(currency)}${formatted}`;
    } catch {
        return `${getCurrencySymbol(currency)}${num.toFixed(fractionDigits)}`;
    }
}

export function resetFxCache() { rateCache.clear(); }

/**
 * Refresh desde provider externo (exchangerate.host es gratuito sin key).
 * Devuelve cantidad de monedas actualizadas. Si falla, no hace nada.
 */
export async function refreshRatesFromAPI(): Promise<{ updated: number; date: string }> {
    const url = `https://api.exchangerate.host/latest?base=USD&symbols=${SUPPORTED_CURRENCIES.filter(c => c !== "USD").join(",")}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`FX API HTTP ${res.status}`);
    const json = await res.json() as { rates?: Record<string, number>; date?: string };
    if (!json.rates) throw new Error("FX API sin rates");

    const date = json.date || new Date().toISOString().slice(0, 10);
    let updated = 0;
    for (const [cur, rate] of Object.entries(json.rates)) {
        if (!isSupportedCurrency(cur)) continue;
        await pool.query(
            `INSERT INTO FxRates (base_currency, target_currency, rate, rate_date, source)
             VALUES ('USD', ?, ?, ?, 'exchangerate.host')
             ON DUPLICATE KEY UPDATE rate=VALUES(rate), source=VALUES(source)`,
            [cur, rate, date]
        );
        updated++;
    }
    resetFxCache();
    return { updated, date };
}

/**
 * Lee la preferencia de display del usuario (fallback USD).
 */
export async function getUserDisplayCurrency(tenantId: string, userOid: string): Promise<CurrencyCode> {
    if (!tenantId || !userOid) return "USD";
    try {
        const [rows] = await pool.query(
            `SELECT display_currency FROM UserCurrencyPreference WHERE tenant_id=? AND user_oid=? LIMIT 1`,
            [tenantId, userOid]
        );
        const arr = rows as Array<{ display_currency: string }>;
        if (arr.length > 0 && isSupportedCurrency(arr[0].display_currency)) {
            return arr[0].display_currency as CurrencyCode;
        }
    } catch {
        // tabla puede no existir aún
    }
    return "USD";
}

export async function setUserDisplayCurrency(
    tenantId: string, userOid: string, currency: CurrencyCode
): Promise<void> {
    await pool.query(
        `INSERT INTO UserCurrencyPreference (tenant_id, user_oid, display_currency)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE display_currency=VALUES(display_currency)`,
        [tenantId, userOid, currency]
    );
}

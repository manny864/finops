import { FocusCostEntry } from '@/modules/core/focusMapper';
import { CostQueryDiagnostics } from './billingTypes';

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError');
    }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

export function extractRetryAfterMs(err: any): number | null {
    const headers = err?.response?.headers || err?.headers || {};
    const getHeader = (name: string): string | undefined => {
        if (typeof headers.get === 'function') {
            return headers.get(name) || headers.get(name.toLowerCase());
        }
        if (typeof headers === 'object' && headers !== null) {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === name.toLowerCase()) {
                    return String(headers[key]);
                }
            }
        }
        return undefined;
    };

    const raw = getHeader('retry-after')
        ?? getHeader('x-ms-ratelimit-microsoft.costmanagement-entity-retry-after')
        ?? getHeader('x-ms-ratelimit-microsoft.costmanagement-qps-retry-after')
        ?? getHeader('x-ms-ratelimit-microsoft.costmanagement-retry-after')
        ?? getHeader('x-ms-ratelimit-microsoft-consumption-retry-after');

    if (!raw) return null;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export function is429(err: any): boolean {
    const code = err?.code ?? err?.error?.code;
    const status = err?.statusCode ?? err?.status ?? err?.response?.status;
    const message = err?.message || err?.body?.message || '';
    return status === 429
        || code === 'TooManyRequests'
        || code === '429'
        || /too many requests|throttl|rate.?limit|please retry|429/i.test(String(message));
}

export type CacheEntry = { data: FocusCostEntry[]; diagnostics: CostQueryDiagnostics; expiresAt: number };
export const COST_CACHE = new Map<string, CacheEntry>();
export const CACHE_TTL_MS = 60_000; // 60s — solo deduplica bursts inmediatos

export const COST_INFLIGHT = new Map<string, Promise<{ data: FocusCostEntry[]; diagnostics: CostQueryDiagnostics }>>();

export function getFromCache(key: string): CacheEntry | null {
    const e = COST_CACHE.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { COST_CACHE.delete(key); return null; }
    return e;
}

export function setCache(key: string, data: FocusCostEntry[], diagnostics: CostQueryDiagnostics) {
    COST_CACHE.set(key, { data, diagnostics, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { maxRetries?: number; baseDelayMs?: number; label?: string; signal?: AbortSignal } = {},
): Promise<T> {
    const maxRetries = opts.maxRetries ?? 4;
    const baseDelay = opts.baseDelayMs ?? 2000;
    let attempt = 0;
    while (true) {
        throwIfAborted(opts.signal);
        try {
            return await fn();
        } catch (e) {
            if (!is429(e) || attempt >= maxRetries) throw e;
            const retryAfter = extractRetryAfterMs(e);
            const jitter = Math.floor(Math.random() * 800);
            const computedBackoff = Math.min(45_000, baseDelay * Math.pow(2.2, attempt) + jitter);
            const backoff = retryAfter ? Math.max(retryAfter, 1200) : computedBackoff;
            console.warn(`[BillingService] 429 on ${opts.label || 'azure call'}. Retry ${attempt + 1}/${maxRetries} in ${backoff}ms`);
            await sleep(backoff, opts.signal);
            attempt++;
        }
    }
}

export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, idx: number) => Promise<R>,
    signal?: AbortSignal,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            throwIfAborted(signal);
            const idx = i++;
            if (idx >= items.length) return;
            results[idx] = await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return results;
}

// ─── Scope de Management Group inutilizable ─────────────────────────────────
//
// Los cuatro servicios de billing (yesterday, mtd, historical, forecast)
// intentan primero el scope
// `/providers/Microsoft.Management/managementGroups/{tenantId}` y recién si
// falla caen a consultar suscripción por suscripción.
//
// En los tenants donde ese MG no existe o no tiene suscripciones asociadas, el
// intento falla SIEMPRE — y no falla barato: cada uno se lleva los 3 reintentos
// de `withRetry` con backoff (≈11 s y 3 llamadas contra la cuota de Cost
// Management) antes de rendirse. Multiplicado por cuatro servicios y por cada
// chunk de cada corrida, es una fracción enorme de la cuota gastada en
// consultas que ya se sabe que van a fallar. Ése fue el 429 sostenido del
// tenant 81ebe027 (ver incidente de huecos de agosto 2026).
//
// Se recuerda por tenant que el scope no sirve y se saltea directo a
// suscripciones. El TTL evita que la decisión quede grabada para siempre: si el
// cliente crea el management group más tarde, se vuelve a probar solo.

const MG_SCOPE_UNUSABLE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h
const mgScopeUnusableUntil = new Map<string, number>();

/** true si ya se comprobó que este tenant no puede usar el scope de MG. */
export function isMgScopeKnownUnusable(tenantId: string): boolean {
    const until = mgScopeUnusableUntil.get(tenantId);
    if (!until) return false;
    if (Date.now() > until) {
        mgScopeUnusableUntil.delete(tenantId);
        return false;
    }
    return true;
}

/**
 * Marca el scope de MG como inutilizable para este tenant.
 *
 * Sólo debe llamarse ante un fallo ESTRUCTURAL (el MG no existe, no tiene
 * suscripciones, no hay permisos), nunca ante un 429: un throttle es temporal y
 * marcarlo acá haría que el tenant dejara de usar el scope agregado —que es el
 * más barato— justo cuando más conviene.
 */
export function markMgScopeUnusable(tenantId: string, reason: string): void {
    if (isMgScopeKnownUnusable(tenantId)) return;
    mgScopeUnusableUntil.set(tenantId, Date.now() + MG_SCOPE_UNUSABLE_TTL_MS);
    console.warn(
        `[BillingService] Scope de management group inutilizable para ${tenantId}; ` +
        `se consultará por suscripción durante las próximas ${MG_SCOPE_UNUSABLE_TTL_MS / 3600000} h. Motivo: ${reason}`
    );
}

/** Un 429 no es un fallo estructural: el scope puede seguir sirviendo. */
export function isStructuralScopeFailure(err: unknown): boolean {
    if (is429(err)) return false;
    const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
    return (
        msg.includes('does not have any valid subscriptions') ||
        msg.includes('management group') ||
        msg.includes('notfound') ||
        msg.includes('not found') ||
        msg.includes('authorizationfailed') ||
        msg.includes('returned 0 rows')
    );
}

/** Sólo para tests: limpia el estado en memoria. */
export function resetMgScopeCache(): void {
    mgScopeUnusableUntil.clear();
}

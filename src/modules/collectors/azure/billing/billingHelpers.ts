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
    const raw = headers?.get?.('retry-after')
        ?? headers?.get?.('x-ms-ratelimit-microsoft-consumption-retry-after')
        ?? headers?.['retry-after']
        ?? headers?.['x-ms-ratelimit-microsoft-consumption-retry-after'];
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
    const baseDelay = opts.baseDelayMs ?? 1500;
    let attempt = 0;
    while (true) {
        throwIfAborted(opts.signal);
        try {
            return await fn();
        } catch (e: any) {
            if (!is429(e) || attempt >= maxRetries) throw e;
            const retryAfter = extractRetryAfterMs(e);
            const backoff = retryAfter ?? Math.min(30_000, baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 500));
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

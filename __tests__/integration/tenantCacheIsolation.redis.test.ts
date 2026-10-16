// @vitest-environment node
import type Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe.skipIf(!process.env.REDIS_SECURITY_PORT)("tenant cache isolation with disposable Redis", () => {
    let redis: Redis;
    let cache: typeof import("@/lib/cache");
    const globals: typeof globalThis & { redis?: Redis } = globalThis;
    const keys = new Set<string>();
    const tenantA = `isolation-a-${process.pid}`;
    const tenantB = `isolation-b-${process.pid}`;
    const remember = (key: string) => { keys.add(key); return key; };

    beforeAll(async () => {
        if (globals.redis) throw new Error("The integration test requires its own Redis client");
        vi.stubEnv("REDIS_HOST", "127.0.0.1");
        vi.stubEnv("REDIS_PORT", process.env.REDIS_SECURITY_PORT!);
        vi.stubEnv("REDIS_TLS", "false");
        vi.stubEnv("REDIS_PASSWORD", "");
        ({ redis } = await import("@/lib/redis"));
        await vi.waitFor(() => expect(redis.status).toBe("ready"));
        cache = await import("@/lib/cache");
    });
    afterAll(async () => {
        try {
            if (redis?.status === "ready" && keys.size) await redis.del(...keys);
        } finally {
            if (redis) {
                if (globals.redis === redis) delete globals.redis;
                redis.disconnect();
            }
            vi.unstubAllEnvs();
        }
    });

    it("shared cache builders separate tenants and subscription scopes, including normalized ARM IDs", async () => {
        const cases = [
            { a: cache.auditFullCacheKey(tenantA, "SUB-1"), b: cache.auditFullCacheKey(tenantB, "SUB-1"),
                otherScope: cache.auditFullCacheKey(tenantA, "sub-2") },
            { a: cache.auditTtlCacheKey(tenantA), b: cache.auditTtlCacheKey(tenantB) },
            { a: cache.liveAnomaliesCacheKey(tenantA), b: cache.liveAnomaliesCacheKey(tenantB) },
            ...cache.costGroupsCacheKeys(tenantA).map((a, index) => ({
                a, b: cache.costGroupsCacheKeys(tenantB)[index],
            })),
        ];
        expect(cache.auditFullCacheKey(tenantA, "SUB-1")).toBe(cache.auditFullCacheKey(tenantA, "sub-1"));
        expect(new Set(cases.flatMap(({ a, b }) => [a, b])).size).toBe(cases.length * 2);
        for (const item of cases) {
            const a = remember(item.a), b = remember(item.b);
            await Promise.all([
                cache.getWithStaleWhileRevalidate(a, async () => ({ tenant: tenantA }), 60, 30),
                cache.getWithStaleWhileRevalidate(b, async () => ({ tenant: tenantB }), 60, 30),
            ]);
            const unexpected = vi.fn(async () => ({ tenant: "unexpected-origin-call" }));
            expect(await cache.getWithStaleWhileRevalidate(a, unexpected, 60, 30)).toEqual({ tenant: tenantA });
            expect(await cache.getWithStaleWhileRevalidate(b, unexpected, 60, 30)).toEqual({ tenant: tenantB });
            expect(await cache.peekSwr(a)).toEqual({ tenant: tenantA });
            expect(await cache.peekSwr(b)).toEqual({ tenant: tenantB });
            expect(unexpected).not.toHaveBeenCalled();
            expect(await redis.ttl(a)).toBeGreaterThan(0);
            if (item.otherScope) {
                expect(await cache.peekSwr(remember(item.otherScope))).toBeNull();
            }
        }
    });

    it("cold concurrent requests deduplicate only within the same tenant key", async () => {
        const fetchers = [tenantA, tenantB].map((tenant) => ({
            key: remember(cache.auditFullCacheKey(tenant, "concurrent")),
            fetcher: vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
                return { tenant };
            }),
            tenant,
        }));
        await Promise.all(fetchers.flatMap(({ key, fetcher, tenant }) =>
            Array.from({ length: 12 }, async () => {
                expect(await cache.getWithStaleWhileRevalidate(key, fetcher, 60, 30)).toEqual({ tenant });
            })));
        for (const { key, fetcher, tenant } of fetchers) {
            expect(fetcher).toHaveBeenCalledOnce();
            expect(await cache.peekSwr(key)).toEqual({ tenant });
        }
    });

    it("stale concurrent refreshes return tenant-specific stale data then replace only their own envelope", async () => {
        const entries = [tenantA, tenantB].map((tenant) => {
            let release!: (value: { tenant: string; version: number }) => void;
            const refreshed = new Promise<{ tenant: string; version: number }>((resolve) => { release = resolve; });
            return { tenant, key: remember(cache.auditFullCacheKey(tenant, "refresh")),
                fetcher: vi.fn(() => refreshed), release };
        });
        for (const { key, tenant } of entries) {
            await redis.set(key, JSON.stringify({ __sw: true, t: Date.now() - 40_000,
                data: { tenant, version: 1 } }), "EX", 60);
        }
        try {
            await Promise.all(entries.flatMap(({ key, tenant, fetcher }) =>
                Array.from({ length: 12 }, async () => {
                    expect(await cache.getWithStaleWhileRevalidate(key, fetcher, 60, 30))
                        .toEqual({ tenant, version: 1 });
                })));
            for (const { fetcher } of entries) expect(fetcher).toHaveBeenCalledOnce();
        } finally {
            for (const { release, tenant } of entries) release({ tenant, version: 2 });
        }
        for (const { key, tenant } of entries) {
            await vi.waitFor(async () => expect(await cache.peekSwr(key)).toEqual({ tenant, version: 2 }));
        }
    });

    it("invalidating one tenant's periods leaves the other tenant's cached data intact", async () => {
        for (const tenant of [tenantA, tenantB]) {
            for (const key of cache.costGroupsCacheKeys(tenant)) {
                remember(key);
                await cache.getWithStaleWhileRevalidate(key, async () => ({ tenant }), 60, 30);
            }
        }
        await cache.invalidateCache(...cache.costGroupsCacheKeys(tenantA));
        for (const key of cache.costGroupsCacheKeys(tenantA)) expect(await cache.peekSwr(key)).toBeNull();
        for (const key of cache.costGroupsCacheKeys(tenantB)) {
            expect(await cache.peekSwr(key)).toEqual({ tenant: tenantB });
        }
        await cache.invalidateCachePattern(`cost-groups:v2:${tenantB}:*`);
        for (const key of cache.costGroupsCacheKeys(tenantB)) expect(await cache.peekSwr(key)).toBeNull();
    });

    it("hard expiration fetches only the expired tenant while preserving a fresh tenant entry", async () => {
        const a = remember(cache.auditFullCacheKey(tenantA, "expiration"));
        const b = remember(cache.auditFullCacheKey(tenantB, "expiration"));
        await cache.getWithStaleWhileRevalidate(a, async () => ({ tenant: tenantA, version: 1 }), 1);
        await cache.getWithStaleWhileRevalidate(b, async () => ({ tenant: tenantB, version: 1 }), 60, 30);
        await vi.waitFor(async () => expect(await redis.exists(a)).toBe(0), { timeout: 2500, interval: 50 });
        const aFetcher = vi.fn(async () => ({ tenant: tenantA, version: 2 }));
        const bFetcher = vi.fn(async () => ({ tenant: tenantB, version: 2 }));
        expect(await cache.getWithStaleWhileRevalidate(a, aFetcher, 60, 30)).toEqual({ tenant: tenantA, version: 2 });
        expect(await cache.getWithStaleWhileRevalidate(b, bFetcher, 60, 30)).toEqual({ tenant: tenantB, version: 1 });
        expect(aFetcher).toHaveBeenCalledOnce();
        expect(bFetcher).not.toHaveBeenCalled();
    });

    it("a failed miss is not cached or shared with a different tenant and can be retried", async () => {
        const a = remember(cache.auditFullCacheKey(tenantA, "failed-miss"));
        const b = remember(cache.auditFullCacheKey(tenantB, "failed-miss"));
        const failure = new Error("synthetic origin failure");
        const results = await Promise.allSettled([
            cache.getWithStaleWhileRevalidate(a, async () => { throw failure; }, 60),
            cache.getWithStaleWhileRevalidate(b, async () => ({ tenant: tenantB }), 60),
        ]);
        expect(results[0]).toEqual({ status: "rejected", reason: failure });
        expect(results[1]).toEqual({ status: "fulfilled", value: { tenant: tenantB } });
        expect(await cache.peekSwr(a)).toBeNull();
        expect(await cache.getWithStaleWhileRevalidate(a, async () => ({ tenant: tenantA }), 60))
            .toEqual({ tenant: tenantA });
        expect(await cache.peekSwr(b)).toEqual({ tenant: tenantB });
    });

    it("a degraded refresh with TTL zero preserves each tenant's last good cached value", async () => {
        for (const tenant of [tenantA, tenantB]) {
            const key = remember(cache.auditFullCacheKey(tenant, "degraded"));
            await redis.set(key, JSON.stringify({ __sw: true, t: Date.now() - 40_000,
                data: { tenant, healthy: true } }), "EX", 60);
            const fetcher = vi.fn(async () => ({ tenant, healthy: false }));
            expect(await cache.getWithStaleWhileRevalidate(key, fetcher, 60, 30, () => 0))
                .toEqual({ tenant, healthy: true });
            expect(fetcher).toHaveBeenCalledOnce();
            // Await a Redis round-trip after the refresh's resolved promise.
            await redis.ping();
            expect(await cache.peekSwr(key)).toEqual({ tenant, healthy: true });
            expect(await redis.ttl(key)).toBeGreaterThan(0);
        }
    });
});

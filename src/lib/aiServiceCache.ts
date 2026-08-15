import { redis } from './redis';

/**
 * AI Service Capabilities Cache — Redis-backed caching layer
 * 
 * **Caching Strategy:**
 * - Cache TTL: 2 hours (7200 seconds)
 * - First query of the period: fetch from Azure → cache to Redis
 * - Subsequent queries: serve from Redis until TTL expires
 * - Fallback: if Redis is down, fetch from Azure (no cache)
 * 
 * **Cache Key:** `ai:capabilities:${tenantId}`
 * 
 * **Rationale:**
 * Azure Monitor metrics and Resource Graph queries are expensive. Caching
 * for 2 hours balances freshness (respects hourly cron sync cadence) with
 * performance (99% cache hit after first query).
 */

const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2 hours
const CACHE_KEY_PREFIX = 'ai:capabilities';

export interface CachedCapabilities {
  capabilities: any[];
  cachedAt: number;
  source: 'redis' | 'azure';
}

/**
 * Get cached AI capabilities or return null if not in cache or expired.
 */
export async function getCachedCapabilities(tenantId: string): Promise<CachedCapabilities | null> {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}:${tenantId}`;
    const cached = await redis.get(cacheKey);
    
    if (!cached) return null;
    
    try {
      const data = JSON.parse(cached);
      return {
        ...data,
        source: 'redis' as const,
      };
    } catch (e) {
      console.error(`[aiServiceCache] Failed to parse cached data for ${tenantId}:`, e);
      return null;
    }
  } catch (e) {
    // Redis offline or connection error — fall through to Azure query
    console.warn(`[aiServiceCache] Redis GET failed for ${tenantId}:`, e);
    return null;
  }
}

/**
 * Cache AI capabilities to Redis with 2-hour TTL.
 */
export async function cacheCapabilities(
  tenantId: string,
  capabilities: any[]
): Promise<void> {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}:${tenantId}`;
    const payload = {
      capabilities,
      cachedAt: Date.now(),
    };
    
    await redis.setex(
      cacheKey,
      CACHE_TTL_SECONDS,
      JSON.stringify(payload)
    );
    
    console.log(
      `[aiServiceCache] Cached ${capabilities.length} capabilities for ${tenantId} (TTL: ${CACHE_TTL_SECONDS}s)`
    );
  } catch (e) {
    // Non-fatal: cache write failed, but Azure data is still valid
    console.warn(`[aiServiceCache] Redis SET failed for ${tenantId}:`, e);
  }
}

/**
 * Invalidate cached capabilities for a tenant (e.g., after manual sync).
 */
export async function invalidateCapabilitiesCache(tenantId: string): Promise<void> {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}:${tenantId}`;
    const deleted = await redis.del(cacheKey);
    console.log(`[aiServiceCache] Invalidated cache for ${tenantId} (deleted: ${deleted})`);
  } catch (e) {
    console.warn(`[aiServiceCache] Redis DEL failed for ${tenantId}:`, e);
  }
}

/**
 * Invalidate all AI service caches (e.g., on deployment or global sync).
 */
export async function invalidateAllCapabilitiesCaches(): Promise<void> {
  try {
    const keys = await redis.keys(`${CACHE_KEY_PREFIX}:*`);
    if (keys.length === 0) {
      console.log('[aiServiceCache] No caches to invalidate');
      return;
    }
    
    const deleted = await redis.del(...keys);
    console.log(`[aiServiceCache] Invalidated all caches (deleted: ${deleted}/${keys.length})`);
  } catch (e) {
    console.warn('[aiServiceCache] Redis KEYS/DEL failed:', e);
  }
}

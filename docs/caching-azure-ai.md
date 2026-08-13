# Azure AI Services Caching Strategy

## Overview

The **Azure AI Whiteboard** (`/api/intelligence/azure-ai` endpoint) uses a **2-hour Redis cache** to balance data freshness with query performance.

## Caching Behavior

### First Query of the Period
- Redis cache is **empty** or **expired** (> 2 hours old)
- Endpoint queries **Azure directly** (Resource Graph, Monitor metrics)
- Result is **cached to Redis** with TTL of **7200 seconds** (2 hours)
- Response includes: `"source": "azure", "cached": false, "cacheInfo": { "source": "azure", "cachedAt": null }`

### Subsequent Queries (within 2 hours)
- Redis cache is **hit**
- Endpoint serves data **from Redis** (no Azure queries)
- Response is **nearly instant** (< 50ms)
- Response includes: `"source": "redis", "cached": true, "cacheInfo": { "source": "redis", "cachedAt": "2026-08-12T23:30:00Z", "ttlSeconds": 7200 }`

### Cache Expiration
- After **2 hours**, cache entry is **automatically deleted** by Redis (TTL expiry)
- Next query falls back to Azure, caches result, cycle repeats
- This **aligns with cron sync cadence** (crons update snapshots hourly, cache keeps 2-hour freshness window)

## Cache Key

```
ai:capabilities:{tenantId}
```

Example: `ai:capabilities:81ebe027-e6af-4e09-bc73-58c9012c6408`

## Cache Invalidation

### Manual Invalidation (POST)

```bash
curl -X POST http://localhost:3000/api/intelligence/azure-ai \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <tenant-jwt>" \
  -d '{"tenantId": "81ebe027-e6af-4e09-bc73-58c9012c6408", "invalidateCache": true}'
```

Response:
```json
{
  "success": true,
  "message": "Cache invalidated for tenant 81ebe027-e6af-4e09-bc73-58c9012c6408",
  "timestamp": "2026-08-12T23:30:00Z"
}
```

**When to use:**
- After running a manual sync cron (e.g., `curl /api/cron/sync-azure-search`)
- To force a refresh during troubleshooting
- To test real Azure data without waiting for TTL

### Programmatic Invalidation

```typescript
import { invalidateCapabilitiesCache } from '@/lib/aiServiceCache';

await invalidateCapabilitiesCache(tenantId);
```

## Fallback Behavior

**If Redis is offline/unavailable:**
- Cache reads return `null` (cache miss)
- Endpoint queries **Azure directly** and returns data
- Data is **not cached** (no error, just reduced performance)
- Logs warning: `[aiServiceCache] Redis GET failed for {tenantId}: ...`
- Subsequent queries also hit Azure until Redis recovers

This ensures **service availability** even if Redis goes down.

## Performance Impact

| Scenario | Latency | Backend |
|----------|---------|---------|
| **Cache hit** (95% of requests) | ~50ms | Redis in-memory |
| **Cache miss (first query)** | 5-30s | Azure queries + DB |
| **Cache miss (Redis down)** | 5-30s | Azure queries + DB |

## Monitoring

### Cache Hit Rate

Check Redis for cache keys:
```bash
redis-cli KEYS 'ai:capabilities:*'
```

Example output:
```
1) "ai:capabilities:81ebe027-e6af-4e09-bc73-58c9012c6408"
2) "ai:capabilities:550e8400-e29b-41d4-a716-446655440000"
```

### Cache TTL

Check remaining time on a cache entry:
```bash
redis-cli TTL "ai:capabilities:81ebe027-e6af-4e09-bc73-58c9012c6408"
```

Example output:
```
(integer) 6842  # 6842 seconds remaining (started at 7200)
```

### Endpoint Logs

The endpoint logs cache operations:
```
[azure-ai] Serving cached capabilities for 81ebe027-e6af-4e09-bc73-58c9012c6408 (cached 120s ago)
[azure-ai] Cache miss for 81ebe027-e6af-4e09-bc73-58c9012c6408, querying Azure...
[aiServiceCache] Cached 7 capabilities for 81ebe027-e6af-4e09-bc73-58c9012c6408 (TTL: 7200s)
```

## Configuration

| Setting | Value | File |
|---------|-------|------|
| TTL | 7200s (2 hours) | `src/lib/aiServiceCache.ts:20` |
| Cache key prefix | `ai:capabilities` | `src/lib/aiServiceCache.ts:21` |
| Redis host | `REDIS_HOST` env var | `src/lib/redis.ts` |
| Redis TLS | `REDIS_TLS` env var | `src/lib/redis.ts` |

To change TTL, edit `CACHE_TTL_SECONDS` in `src/lib/aiServiceCache.ts`:
```typescript
const CACHE_TTL_SECONDS = 2 * 60 * 60; // Change 2 to desired hours
```

## Response Headers

The endpoint returns cache status in the JSON body:

```json
{
  "success": true,
  "cached": true,  // or false
  "capabilities": [...],
  "cacheInfo": {
    "source": "redis",  // or "azure"
    "cachedAt": "2026-08-12T23:30:00Z",
    "ttlSeconds": 7200
  }
}
```

Use `cached` and `source` fields for client-side logging or debugging.

## FAQ

**Q: Why 2 hours?**  
A: Cron jobs update snapshots every 1 hour. A 2-hour cache window ensures data is never more than 1 hour stale (best case: just cached, worst case: 1h+59m old) while minimizing Azure query load.

**Q: What if I need real-time data?**  
A: Use the invalidation endpoint to clear the cache, then make a fresh query.

**Q: Does cache include mock data?**  
A: No. Only real tenants are cached. Mock tenants skip the cache layer entirely.

**Q: Can I adjust TTL per tenant?**  
A: Currently no. TTL is global. To add per-tenant TTL, modify `cacheCapabilities()` in `src/lib/aiServiceCache.ts` to accept a `ttl` parameter.

## See Also

- Caching helper: `src/lib/aiServiceCache.ts`
- Endpoint: `src/app/api/intelligence/azure-ai/route.ts`
- Redis client: `src/lib/redis.ts`
- Collectors (data sources): `src/modules/collectors/azure/`
- Cron jobs (snapshot sync): `src/app/api/cron/sync-*/`

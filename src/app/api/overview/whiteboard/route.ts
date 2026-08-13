/**
 * GET /api/overview/whiteboard
 *
 * Whiteboard with Redis caching strategy:
 * - First request (or after 2h TTL): Fetch from Azure, cache in Redis (2h TTL)
 * - Subsequent requests within 2h: Serve from Redis cache
 * - Includes cached_at and cache_source in response metadata
 *
 * RBAC: Requires tenant access
 */

import { type NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireTenantAccess } from '@/lib/requestAuth';
import { isMockTenant } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2 hours
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };

async function fetchWhiteboardFromIntelligence(
    tenantId: string,
    request: NextRequest
): Promise<any> {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const url = new URL(`${baseUrl}/api/intelligence/whiteboard?tenantId=${tenantId}`);

    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('x-forwarded-request', 'true');

    const res = await fetch(url.toString(), {
        method: 'GET',
        headers: forwardHeaders,
        cache: 'no-store',
    });

    if (!res.ok) {
        throw new Error(`Intelligence whiteboard API returned ${res.status}`);
    }

    return res.json();
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
        return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
        await requireTenantAccess(request, tenantId);
    }

    const cacheKey = `whiteboard:v2:${tenantId}`;
    const bust = searchParams.get('bust') === '1';
    if (bust) {
        try { await redis.del(cacheKey); } catch { /* ignore */ }
    }

    // Try to get from Redis cache
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            const data = JSON.parse(cached);
            return NextResponse.json(
                {
                    success: true,
                    cache_source: 'redis',
                    cached_at: data.cached_at,
                    cache_ttl_seconds: CACHE_TTL_SECONDS,
                    ...data.payload,
                },
                { status: 200, headers: NO_STORE_HEADERS }
            );
        }
    } catch (err) {
        console.error('Redis cache read error:', err);
        // Fall through to fetch fresh data
    }

    // Cache miss or error: fetch fresh data
    try {
        const payload = await fetchWhiteboardFromIntelligence(tenantId, request);
        const cacheData = {
            cached_at: new Date().toISOString(),
            payload,
        };

        // Store in Redis with 2h TTL
        try {
            await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(cacheData));
        } catch (err) {
            console.error('Redis cache write error:', err);
            // Continue even if cache write fails
        }

        return NextResponse.json(
            {
                success: true,
                cache_source: 'azure',
                cached_at: cacheData.cached_at,
                cache_ttl_seconds: CACHE_TTL_SECONDS,
                ...payload,
            },
            { status: 200, headers: NO_STORE_HEADERS }
        );
    } catch (err) {
        console.error('Whiteboard fetch error:', err);
        return NextResponse.json(
            { error: 'Failed to fetch whiteboard data' },
            { status: 500 }
        );
    }
}

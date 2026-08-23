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
import { getInternalBaseUrl } from '@/lib/internalBaseUrl';

export const dynamic = 'force-dynamic';

const CACHE_TTL_SECONDS = 5 * 60; // 5 min TTL para datos frescos
const DEGRADED_CACHE_TTL_SECONDS = 60; // 1 min para reintento rápido si vino degradado
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' };

async function fetchWhiteboardFromIntelligence(
    tenantId: string,
    request: NextRequest,
    forceMock: boolean,
    locale: string,
    bust: boolean
): Promise<any> {
    const baseUrl = getInternalBaseUrl();
    const url = new URL(`${baseUrl}/api/intelligence/whiteboard?tenantId=${encodeURIComponent(tenantId)}`);
    url.searchParams.set('locale', locale);
    if (forceMock) url.searchParams.set('mock', 'true');
    if (bust) url.searchParams.set('bust', '1');

    const forwardHeaders = new Headers();
    forwardHeaders.set('x-forwarded-request', 'true');
    // Forward auth header if present (needed for RBAC on the intelligence endpoint)
    const authHeader = request.headers.get('authorization');
    if (authHeader) forwardHeaders.set('authorization', authHeader);

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
    const forceMock = searchParams.get('mock') === 'true';
    const locale = searchParams.get('locale') || 'es';

    if (!tenantId) {
        return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    if (!forceMock && !isMockTenant(tenantId)) {
        await requireTenantAccess(request, tenantId);
    }

    const cacheKey = `whiteboard:v4:${tenantId}:${locale}:${forceMock ? 'mock' : 'live'}`;
    const bust = searchParams.get('bust') === '1';
    if (bust) {
        try {
            await redis.del(cacheKey);
            await redis.del(`whiteboard:v5:azure:${tenantId}:es`);
            await redis.del(`whiteboard:v5:azure:${tenantId}:en`);
            await redis.del(`whiteboard:v5:azure:${tenantId}:pt-BR`);
        } catch { /* ignore */ }
    }

    // Try to get from Redis cache. mock=true usa una key separada para impedir
    // contaminación entre previews demo y tenants reales conectados.
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            const data = JSON.parse(cached);
            const payloadForClient = { ...(data.payload || {}) };
            delete payloadForClient._costDegraded;
            return NextResponse.json(
                {
                    success: true,
                    cache_source: 'redis',
                    cached_at: data.cached_at,
                    cache_ttl_seconds: CACHE_TTL_SECONDS,
                    ...payloadForClient,
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
        const payload = await fetchWhiteboardFromIntelligence(tenantId, request, forceMock, locale, bust);
        const cacheData = {
            cached_at: new Date().toISOString(),
            payload,
        };

        // Store in Redis with 2h TTL (o 5 min si el payload viene degradado).
        try {
            const ttl = payload?._costDegraded ? DEGRADED_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS;
            await redis.setex(cacheKey, ttl, JSON.stringify(cacheData));
        } catch (err) {
            console.error('Redis cache write error:', err);
            // Continue even if cache write fails
        }

        const payloadForClient = { ...(payload || {}) };
        delete payloadForClient._costDegraded;
        return NextResponse.json(
            {
                success: true,
                cache_source: 'azure',
                cached_at: cacheData.cached_at,
                cache_ttl_seconds: CACHE_TTL_SECONDS,
                ...payloadForClient,
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

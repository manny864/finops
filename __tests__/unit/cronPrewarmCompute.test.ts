// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'b'.repeat(24);

function makeFakeRedis() {
    const store = new Map<string, string>();
    return {
        status: 'ready',
        store,
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        set: vi.fn(async (key: string, value: string, ...args: any[]) => {
            const nx = args.includes('NX');
            if (nx && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        }),
        del: vi.fn(async (key: string) => {
            store.delete(key);
        }),
    };
}

let fakeRedis: ReturnType<typeof makeFakeRedis>;

vi.mock('@/lib/redis', () => ({
    get redis() {
        return fakeRedis;
    },
}));

vi.mock('@/modules/storage/db', () => ({
    default: {
        query: vi.fn(async () => [
            [{ id: 't-test-1', name: 'Tenant Test 1' }]
        ]),
    },
}));

vi.mock('@/lib/cronRunTracker', () => ({
    recordCronRun: vi.fn(async () => {}),
}));

vi.mock('@/lib/internalBaseUrl', () => ({
    getInternalBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

function request(qs = '', headers: Record<string, string> = { authorization: `Bearer ${CRON_SECRET}` }): NextRequest {
    return new NextRequest(`http://localhost/api/cron/prewarm-compute${qs}`, {
        headers,
    });
}

describe('GET / POST /api/cron/prewarm-compute — Job de Pre-cálculo de Cómputo', () => {
    beforeEach(() => {
        vi.resetModules();
        fakeRedis = makeFakeRedis();
        process.env.CRON_SECRET = CRON_SECRET;
        global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    it('rechaza llamadas sin autenticación válida', async () => {
        const { GET } = await import('@/app/api/cron/prewarm-compute/route');
        const res = await GET(request('', { authorization: 'Bearer invalid-token' }));
        expect(res.status).toBe(401);
    });

    it('inicia el prewarm de cómputo en background y responde 202 con statusPollUrl', async () => {
        const { POST } = await import('@/app/api/cron/prewarm-compute/route');
        const res = await POST(request());
        const json = await res.json();

        expect(res.status).toBe(202);
        expect(json.message).toContain('Prewarm compute job started');
        expect(json.statusPollUrl).toBe('/api/cron/prewarm-compute?status=1');
        expect(typeof json.startedAt).toBe('number');
    });

    it('devuelve status actual al consultar con ?status=1', async () => {
        const { GET } = await import('@/app/api/cron/prewarm-compute/route');
        const res = await GET(request('?status=1'));
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.done).toBe(false);
    });
});

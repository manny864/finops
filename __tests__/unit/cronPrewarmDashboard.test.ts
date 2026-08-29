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
    return new NextRequest(`http://localhost/api/cron/prewarm-dashboard${qs}`, {
        headers,
    });
}

describe('GET / POST /api/cron/prewarm-dashboard — antes síncrono, ahora async_poll (bandeja de alertas por timeout ~270s)', () => {
    beforeEach(() => {
        vi.resetModules();
        fakeRedis = makeFakeRedis();
        process.env.CRON_SECRET = CRON_SECRET;
        global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    it('rechaza llamadas sin autenticación válida', async () => {
        const { GET } = await import('@/app/api/cron/prewarm-dashboard/route');
        const res = await GET(request('', { authorization: 'Bearer invalid-token' }));
        expect(res.status).toBe(401);
    });

    it('acepta auth por query ?secret= (para el runner async del Container App Job)', async () => {
        const { GET } = await import('@/app/api/cron/prewarm-dashboard/route');
        const res = await GET(request(`?secret=${CRON_SECRET}`, {}));
        expect(res.status).toBe(202);
    });

    it('dispara el prewarm en background y responde 202 de inmediato, sin esperar el barrido', async () => {
        const { POST } = await import('@/app/api/cron/prewarm-dashboard/route');
        const res = await POST(request());
        const json = await res.json();

        expect(res.status).toBe(202);
        expect(json.message).toContain('Prewarm dashboard job started');
        expect(json.statusPollUrl).toBe('/api/cron/prewarm-dashboard?status=1');
        expect(typeof json.startedAt).toBe('number');
    });

    it('devuelve status "idle" antes de cualquier disparo', async () => {
        const { GET } = await import('@/app/api/cron/prewarm-dashboard/route');
        const res = await GET(request('?status=1'));
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.status).toBe('idle');
    });

    it('devuelve done=false mientras el barrido está en curso', async () => {
        const { POST, GET } = await import('@/app/api/cron/prewarm-dashboard/route');
        await POST(request());
        const res = await GET(request('?status=1'));
        const json = await res.json();

        expect(json.done).toBe(false);
    });

    it('un segundo disparo mientras hay uno activo responde already_running sin duplicar el lock', async () => {
        const { POST } = await import('@/app/api/cron/prewarm-dashboard/route');
        await POST(request());
        const res2 = await POST(request());
        const json2 = await res2.json();

        expect(res2.status).toBe(200);
        expect(json2.status).toBe('already_running');
    });
});

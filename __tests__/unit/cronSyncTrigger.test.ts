// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Cubre el cambio de contrato del 2026-07-30: el job de Container Apps espera la
 * respuesta HTTP completa, y el ingress de Azure la mata a los ~240s con 504
 * "stream timeout" — así que el sync ahora DISPARA en background y responde de
 * inmediato; el job hace polling con `?status=1` en vez de esperar.
 *
 * El lock en Redis además evita que dos disparos simultáneos (pasó en prod el
 * mismo día: dos personas corriendo el sync manual a 24 min de distancia)
 * arranquen dos barridos a la vez.
 */

const CRON_SECRET = 'a'.repeat(20);

// Redis en memoria con semántica NX/EX suficiente para el lock y el status.
function makeFakeRedis() {
    const store = new Map<string, string>();
    return {
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
    default: { query: vi.fn(async () => [[]]) }, // sin tenants: el barrido es instantáneo
    insertCostSnapshot: vi.fn(),
    insertCostSnapshotRow: vi.fn(),
    insertCostMeterSnapshotRow: vi.fn(),
    insertCostCategorySnapshotRow: vi.fn(),
    insertAICostSnapshotRow: vi.fn(),
    updateTenantHealth: vi.fn(),
}));

function request(qs = ''): NextRequest {
    return new NextRequest(`http://localhost/api/cron/sync${qs}`, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
}

describe('POST /api/cron/sync — disparo en background con lock', () => {
    beforeEach(() => {
        vi.resetModules();
        fakeRedis = makeFakeRedis();
        process.env.CRON_SECRET = CRON_SECRET;
    });

    it('sin ?status=1: dispara y responde de inmediato, sin esperar el barrido', async () => {
        const { POST } = await import('@/app/api/cron/sync/route');
        const res = await POST(request());
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.status).toBe('started');
        expect(typeof json.startedAt).toBe('number');
    });

    it('toma el lock al disparar, para que un segundo disparo no arranque otro barrido', async () => {
        const { POST } = await import('@/app/api/cron/sync/route');
        await POST(request());

        const second = await POST(request());
        const json = await second.json();

        expect(json.alreadyRunning).toBe(true);
        // No se pisa el lock: sólo un SET con NX pudo haber tenido éxito.
        const setCalls = fakeRedis.set.mock.calls.filter((c) => c[0] === 'cron:sync:lock:v1');
        expect(setCalls.length).toBe(2); // el segundo intento también llama set, pero NX lo rechaza
    });

    it('?status=1 sólo lee — nunca toma el lock ni dispara un barrido', async () => {
        const { GET } = await import('@/app/api/cron/sync/route');
        const res = await GET(request('?status=1'));
        const json = await res.json();

        expect(json.done).toBeNull();
        expect(fakeRedis.set).not.toHaveBeenCalled();
    });

    it('tras completar, ?status=1 refleja done:true, ok:true', async () => {
        const { POST, GET } = await import('@/app/api/cron/sync/route');
        await POST(request());
        // El barrido corre en background (fire-and-forget); con 0 tenants termina
        // en microtareas — un flush corto alcanza para que el .then() escriba el
        // status antes de leerlo.
        await new Promise((r) => setTimeout(r, 20));

        const res = await GET(request('?status=1'));
        const json = await res.json();

        expect(json.done).toBe(true);
        expect(json.ok).toBe(true);
        expect(json.processed).toBe(0);
    });

    it('rechaza sin el secret, en ambos modos', async () => {
        const { GET, POST } = await import('@/app/api/cron/sync/route');
        const noAuth = new NextRequest('http://localhost/api/cron/sync');

        expect((await POST(noAuth)).status).toBe(401);
        expect((await GET(new NextRequest('http://localhost/api/cron/sync?status=1'))).status).toBe(401);
    });
});

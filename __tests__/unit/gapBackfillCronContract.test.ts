// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, string>();
const redisSet = vi.fn(async (k: string, v: string, _ex?: string, _ttl?: number, nx?: string) => {
    if (nx === "NX" && store.has(k)) return null;
    store.set(k, v);
    return "OK";
});

vi.mock("@/lib/redis", () => ({
    redis: {
        set: (...a: any[]) => (redisSet as any)(...a),
        get: async (k: string) => store.get(k) ?? null,
        del: async (k: string) => { store.delete(k); return 1; },
    },
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn(async () => [[]]) } }));
vi.mock("@/lib/cronRunTracker", () => ({ recordCronRun: vi.fn() }));

const backfillMissingDaysOneByOne = vi.fn(async () => ({
    tenantId: "t", daysAttempted: 0, daysRecovered: 0, rowsUpserted: 0,
    abortedByThrottling: false, remainingDays: [],
}));
const backfillTenantHistoricalGaps = vi.fn(async () => ({
    tenantId: "t", detailedRowsUpserted: 0, dailyRowsUpserted: 0,
}));
vi.mock("@/lib/historicalGapBackfill", () => ({
    backfillMissingDaysOneByOne: (...a: any[]) => (backfillMissingDaysOneByOne as any)(...a),
    backfillTenantHistoricalGaps: (...a: any[]) => (backfillTenantHistoricalGaps as any)(...a),
}));

process.env.CRON_SECRET = "un-secreto-suficientemente-largo";

import { GET } from "@/app/api/cron/historical-gap-backfill/route";

function req(qs = "", auth = `Bearer ${process.env.CRON_SECRET}`) {
    return new Request(`http://localhost/api/cron/historical-gap-backfill${qs}`, {
        headers: auth ? { authorization: auth } : {},
    }) as never;
}

beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
});

describe("contrato async del cron de backfill", () => {
    it("un disparo responde de inmediato con 202, sin esperar el trabajo", async () => {
        // El ingress corta a ~240s; esperar acá marcaba el job Failed en Azure
        // aunque el backfill terminara bien.
        const res = await GET(req());
        expect(res.status).toBe(202);
        expect((await res.json()).status).toBe("started");
    });

    it("?status=1 SÓLO lee: nunca dispara una corrida", async () => {
        // Es lo crítico del contrato: el runner llama esto cada 15 s. Si
        // disparara, cada poll lanzaría un backfill contra Cost Management.
        const res = await GET(req("?status=1"));
        expect(res.status).toBe(200);
        expect(backfillMissingDaysOneByOne).not.toHaveBeenCalled();
        expect(backfillTenantHistoricalGaps).not.toHaveBeenCalled();
    });

    it("status devuelve done:null cuando nunca corrió", async () => {
        expect(await (await GET(req("?status=1"))).json()).toEqual({ done: null });
    });

    it("expone done:false mientras el trabajo sigue en curso", async () => {
        // Hace falta un tenant y trabajo que no resuelva al instante: con los
        // mocks inmediatos el fire-and-forget ya habría escrito done:true antes
        // de que el runner alcance a hacer su primer poll.
        const db = await import("@/modules/storage/db");
        (db.default.query as any).mockResolvedValue([[{ id: "t1" }]]);
        backfillMissingDaysOneByOne.mockImplementation(
            () => new Promise((r) => setTimeout(() => r({
                tenantId: "t1", daysAttempted: 1, daysRecovered: 1, rowsUpserted: 5,
                abortedByThrottling: false, remainingDays: [],
            }), 50)) as any
        );

        await GET(req());
        const status = await (await GET(req("?status=1"))).json();
        expect(status.done).toBe(false);
        expect(typeof status.startedAt).toBe("number");
    });

    it("no arranca una segunda corrida en paralelo", async () => {
        // Dos corridas simultáneas competirían por la misma cuota de Azure.
        await GET(req());
        const second = await GET(req());
        expect(second.status).toBe(202);
        expect((await second.json()).status).toBe("already-running");
    });

    it("rechaza sin el secreto del cron", async () => {
        const res = await GET(req("", "Bearer incorrecto"));
        expect(res.status).toBe(401);
    });

    it("el guard corre antes que la lectura de estado", async () => {
        const res = await GET(req("?status=1", "Bearer incorrecto"));
        expect(res.status).toBe(401);
    });
});

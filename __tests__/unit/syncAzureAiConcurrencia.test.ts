// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `cron/sync-azure-ai` hace un fetch a la propia web por cada tenant Enterprise (hasta 100), y cada fetch
 * lanza 8 colectores con su primera consulta a MySQL. Se lanzaban TODOS a la vez con `Promise.allSettled`:
 * con 5 tenants son 40 consultas simultáneas contra un pool de 10 + cola de 20, y las que sobraban fallaban
 * con `Queue limit reached` (~9.900 veces en 30 días en producción). Ahora va de a un tenant.
 */
const { poolQuery } = vi.hoisted(() => {
    process.env.CRON_SECRET = "secreto-de-prueba"; // el módulo lo lee al importarse
    return { poolQuery: vi.fn() };
});
vi.mock("@/modules/storage/db", () => ({ default: { query: poolQuery } }));
vi.mock("@/lib/redis", () => ({ redis: { status: "end" } }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/sync-azure-ai/route";

const pedir = (token = "secreto-de-prueba") =>
    GET(new NextRequest("http://localhost/api/cron/sync-azure-ai", { headers: token ? { Authorization: `Bearer ${token}` } : {} }));

const tenantsEnterprise = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}` }));

/** Un fetch que mide cuántos hay en vuelo a la vez. */
function fetchMedido(respuesta: (url: string) => { ok: boolean; status?: number; statusText?: string; body?: unknown }) {
    const estado = { enVuelo: 0, maximo: 0, llamadas: [] as string[] };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        estado.llamadas.push(url);
        estado.enVuelo++;
        estado.maximo = Math.max(estado.maximo, estado.enVuelo);
        await new Promise((r) => setTimeout(r, 5));
        estado.enVuelo--;
        const r = respuesta(url);
        return { ok: r.ok, status: r.status ?? 200, statusText: r.statusText ?? "OK", json: async () => r.body ?? {} };
    }));
    return estado;
}

beforeEach(() => {
    poolQuery.mockReset();
    vi.unstubAllGlobals();
});

describe("GET /api/cron/sync-azure-ai", () => {
    it("12 tenants Enterprise: se llama a los 12 pero de a uno (nunca 2 requests en vuelo)", async () => {
        poolQuery.mockResolvedValue([tenantsEnterprise(12), []]);
        const f = fetchMedido(() => ({ ok: true, body: { mock: false, capabilities: [1, 2] } }));

        const res = await pedir();
        const j = await res.json();

        expect(f.llamadas).toHaveLength(12);
        expect(f.maximo).toBe(1);
        expect(j).toMatchObject({ success: true, total: 12, cached: 12 });
    });

    it("la respuesta conserva su forma: un resultado por tenant, en orden", async () => {
        poolQuery.mockResolvedValue([tenantsEnterprise(3), []]);
        fetchMedido(() => ({ ok: true, body: { mock: false, capabilities: [1, 2, 3] } }));

        const j = await (await pedir()).json();

        expect(j.results).toEqual([
            { tenantId: "t1", cached: true, capCount: 3 },
            { tenantId: "t2", cached: true, capCount: 3 },
            { tenantId: "t3", cached: true, capCount: 3 },
        ]);
    });

    it("un tenant que falla (HTTP 500 o excepción) no frena ni oculta a los demás", async () => {
        poolQuery.mockResolvedValue([tenantsEnterprise(4), []]);
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (url.includes("tenantId=t2")) return { ok: false, status: 500, statusText: "Server Error", json: async () => ({}) };
            if (url.includes("tenantId=t3")) throw new Error("ECONNREFUSED");
            return { ok: true, status: 200, statusText: "OK", json: async () => ({ mock: false, capabilities: [1] }) };
        }));

        const j = await (await pedir()).json();

        expect(j.total).toBe(4);
        expect(j.cached).toBe(2);
        expect(j.results[1]).toEqual({ tenantId: "t2", cached: false, error: "Server Error" });
        expect(j.results[2]).toMatchObject({ tenantId: "t3", cached: false });
        expect(String(j.results[2].error)).toContain("ECONNREFUSED");
        expect(j.results[0].cached).toBe(true);
        expect(j.results[3].cached).toBe(true);
    });

    it("un tenant en demo no cuenta como cacheado (mock: true)", async () => {
        poolQuery.mockResolvedValue([tenantsEnterprise(2), []]);
        fetchMedido(() => ({ ok: true, body: { mock: true, capabilities: [] } }));
        const j = await (await pedir()).json();
        expect(j.cached).toBe(0);
    });

    it("sin tenants Enterprise responde igual que siempre", async () => {
        poolQuery.mockResolvedValue([[], []]);
        const j = await (await pedir()).json();
        expect(j).toMatchObject({ success: true, message: "No Enterprise tenants found", count: 0 });
    });

    it("sigue exigiendo el secreto de cron", async () => {
        expect((await pedir("otro")).status).toBe(401);
        expect((await pedir("")).status).toBe(401);
    });
});

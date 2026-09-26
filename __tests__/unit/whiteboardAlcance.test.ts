// @vitest-environment node
/**
 * MEJ-34 — la pizarra ejecutiva acotada.
 *
 * Tiene dos mitades y las dos tenían que moverse: el ENSAMBLADO vive en
 * `/api/intelligence/whiteboard` con siete consultas de costo, y lo que la UI
 * llama es `/api/overview/whiteboard`, un proxy. Sin reenviar los parámetros,
 * el recorte quedaba escrito y sin forma de llegar — que es el error que ya
 * había cometido dos veces en esta tanda, con `forecast` y con `scorecard`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, redisMock, fetchMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    redisMock: { get: vi.fn(async () => null), set: vi.fn(), setex: vi.fn(), del: vi.fn() },
    fetchMock: vi.fn(async () => new Response(JSON.stringify({ summary: { costMtdUSD: 1 } }), { status: 200 })),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ email: "u@u" })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/cache", () => ({ getWithStaleWhileRevalidate: (_k: string, fn: () => any) => fn() }));
vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/azure", () => ({ getAzureCredential: vi.fn(async () => { throw new Error("sin azure"); }) }));
vi.mock("@azure/arm-resourcegraph", () => ({ ResourceGraphClient: class { } }));
vi.mock("@/modules/collectors/azure/billingService", () => ({
    getCostForecast: vi.fn(async () => []),
    getCurrentMonthAmortizedCosts: vi.fn(async () => { throw new Error("sin azure"); }),
}));
vi.mock("@/services/azureAdvisor.service", () => ({
    getAdvisorExecutiveData: vi.fn(async () => ({})),
    buildAdvisorRemediationCommand: () => "",
}));
vi.mock("@/lib/advisorI18n", () => ({ translateAdvisorText: (s: string) => s }));
vi.mock("@/lib/internalBaseUrl", () => ({ getInternalBaseUrl: () => "http://localhost:3000" }));

import { GET as ensamblado } from "@/app/api/intelligence/whiteboard/route";
import { GET as proxy } from "@/app/api/overview/whiteboard/route";

const DIMENSIONES = [
    { subscription_id: "s1", resource_group: "rg-prod", service_name: "VM", ResourceId: "/r/1", Tags: { Environment: "prod" } },
    { subscription_id: "s1", resource_group: "rg-dev", service_name: "VM", ResourceId: "/r/2", Tags: { Environment: "dev" } },
];

const ACOTADO = "&perspective=7&pgroup=Producci%C3%B3n";

beforeEach(() => {
    queryMock.mockReset().mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("FROM Perspectives")) return [[{ id: 7, name: "Entorno", description: null }]];
        if (s.includes("FROM PerspectiveRules")) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        if (s.includes("SELECT DISTINCT subscription_id")) return [DIMENSIONES];
        return [[]];
    });
    redisMock.get.mockReset().mockResolvedValue(null);
    redisMock.setex.mockReset();
    redisMock.del.mockReset();
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ summary: { costMtdUSD: 1 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
});

const deCosto = () => queryMock.mock.calls.filter(([sql]) =>
    String(sql).includes("FROM CostSnapshots") && !String(sql).includes("SELECT DISTINCT subscription_id"));

describe("el ensamblado de la pizarra", () => {
    it("acota sus SIETE consultas de costo, no algunas", async () => {
        const j = await (await ensamblado(new NextRequest(`http://localhost/api/intelligence/whiteboard?tenantId=t1${ACOTADO}`))).json();

        expect(j.scopeApplied).toBe(true);
        const consultas = deCosto();
        expect(consultas.length).toBeGreaterThanOrEqual(7);
        for (const [sql, params] of consultas) {
            expect(String(sql)).toContain("COALESCE(ResourceId,'')");
            expect(params).toContain("rg-prod");
            expect(params).not.toContain("rg-dev");
        }
    });

    it("los parámetros siguen alineados con los placeholders", async () => {
        // Siete consultas con siete formas de armar sus parámetros: unas ponen
        // fechas antes del WHERE y otras después.
        await ensamblado(new NextRequest(`http://localhost/api/intelligence/whiteboard?tenantId=t1${ACOTADO}`));
        for (const [sql, params] of queryMock.mock.calls) {
            const placeholders = (String(sql).match(/\?/g) || []).length;
            expect({ q: String(sql).slice(0, 50), n: placeholders })
                .toEqual({ q: String(sql).slice(0, 50), n: (params as unknown[] | undefined)?.length ?? 0 });
        }
    });

    it("sin alcance el ensamblado es el de siempre", async () => {
        const j = await (await ensamblado(new NextRequest("http://localhost/api/intelligence/whiteboard?tenantId=t1"))).json();
        expect(j.scopeApplied).toBe(false);
        for (const [sql] of deCosto()) expect(String(sql)).not.toContain("COALESCE(ResourceId,'')");
    });
});

describe("el proxy que la UI llama", () => {
    it("reenvía el alcance al ensamblado", async () => {
        await proxy(new NextRequest(`http://localhost/api/overview/whiteboard?tenantId=t1&locale=es${ACOTADO}`));
        const url = String(fetchMock.mock.calls[0]?.[0] || "");
        expect(url).toContain("perspective=7");
        expect(url).toContain("pgroup=Producci");
    });

    it("acotado no lee ni escribe su caché, cuya clave no lleva el alcance", async () => {
        await proxy(new NextRequest(`http://localhost/api/overview/whiteboard?tenantId=t1&locale=es${ACOTADO}`));
        expect(redisMock.get).not.toHaveBeenCalled();
        expect(redisMock.setex).not.toHaveBeenCalled();
    });

    it("sin alcance el caché se usa igual que siempre", async () => {
        await proxy(new NextRequest("http://localhost/api/overview/whiteboard?tenantId=t1&locale=es"));
        expect(redisMock.get).toHaveBeenCalled();
        expect(redisMock.setex).toHaveBeenCalled();
    });
});

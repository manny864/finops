// @vitest-environment node
/**
 * MEJ-34 — el lote de tableros que adoptó el alcance vía `alcanceDeLaRuta`.
 *
 * El traductor tiene sus propios tests; acá se cuida lo que es de cada ruta y no
 * del traductor: que el predicado se pegue a la consulta QUE CORRESPONDE, que
 * los parámetros sigan alineados, y que el recorte no se guarde en un caché cuya
 * clave no lo incluye.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, cacheMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    cacheMock: vi.fn((_k: string, fn: () => any) => fn()),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ email: "u@u" })),
    requireTenantTier: vi.fn(async () => {}),
    requireTenantRole: vi.fn(async () => ({})),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/cache", () => ({ getWithStaleWhileRevalidate: cacheMock }));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(), del: vi.fn() } }));
// El scorecard corta apenas falla la credencial, así que Azure responde y
// devuelve vacío: lo que se mide es la consulta de costo que viene después.
vi.mock("@/lib/azure", () => ({ getAzureCredential: vi.fn(async () => ({})) }));
vi.mock("@azure/arm-resourcegraph", () => ({
    ResourceGraphClient: class { resources = async () => ({ data: [] }); },
}));

// El GET de forecast lee Azure en vivo, no CostSnapshots: el que se acota es
// el POST, que la UI no llama pero docs/forecasting.md documenta como API.
import { POST as forecastPOST } from "@/app/api/intelligence/forecast/route";
import { GET as byServiceGET } from "@/app/api/intelligence/forecast/by-service/route";
import { GET as scorecardGET } from "@/app/api/intelligence/scorecard/route";

const DIMENSIONES = [
    { subscription_id: "s1", resource_group: "rg-prod", service_name: "VM", ResourceId: "/r/1", Tags: { Environment: "prod" } },
    { subscription_id: "s1", resource_group: "rg-dev", service_name: "VM", ResourceId: "/r/2", Tags: { Environment: "dev" } },
];

function stubDb() {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("FROM Perspectives")) return [[{ id: 7, name: "Entorno", description: null }]];
        if (s.includes("FROM PerspectiveRules")) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        if (s.includes("FROM Tenants")) return [[{ tier: "Enterprise" }]];
        if (s.includes("SELECT DISTINCT subscription_id")) return [DIMENSIONES];
        return [[]];
    });
}

/** Las consultas de costo, sin la que resuelve el alcance. */
const deCosto = () => queryMock.mock.calls.filter(([sql]) =>
    String(sql).includes("FROM CostSnapshots") && !String(sql).includes("SELECT DISTINCT subscription_id"));

const ACOTADO = "&perspective=7&pgroup=Producci%C3%B3n";

beforeEach(() => {
    queryMock.mockReset();
    cacheMock.mockReset().mockImplementation((_k: string, fn: () => any) => fn());
    stubDb();
});

const casos: Array<[string, (qs: string) => Promise<Response>]> = [
    ["forecast (POST)", (qs) => forecastPOST(new NextRequest(`http://localhost/api/intelligence/forecast?tenantId=t1${qs}`, {
        method: "POST", body: JSON.stringify({ tenantId: "t1" }), headers: { "content-type": "application/json" },
    })) as any],
    ["forecast/by-service", (qs) => byServiceGET(new NextRequest(`http://localhost/api/intelligence/forecast/by-service?tenantId=t1${qs}`)) as any],
    ["scorecard", (qs) => scorecardGET(new NextRequest(`http://localhost/api/intelligence/scorecard?tenantId=t1${qs}`)) as any],
];

describe.each(casos)("GET %s con alcance de Perspective", (_nombre, pedir) => {
    it("el predicado llega a la consulta de costo, con sólo la terna en alcance", async () => {
        const j = await (await pedir(ACOTADO)).json();
        expect(j.scopeApplied).toBe(true);

        const consultas = deCosto();
        expect(consultas.length).toBeGreaterThan(0);
        for (const [sql, params] of consultas) {
            expect(String(sql)).toContain("COALESCE(ResourceId,'')");
            expect(params).toContain("rg-prod");
            expect(params).not.toContain("rg-dev");
        }
    });

    it("los parámetros siguen alineados con los placeholders", async () => {
        await pedir(ACOTADO);
        for (const [sql, params] of queryMock.mock.calls) {
            const placeholders = (String(sql).match(/\?/g) || []).length;
            expect({ q: String(sql).slice(0, 50), n: placeholders })
                .toEqual({ q: String(sql).slice(0, 50), n: (params as unknown[] | undefined)?.length ?? 0 });
        }
    });

    it("sin alcance la consulta es la de siempre", async () => {
        const j = await (await pedir("")).json();
        expect(j.scopeApplied).toBe(false);
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("SELECT DISTINCT subscription_id"))).toBe(false);
        for (const [sql] of deCosto()) expect(String(sql)).not.toContain("COALESCE(ResourceId,'')");
    });
});

describe("scorecard: el recorte no entra al caché", () => {
    it("acotado no toca el caché, cuya clave no lleva el alcance", async () => {
        // Son 12 h de TTL: una vista acotada guardada ahí serviría el tablero de
        // otro grupo el resto del día.
        await scorecardGET(new NextRequest(`http://localhost/api/intelligence/scorecard?tenantId=t1${ACOTADO}`));
        expect(cacheMock).not.toHaveBeenCalled();
    });

    it("sin acotar sí lo usa", async () => {
        await scorecardGET(new NextRequest("http://localhost/api/intelligence/scorecard?tenantId=t1"));
        expect(cacheMock).toHaveBeenCalled();
    });
});

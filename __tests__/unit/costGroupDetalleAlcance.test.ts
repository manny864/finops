// @vitest-environment node
/**
 * MEJ-34 — el detalle de un Cost Group acotado.
 *
 * El recorte se traduce UNA vez y se pega a `tagFilter`, así que las diez
 * agregaciones de este modal lo heredan sin que ninguna se toque. Lo que puede
 * salir mal no es el recorte sino el ORDEN DE LOS PARÁMETROS: cada consulta arma
 * los suyos distinto —unas ponen fechas antes del `WHERE`, otras después— y un
 * `?` de más o de menos es un error en producción que el typecheck no ve. Por
 * eso el test cuenta placeholders contra parámetros en TODAS las consultas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, kqlMock, azureOk } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    kqlMock: vi.fn(async () => ({ data: [] as any[] })),
    azureOk: { value: false },
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(async () => {}),
    requireTenantRole: vi.fn(async () => ({ tenantId: "t1" })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockCostGroupDetail: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/cache", () => ({ invalidateCache: vi.fn(), costGroupsCacheKeys: () => [] }));
// Azure se enciende por test: apagado, el modal degrada a sus ramas best-effort
// y se miden las consultas a CostSnapshots; encendido, se capturan las KQL.
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => {
        if (!azureOk.value) throw new Error("sin azure");
        return {};
    }),
}));
vi.mock("@azure/arm-resourcegraph", () => ({
    ResourceGraphClient: class { resources = kqlMock; },
}));
vi.mock("@/modules/collectors/azure/advisorCollector", () => ({ collectAdvisorData: vi.fn(async () => ({})) }));
vi.mock("@/lib/advisorI18n", () => ({ translateAdvisorText: (s: string) => s }));
vi.mock("@/lib/azureSubscriptionNames", () => ({
    getSubscriptionNameMap: vi.fn(async () => new Map()),
    resolveSubscriptionName: (id: string) => id,
    isUnattributedSubscriptionId: (id: string) => id === "mg-aggregated" || id === "default",
}));

import { GET } from "@/app/api/cost-groups/[name]/route";

const ctx = { params: Promise.resolve({ name: "IT" }) };
const req = (qs = "") => new NextRequest(`http://localhost/api/cost-groups/IT?tenantId=t1${qs}`);

/** Un grupo repartido entre dos entornos, cada recurso en su propio grupo de recursos. */
const DIMENSIONES = [
    { subscription_id: "s1", resource_group: "rg-prod", service_name: "VM", ResourceId: "/r/1", Tags: { Environment: "prod" } },
    { subscription_id: "s1", resource_group: "rg-dev", service_name: "VM", ResourceId: "/r/2", Tags: { Environment: "dev" } },
];

function stubDb(dimensiones = DIMENSIONES) {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("FROM Perspectives")) return [[{ id: 7, name: "Entorno", description: null }]];
        if (s.includes("FROM PerspectiveRules")) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        if (s.includes("FROM Budgets")) return [[{ monthly_limit_usd: 1000 }]];
        if (s.includes("FROM CostGroups cg")) return [[{ description: null, match_type: null }]];
        if (s.includes("SELECT DISTINCT subscription_id")) return [dimensiones];
        return [[]];
    });
}

/** Las consultas a CostSnapshots que no son la de resolución del alcance. */
const consultasDeCosto = () => queryMock.mock.calls.filter(([sql]) =>
    String(sql).includes("FROM CostSnapshots") && !String(sql).includes("SELECT DISTINCT subscription_id"));

beforeEach(() => {
    queryMock.mockReset();
    kqlMock.mockReset().mockResolvedValue({ data: [] });
    azureOk.value = false;
});

describe("GET /api/cost-groups/[name] con alcance de Perspective", () => {
    it("el recorte llega a TODAS las agregaciones, no a algunas", async () => {
        stubDb();
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"), ctx)).json();

        expect(j.scopeApplied).toBe(true);
        const consultas = consultasDeCosto();
        // El modal no tiene una consulta, tiene diez y pico.
        expect(consultas.length).toBeGreaterThan(9);
        for (const [sql] of consultas) {
            expect(String(sql)).toContain("COALESCE(ResourceId,'')");
        }
    });

    it("los parámetros siguen alineados con los placeholders en cada consulta", async () => {
        // Es el riesgo real de pegar un predicado a un filtro que diez llamadores
        // arman distinto: mysql2 falla en runtime y el typecheck no lo ve.
        stubDb();
        await GET(req("&perspective=7&pgroup=Producci%C3%B3n"), ctx);

        for (const [sql, params] of queryMock.mock.calls) {
            const placeholders = (String(sql).match(/\?/g) || []).length;
            expect({ sql: String(sql).slice(0, 60), placeholders })
                .toEqual({ sql: String(sql).slice(0, 60), placeholders: (params as unknown[] | undefined)?.length ?? 0 });
        }
    });

    it("sólo la terna en alcance viaja como parámetro", async () => {
        stubDb();
        await GET(req("&perspective=7&pgroup=Producci%C3%B3n"), ctx);

        const [, params] = consultasDeCosto()[0];
        expect(params).toContain("rg-prod");
        expect(params).not.toContain("rg-dev");
    });

    it("una terna ambigua no se recorta: se devuelve el grupo entero y se dice", async () => {
        // El mismo recurso con dos juegos de etiquetas en la ventana.
        stubDb([
            { subscription_id: "s1", resource_group: "rg-mixto", service_name: "VM", ResourceId: "/r/1", Tags: { Environment: "prod" } },
            { subscription_id: "s1", resource_group: "rg-mixto", service_name: "VM", ResourceId: "/r/1", Tags: { Environment: "dev" } },
        ]);
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"), ctx)).json();

        expect(j.scopeApplied).toBe(false);
        for (const [sql] of consultasDeCosto()) {
            expect(String(sql)).not.toContain("COALESCE(ResourceId,'')");
        }
    });

    it("las tres consultas a Resource Graph también se acotan", async () => {
        // Si sólo se acotaran las de SQL, el modal tendría pestañas recortadas
        // al lado de pestañas que no lo están, sin que se note cuál es cuál.
        azureOk.value = true;
        stubDb();
        await GET(req("&perspective=7&pgroup=Producci%C3%B3n"), ctx);

        const kqls = kqlMock.mock.calls.map(([a]: any[]) => String(a.query));
        expect(kqls.length).toBe(3);
        // Con los grupos enteros alcanza con nombrarlos; no hace falta el `IN`
        // de identificadores, que en KQL crece rápido.
        for (const q of kqls) expect(q).toContain("resourceGroup in~ ('rg-prod')");
    });

    it("con un grupo de recursos partido, KQL acota por identificador", async () => {
        azureOk.value = true;
        stubDb([
            { subscription_id: "s1", resource_group: "rg-mixto", service_name: "VM", ResourceId: "/r/1", Tags: { Environment: "prod" } },
            { subscription_id: "s1", resource_group: "rg-mixto", service_name: "VM", ResourceId: "/r/2", Tags: { Environment: "dev" } },
        ]);
        await GET(req("&perspective=7&pgroup=Producci%C3%B3n"), ctx);

        const kqls = kqlMock.mock.calls.map(([a]: any[]) => String(a.query));
        for (const q of kqls) {
            expect(q).toContain("id in~ ('/r/1')");
            expect(q).not.toContain("/r/2");
        }
    });

    it("sin alcance no se resuelve nada ni se toca ninguna consulta", async () => {
        stubDb();
        const j = await (await GET(req(), ctx)).json();

        expect(j.scopeApplied).toBe(false);
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("SELECT DISTINCT subscription_id"))).toBe(false);
        for (const [sql] of consultasDeCosto()) {
            expect(String(sql)).not.toContain("COALESCE(ResourceId,'')");
        }
    });
});

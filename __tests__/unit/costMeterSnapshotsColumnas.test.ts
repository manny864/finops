// @vitest-environment node
/**
 * El respaldo de costo de los servicios de IA y el fallback de región tienen que leer columnas que existen.
 *
 * `CostMeterSnapshots` guarda una fila por (suscripción, día, servicio, medidor, región) y NO tiene `resource_id` ni
 * `region` (la región es `resource_location`). Los colectores de Search, Document Intelligence y Foundry, y el
 * servicio de Document Intelligence, pedían el costo de UN recurso con `LOWER(resource_id) = LOWER(?)`: MySQL
 * rechazaba la consulta entera, el `catch` la tragaba y el respaldo ante un 429 de Cost Management devolvía 0.
 *
 * Esa tabla no puede atribuir costo a un recurso. Quien sí guarda `ResourceId` es `CostSnapshots`, y el respaldo
 * apunta ahí (como ya lo hace la tercera estrategia del colector de Search). Sin predicado de recurso, quitar
 * `resource_id` a secas habría devuelto el costo de TODO el tenant para cada cuenta.
 *
 * Los mocks de `pool.query` aceptan cualquier SELECT, por eso nadie lo vio. Acá la base falsa lee el DDL REAL del
 * repo (`__tests__/helpers/ddlVersionado.ts`) y rechaza, como MySQL, toda tabla o columna inexistente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crearBaseFalsa } from "../helpers/baseFalsaDdl";
import { conProyeccion } from "../helpers/proyeccionSelect";

const { query, filasArg } = vi.hoisted(() => ({ query: vi.fn(), filasArg: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => query(...a) }, insertAICostSnapshotRow: vi.fn() }));
// Cost Management responde 429: el respaldo de la base es lo único que queda.
vi.mock("@azure/arm-costmanagement", () => ({
    CostManagementClient: class {
        query = { usage: vi.fn().mockRejectedValue(Object.assign(new Error("Too many requests"), { statusCode: 429 })) };
    },
}));
vi.mock("@azure/arm-monitor", () => ({
    MonitorClient: class {
        metrics = { list: vi.fn().mockResolvedValue({ value: [] }) };
    },
}));
vi.mock("@azure/arm-resources", () => ({
    ResourceManagementClient: class {
        resourceGroups = { list: () => ({ async *[Symbol.asyncIterator]() {} }) };
        resources = { list: () => ({ async *[Symbol.asyncIterator]() {} }) };
    },
}));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
    getAllSubscriptionsForTenant: vi.fn(async () => []),
    getResourceGraphClient: vi.fn(async () => ({ resources: async () => ({ data: filasArg() }) })),
}));
vi.mock("@/modules/collectors/azure/billingService", () => ({ getCurrentMonthAmortizedCosts: vi.fn(async () => []) }));
vi.mock("@/app/api/intelligence/databases/diagnosticsShared", () => ({ getMtdCostByResourceId: vi.fn(async () => new Map()) }));

const { getAzureSearchRealCost } = await import("@/modules/collectors/azure/azureSearchCollector");
const { getDocIntelRealCost } = await import("@/modules/collectors/azure/docIntelCollector");
const { getFoundryResourceCost } = await import("@/modules/collectors/azure/foundryCollector");
const { getDocumentIntelligencePayload } = await import("@/services/azureDocumentIntelligence.service");
const { fetchTenantRealResourceInventory } = await import("@/services/realConsumptionService");

const TENANT = "11111111-aaaa-4bbb-8ccc-222222222222"; // real: no matchea isMockTenant
const SUB = "sub-1";
const rid = (tipo: string, nombre: string) => `/subscriptions/${SUB}/resourceGroups/rg-ai/providers/${tipo}/${nombre}`;
const RID_SEARCH = rid("Microsoft.Search/searchServices", "search-prod");
const RID_DOCINTEL = rid("Microsoft.CognitiveServices/accounts", "docintel-prod");
const RID_FOUNDRY = rid("Microsoft.CognitiveServices/accounts", "foundry-prod");

const base = crearBaseFalsa();
let consolaWarn: ReturnType<typeof vi.spyOn>;
let consolaError: ReturnType<typeof vi.spyOn>;

/** La base contesta lo que diga `filas` por tabla, verificando que el SELECT proyecte las columnas que el código lee. */
function responder(porTabla: Record<string, (params: unknown[], sql: string) => Record<string, unknown>[]>) {
    query.mockImplementation(
        base.query(
            Object.fromEntries(
                Object.entries(porTabla).map(([tabla, f]) => [tabla, (p: unknown[], sql: string) => conProyeccion(sql, f(p, sql), base.violaciones)])
            )
        )
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    base.reiniciar();
    consolaWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
    filasArg.mockReturnValue([]);
});

afterEach(() => {
    consolaWarn.mockRestore();
    consolaError.mockRestore();
});

describe("Azure AI Search: respaldo ante un 429 de Cost Management", () => {
    it("lee CostMeterSnapshots por medidor y servicio, sin pedir una columna de recurso que no existe", async () => {
        responder({ costmetersnapshots: () => [{ totalCost: "34.61" }] });

        const costo = await getAzureSearchRealCost(TENANT, {}, RID_SEARCH, SUB);

        expect(base.violaciones).toEqual([]);
        expect(costo).toBe(34.61);
        const sql = String(query.mock.calls[0][0]);
        expect(sql).toMatch(/FROM\s+CostMeterSnapshots/i);
        expect(sql).toContain("standard-s1");
        // `[tenantId, subscription, subscription]`: la consulta ya no recibe el id ni el nombre del recurso.
        expect(query.mock.calls[0][1]).toEqual([TENANT, SUB, SUB]);
    });

    it("si la tabla de medidores no tiene el dato pasa a CostSnapshots, que sí guarda ResourceId", async () => {
        responder({
            costmetersnapshots: () => [{ totalCost: "0" }],
            costsnapshots: () => [{ totalCost: "12.5" }],
        });

        const costo = await getAzureSearchRealCost(TENANT, {}, RID_SEARCH, SUB);

        expect(base.violaciones).toEqual([]);
        expect(costo).toBe(12.5);
    });
});

describe.each([
    ["Document Intelligence", RID_DOCINTEL, (id: string) => getDocIntelRealCost(TENANT, {}, id, SUB)],
    ["Foundry", RID_FOUNDRY, (id: string) => getFoundryResourceCost(TENANT, {}, id, SUB)],
])("%s: respaldo ante un 429 de Cost Management", (_nombre, id, costoDe) => {
    it("toma el costo del mes de CostSnapshots.ResourceId del recurso, no el de todo el tenant", async () => {
        // Responde como MySQL: el costo del recurso sólo si la consulta lo filtra por él.
        responder({ costsnapshots: (p) => [{ totalCost: p.includes(id) ? "55.25" : "999.99" }] });

        const costo = await costoDe(id);

        expect(base.violaciones).toEqual([]);
        expect(costo).toBe(55.25);
        expect(String(query.mock.calls[0][0])).toMatch(/LOWER\(ResourceId\)\s*=\s*LOWER\(\?\)/i);
    });

    it("sin datos del recurso devuelve 0", async () => {
        responder({ costsnapshots: () => [{ totalCost: "0" }] });

        expect(await costoDe(id)).toBe(0);
        expect(base.violaciones).toEqual([]);
    });
});

describe("servicio de Document Intelligence: respaldo ante un 429 de Cost Management", () => {
    it("el costo del recurso sale de CostSnapshots.ResourceId", async () => {
        filasArg.mockReturnValue([
            { id: RID_DOCINTEL, name: "docintel-prod", location: "eastus", resourceGroup: "rg-ai", subscriptionId: SUB, skuName: "S0" },
        ]);
        responder({ costsnapshots: (p) => [{ totalCost: p.includes(RID_DOCINTEL) ? "55.25" : "999.99" }] });

        const r = await getDocumentIntelligencePayload(TENANT);

        // Las otras dos consultas del servicio (nombres de suscripción: `Subscriptions` y `TenantSubscriptions`) siguen
        // rotas y están en DEUDA de selectColumnasExisten: acá importa sólo la del costo.
        expect(base.violaciones.filter((v) => /^(costsnapshots|costmetersnapshots)/.test(v))).toEqual([]);
        expect(r.source).toBe("live");
        expect(r.resources[0].totalCostUSD).toBe(55.25);
    });
});

describe("realConsumptionService: región por defecto cuando ARM no descubre nada", () => {
    it("la toma de CostMeterSnapshots.resource_location, que es la columna que existe", async () => {
        // Sin recursos ni grupos de ARM: el inventario cae a lo que la base sabe.
        responder({
            costsnapshots: () => [{ resource_group: "rg-real" }],
            costmetersnapshots: () => [{ region: "westeurope" }],
        });

        const r = await fetchTenantRealResourceInventory(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.resourceGroups).toEqual(["rg-real"]);
        expect(r.primaryRegion).toBe("westeurope");
    });
});

// @vitest-environment node
/**
 * Los servicios de red de Azure tienen que poder leer el costo por recurso de CostSnapshots.
 *
 * Pedían `COALESCE(ResourceId, resource_id, '')`. `resource_id` nunca existió (la columna es `ResourceId`) y MySQL
 * valida las columnas del SELECT antes de evaluar el COALESCE: nombrar una inexistente mata la consulta ENTERA con
 * "Unknown column 'resource_id' in 'field list'". El `.catch(() => [[]])` la volvía un mapa vacío y cada recurso
 * caía a su estimación por lista de precios, como si la base no supiera nada. Es el defecto que MEJ-29 ya corrigió
 * en `realConsumptionService`.
 *
 * Los mocks de `pool.query` aceptan cualquier SELECT, por eso ningún test lo vio. Acá la base falsa lee el DDL REAL
 * del repo (`__tests__/helpers/ddlVersionado.ts`) y rechaza, como MySQL, toda tabla o columna inexistente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crearBaseFalsa } from "../helpers/baseFalsaDdl";

const { query, filasArg, costoVivo } = vi.hoisted(() => ({ query: vi.fn(), filasArg: vi.fn(), costoVivo: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => query(...a) } }));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getResourceGraphClient: vi.fn(async () => ({
        resources: async ({ query: kql }: { query: string }) => ({ data: filasArg(kql) }),
    })),
}));
vi.mock("@/lib/azureSubscriptionNames", () => ({
    getSubscriptionNameMap: vi.fn(async () => new Map()),
    resolveSubscriptionName: (id: string) => id,
}));
vi.mock("@/modules/collectors/azure/resourceInventoryService", () => ({ getResourceCostsById: (...a: unknown[]) => costoVivo(...a) }));
vi.mock("@/modules/collectors/azure/billingService", () => ({ getCurrentMonthAmortizedCosts: vi.fn(async () => []) }));

const { getAzureLoadBalancing } = await import("@/services/azureLoadBalancing.service");
const { getAzureInternetAccess } = await import("@/services/azureInternetAccess.service");
const { getAzureHybridConnectivity } = await import("@/services/azureHybridConnectivity.service");
const { getAzureDdosProtection } = await import("@/services/azureDdosProtection.service");
const { fetchBasicNetworkCosts } = await import("@/services/azureBasicNetworking.service");
const { fetchLiveNetworkCosts } = await import("@/services/azureNetworkAnalytics.service");

const TENANT = "11111111-aaaa-4bbb-8ccc-222222222222"; // real: no matchea isMockTenant
/** No coincide con ninguna estimación por lista de precios de los servicios: si aparece, salió de la base. */
const COSTO = 4321.57;

const rid = (tipo: string, nombre: string) => `/subscriptions/sub-1/resourceGroups/rg-prod/providers/${tipo}/${nombre}`;
/** Una fila de Resource Graph con lo mínimo que lee cada servicio. */
const recurso = (tipo: string, nombre: string, extra: Record<string, unknown> = {}) => ({
    id: rid(tipo, nombre),
    name: nombre,
    type: tipo.toLowerCase(),
    location: "eastus",
    resourceGroup: "rg-prod",
    subscriptionId: "sub-1",
    tags: {},
    sku: {},
    properties: {},
    ...extra,
});
/** La fila que contesta la base: el id en minúsculas, como lo devuelve el SELECT (`LOWER(ResourceId) AS resourceId`). */
const costoDe = (id: string, total: number) => ({ resourceId: id.toLowerCase(), total: String(total) });

const base = crearBaseFalsa();
let consolaError: ReturnType<typeof vi.spyOn>;
let consolaWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    base.reiniciar();
    consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
    consolaWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    costoVivo.mockResolvedValue(new Map());
});

afterEach(() => {
    consolaError.mockRestore();
    consolaWarn.mockRestore();
});

/** Un servicio que responde con UN recurso: devuelve su `monthlyCostUSD` y verifica que la base no rechazó ningún SELECT. */
async function costoMensualDe(
    llamar: () => Promise<{ resources: Array<{ id: string; monthlyCostUSD: number }> }>,
    id: string,
    filas: Record<string, ReturnType<typeof costoDe>[]> = {}
) {
    query.mockImplementation(base.query({ costsnapshots: () => filas.costsnapshots ?? [costoDe(id, COSTO)] }));
    const r = await llamar();
    expect(base.violaciones).toEqual([]);
    return r.resources.find((x) => x.id === id)?.monthlyCostUSD;
}

describe("el costo por recurso sale de CostSnapshots.ResourceId, no de la estimación", () => {
    it("Load Balancing", async () => {
        const lb = recurso("Microsoft.Network/loadBalancers", "lb-prod", {
            sku: { name: "Standard", tier: "Regional" },
            properties: { backendAddressPools: [], loadBalancingRules: [] },
        });
        filasArg.mockReturnValue([lb]);

        expect(await costoMensualDe(() => getAzureLoadBalancing(TENANT), lb.id)).toBe(COSTO);
    });

    it("Internet Access (IP pública)", async () => {
        const ip = recurso("Microsoft.Network/publicIPAddresses", "ip-prod", { sku: { name: "Standard", tier: "Regional" } });
        filasArg.mockReturnValue([ip]);

        expect(await costoMensualDe(() => getAzureInternetAccess(TENANT), ip.id)).toBe(COSTO);
    });

    it("Hybrid Connectivity (gateway VPN)", async () => {
        const gw = recurso("Microsoft.Network/virtualNetworkGateways", "gw-prod", {
            sku: { name: "VpnGw1" },
            properties: { gatewayType: "Vpn", vpnType: "RouteBased" },
        });
        filasArg.mockReturnValue([gw]);

        expect(await costoMensualDe(() => getAzureHybridConnectivity(TENANT), gw.id)).toBe(COSTO);
    });

    it("DDoS Protection (plan)", async () => {
        const plan = recurso("Microsoft.Network/ddosProtectionPlans", "ddos-prod");
        // El servicio consulta por separado planes, VNets e IPs públicas: sólo los planes traen filas.
        filasArg.mockImplementation((kql: string) => (/type =~ 'microsoft\.network\/ddosprotectionplans'/.test(kql) ? [plan] : []));

        expect(await costoMensualDe(() => getAzureDdosProtection(TENANT), plan.id)).toBe(COSTO);
    });
});

describe.each([
    ["Basic Networking", fetchBasicNetworkCosts],
    ["Network Analytics", fetchLiveNetworkCosts],
])("%s: costo por recurso, de la base y en vivo", (_nombre, fetchCostos) => {
    const a = recurso("Microsoft.Network/publicIPAddresses", "ip-a");
    const b = recurso("Microsoft.Network/publicIPAddresses", "ip-b");

    it("lee el costo del recurso de la base con las columnas reales", async () => {
        query.mockImplementation(base.query({ costsnapshots: () => [costoDe(a.id, 40)] }));

        const r = await fetchCostos(TENANT, [a]);

        expect(base.violaciones).toEqual([]);
        expect(r.costByResourceId.get(a.id.toLowerCase())).toBe(40);
        // La base cubre todo lo que se descubrió: no se gasta una consulta a Cost Management.
        expect(costoVivo).not.toHaveBeenCalled();
    });

    it("pide en vivo SÓLO el costo de los recursos que la base no tiene, aunque tenga el de otros", async () => {
        // `ResourceId` se guarda sólo en las filas de un único recurso (costExportIngestionService): la base puede
        // cubrir a `a` y no a `b`. Antes el fallback vivo corría sólo con el mapa VACÍO, así que con la columna
        // arreglada `b` se habría quedado sin costo en lugar de recibir el vivo, como recibe hoy.
        query.mockImplementation(base.query({ costsnapshots: () => [costoDe(a.id, 40)] }));
        costoVivo.mockResolvedValue(new Map([[b.id.toLowerCase(), 7.5]]));

        const r = await fetchCostos(TENANT, [a, b]);

        expect(base.violaciones).toEqual([]);
        expect(costoVivo).toHaveBeenCalledTimes(1);
        expect(costoVivo).toHaveBeenCalledWith(TENANT, [{ id: b.id, subscriptionId: "sub-1" }]);
        expect(r.costByResourceId.get(a.id.toLowerCase())).toBe(40);
        expect(r.costByResourceId.get(b.id.toLowerCase())).toBe(7.5);
    });

    it("con la base vacía el costo vivo cubre a todos, como hasta ahora", async () => {
        query.mockImplementation(base.query({}));
        costoVivo.mockResolvedValue(new Map([[a.id.toLowerCase(), 3], [b.id.toLowerCase(), 4]]));

        const r = await fetchCostos(TENANT, [a, b]);

        expect(costoVivo).toHaveBeenCalledWith(TENANT, [
            { id: a.id, subscriptionId: "sub-1" },
            { id: b.id, subscriptionId: "sub-1" },
        ]);
        expect([...r.costByResourceId.values()].sort()).toEqual([3, 4]);
    });
});

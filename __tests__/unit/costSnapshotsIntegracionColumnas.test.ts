// @vitest-environment node
/**
 * Los servicios de integración y monitoreo de Azure tienen que poder leer el costo por recurso de CostSnapshots.
 *
 * Pedían `resource_id` (la columna es `ResourceId`) y, en cuatro, además `cost` (es `cost_usd`) y `usage_date` (es
 * `date`). MySQL rechazaba la consulta ENTERA con "Unknown column", el `catch` la tragaba y cada recurso caía a su
 * estimación por SKU (en Data Factory, a un 150 fijo). En Log Analytics y Azure Monitor la consulta rota va ANTES de
 * la de la tendencia de 30 días dentro del mismo `try`, que tiene columnas válidas pero nunca llegaba a correr: la
 * tendencia salía siempre sintética. En App Insights el costo quedaba en 0 y todos los componentes salían `isOrphan`.
 *
 * Los mocks de `pool.query` aceptan cualquier SELECT, por eso ningún test lo vio (los de estos servicios sólo cubren
 * las funciones puras). Acá la base falsa lee el DDL REAL del repo y rechaza, como MySQL, toda tabla o columna
 * inexistente; y `conProyeccion` verifica además que el SELECT nombre sus columnas como las lee el código.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crearBaseFalsa } from "../helpers/baseFalsaDdl";
import { conProyeccion } from "../helpers/proyeccionSelect";

const { query, filasArg, costoVivo } = vi.hoisted(() => ({ query: vi.fn(), filasArg: vi.fn(), costoVivo: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => query(...a) } }));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
    getResourceGraphClient: vi.fn(async () => ({
        resources: async ({ query: kql }: { query: string }) => ({ data: filasArg(kql) }),
    })),
}));
vi.mock("@/lib/azureSubscriptionNames", () => ({
    getSubscriptionNameMap: vi.fn(async () => new Map()),
    resolveSubscriptionName: (id: string) => id,
}));
vi.mock("@/lib/argConcurrency", () => ({ withArgLimit: (f: () => unknown) => f() }));
vi.mock("@/modules/collectors/azure/resourceInventoryService", () => ({ getResourceCostsById: (...a: unknown[]) => costoVivo(...a) }));

const { getLiveApimData } = await import("@/services/azureApim.service");
const { getLiveEventGridData } = await import("@/services/azureEventGrid.service");
const { getLiveServiceBusData } = await import("@/services/azureServiceBus.service");
const { fetchAdfData } = await import("@/services/azureDataFactory.service");
const { fetchEventHubsData } = await import("@/services/azureEventHubs.service");
const { fetchAppInsightsData } = await import("@/services/azureAppInsights.service");
const { fetchLogAnalyticsData } = await import("@/services/azureLogAnalytics.service");
const { fetchAzureMonitorData } = await import("@/services/azureMonitor.service");
const { fetchSentinelData } = await import("@/services/azureSentinelFinops.service");

const TENANT = "11111111-aaaa-4bbb-8ccc-222222222222";
/** No coincide con ninguna estimación por SKU de los servicios: si aparece, salió de la base. */
const COSTO = 4321.57;
const COSTO_ANTERIOR = 1234.56;

const rid = (tipo: string, nombre: string) => `/subscriptions/sub-1/resourceGroups/rg-prod/providers/${tipo}/${nombre}`;
const recurso = (tipo: string, nombre: string, extra: Record<string, unknown> = {}) => ({
    id: rid(tipo, nombre),
    name: nombre,
    type: tipo.toLowerCase(),
    location: "eastus",
    resourceGroup: "rg-prod",
    subscriptionId: "sub-1",
    tags: {},
    properties: {},
    ...extra,
});

const base = crearBaseFalsa();
let consolaWarn: ReturnType<typeof vi.spyOn>;

/** La base contesta `filas(sql)` para CostSnapshots, verificando que el SELECT proyecte las columnas que el código lee. */
function conCostos(filas: (sql: string) => Record<string, unknown>[]) {
    query.mockImplementation(base.query({ costsnapshots: (_p, sql) => conProyeccion(sql, filas(sql), base.violaciones) }));
}

beforeEach(() => {
    vi.clearAllMocks();
    base.reiniciar();
    consolaWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    costoVivo.mockResolvedValue(new Map()); // Cost Management no aporta: lo que se ve sale de la base o de la estimación
});

afterEach(() => {
    // Un `console.warn` con "CostSnapshots ... failed" es la consulta rechazada por la base falsa y tragada por el catch.
    expect(consolaWarn.mock.calls.map(([m]) => String(m)).filter((m) => /CostSnapshots|MySQL/i.test(m))).toEqual([]);
    consolaWarn.mockRestore();
});

describe("integración: el costo del recurso sale de CostSnapshots.ResourceId, no de la estimación por SKU", () => {
    it("API Management", async () => {
        const apim = recurso("Microsoft.ApiManagement/service", "apim-prod", { sku: { name: "Premium", capacity: 1 } });
        filasArg.mockReturnValue([apim]);
        // El id con su caja original: el servicio lo compara en minúsculas.
        conCostos(() => [{ resource_id: apim.id, totalCost: String(COSTO) }]);

        const r = await getLiveApimData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.items[0].costMtdUSD).toBe(COSTO);
    });

    it("Event Grid", async () => {
        const topic = recurso("Microsoft.EventGrid/topics", "eg-prod", { sku: { name: "Basic" } });
        filasArg.mockReturnValue([topic]);
        conCostos(() => [{ resource_id: topic.id, totalCost: String(COSTO) }]);

        const r = await getLiveEventGridData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.items[0].costMtdUSD).toBe(COSTO);
    });

    it("Service Bus", async () => {
        const ns = recurso("Microsoft.ServiceBus/namespaces", "sb-prod", { sku: { name: "Standard" } });
        filasArg.mockReturnValue([ns]);
        conCostos(() => [{ resource_id: ns.id, totalCost: String(COSTO) }]);

        const r = await getLiveServiceBusData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.items[0].costMtdUSD).toBe(COSTO);
    });

    it("Data Factory: costo del mes y del mes anterior, sin caer en el 150 fijo", async () => {
        const adf = recurso("Microsoft.DataFactory/factories", "adf-prod");
        filasArg.mockReturnValue([adf]);
        conCostos(() => [{ resource_id: adf.id, cost_mtd: String(COSTO), cost_prev: String(COSTO_ANTERIOR) }]);

        const r = await fetchAdfData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.items[0].costMtdUSD).toBe(COSTO);
        expect(r.items[0].costPreviousPeriodUSD).toBe(COSTO_ANTERIOR);
    });

    it("Event Hubs: costo del mes y del mes anterior", async () => {
        const eh = recurso("Microsoft.EventHub/namespaces", "eh-prod", { sku: { name: "Standard", capacity: 1 } });
        filasArg.mockReturnValue([eh]);
        conCostos(() => [{ resource_id: eh.id, cost_mtd: String(COSTO), cost_prev: String(COSTO_ANTERIOR) }]);

        const r = await fetchEventHubsData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.items[0].costMtdUSD).toBe(COSTO);
        expect(r.items[0].costPreviousPeriodUSD).toBe(COSTO_ANTERIOR);
    });

    it("App Insights: el costo del mes saca al componente de la lista de huérfanos", async () => {
        const appi = recurso("Microsoft.Insights/components", "appi-prod");
        filasArg.mockReturnValue([appi]);
        conCostos(() => [{ resource_id: appi.id, cost_mtd: String(COSTO) }]);

        const r = await fetchAppInsightsData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.items[0].estimatedCostMtdUSD).toBe(COSTO);
        expect(r.items[0].isOrphan).toBe(false);
    });

    it("App Insights: pide el mes en curso (la columna se llama cost_mtd), no todo el historial", async () => {
        const appi = recurso("Microsoft.Insights/components", "appi-prod");
        filasArg.mockReturnValue([appi]);
        conCostos(() => []);

        await fetchAppInsightsData(TENANT);

        const sql = String(query.mock.calls.find(([s]) => /FROM\s+CostSnapshots/i.test(String(s)))?.[0]);
        expect(sql).toMatch(/date\s*>=\s*DATE_FORMAT\(\s*(CURDATE|NOW)\(\)\s*,\s*'%Y-%m-01'\s*\)/i);
    });
});

describe("monitoreo: el costo por recurso y la tendencia de 30 días salen de la base", () => {
    const TENDENCIA = [{ dayDate: "2026-10-08", dailyCost: "12.34" }];

    it("Log Analytics: costo del workspace y tendencia real (antes la consulta rota impedía llegar a la tendencia)", async () => {
        const law = recurso("Microsoft.OperationalInsights/workspaces", "law-prod", {
            skuName: "PerGB2018",
            retentionInDays: 30,
            dailyQuotaGb: null,
        });
        filasArg.mockReturnValue([law]);
        conCostos((sql) => (sql.includes("dayDate") ? TENDENCIA : [{ resource_id: law.id, totalCost: String(COSTO) }]));

        const r = await fetchLogAnalyticsData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.workspaces[0].monthlyCostUSD).toBe(COSTO);
        // Un punto real de la base; la tendencia sintética de reserva tiene 30.
        expect(r.dailyIngestionTrend).toHaveLength(1);
        expect(r.dailyIngestionTrend[0]).toMatchObject({ date: "2026-10-08", costUSD: 12.34 });
    });

    it("Azure Monitor: costo de la alerta y tendencia real", async () => {
        const alerta = recurso("Microsoft.Insights/metricAlerts", "alerta-cpu", {
            enabled: true,
            severity: "2",
            frequency: "5m",
            timeWindow: "5m",
            targetScopes: [],
            queryPayload: "",
        });
        filasArg.mockReturnValue([alerta]);
        conCostos((sql) => (sql.includes("dayDate") ? TENDENCIA : [{ resource_id: alerta.id, totalCost: String(COSTO) }]));

        const r = await fetchAzureMonitorData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.alerts[0].costMtdUSD).toBe(COSTO);
        expect(r.dailyTrend).toHaveLength(1);
        expect(r.dailyTrend[0]).toMatchObject({ date: "2026-10-08", costUSD: 12.34 });
    });

    it("Sentinel: costo del workspace (Cost Management en vivo no aporta)", async () => {
        const law = recurso("Microsoft.OperationalInsights/workspaces", "law-sentinel-prod", {
            sku: "PerGB2018",
            retentionInDays: 30,
            dailyCap: null,
        });
        // Dos consultas a Resource Graph: las soluciones de Sentinel (ninguna) y los workspaces.
        filasArg.mockImplementation((kql: string) => (/operationalinsights\/workspaces/i.test(kql) ? [law] : []));
        conCostos(() => [{ resource_id: law.id, total_cost: String(COSTO) }]);

        const r = await fetchSentinelData(TENANT);

        expect(base.violaciones).toEqual([]);
        expect(r.workspaces[0].totalRealCostUSD).toBe(COSTO);
    });
});

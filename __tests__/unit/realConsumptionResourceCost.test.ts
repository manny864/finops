import { describe, it, expect, vi, beforeEach } from "vitest";

const { amortizedMock, mtdByResourceMock, credentialMock, inventoryQueryMock } = vi.hoisted(() => ({
    amortizedMock: vi.fn(),
    mtdByResourceMock: vi.fn(),
    credentialMock: vi.fn(async () => ({})),
    inventoryQueryMock: vi.fn(),
}));

vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false }));
vi.mock("@/modules/storage/db", () => {
    const query = vi.fn(async () => [[]]);
    // El servicio pide una conexión dedicada para el histórico (mes anterior,
    // anomalías); acá no interesa, sólo tiene que no romper.
    return { default: { query, getConnection: async () => ({ query, release: () => {} }) } };
});
vi.mock("@/modules/collectors/azure/billingService", () => ({
    getCurrentMonthAmortizedCosts: amortizedMock,
}));
vi.mock("@/app/api/intelligence/databases/diagnosticsShared", () => ({
    getMtdCostByResourceId: mtdByResourceMock,
}));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: credentialMock,
    getAllSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));
vi.mock("@azure/arm-resources", () => ({
    ResourceManagementClient: class {
        resourceGroups = { list: () => inventoryQueryMock("rg") };
        resources = { list: () => inventoryQueryMock("res") };
    },
}));

import { getRealConsumptionOverview } from "@/services/realConsumptionService";

const RESOURCE_ID = "/subscriptions/sub-1/resourceGroups/cscs-finops-mgmt-eastus2-rg/providers/Microsoft.CognitiveServices/accounts/mchavez-8282-resource";

/** Inventario ARM: un único recurso del servicio "Foundry Models". */
function stubInventory() {
    inventoryQueryMock.mockImplementation((kind: string) => ({
        async *[Symbol.asyncIterator]() {
            if (kind === "rg") {
                yield { name: "cscs-finops-mgmt-eastus2-rg", location: "eastus2" };
            } else {
                yield {
                    id: RESOURCE_ID,
                    name: "mchavez-8282-resource",
                    type: "Microsoft.CognitiveServices/accounts",
                    location: "eastus2",
                    sku: { name: "S0" },
                };
            }
        },
    }));
}

beforeEach(() => {
    amortizedMock.mockReset();
    mtdByResourceMock.mockReset();
    inventoryQueryMock.mockReset();
    stubInventory();
});

describe("getRealConsumptionOverview — costo MTD por recurso", () => {
    // El bug reportado: la tarjeta decía "Costo Total MTD: $184.01" y el
    // desglose mostraba $2,760.15 para un solo recurso — exactamente 15x, la
    // cantidad de filas diarias que devuelve Cost Management.
    it("no multiplica el costo del recurso por la cantidad de días facturados", async () => {
        // 15 filas DIARIAS del mismo servicio, ~12.27 por día = 184.01 en el mes.
        amortizedMock.mockResolvedValue(
            Array.from({ length: 15 }, () => ({
                ServiceName: "Microsoft.CognitiveServices/accounts",
                EffectiveCost: 12.2673,
                BilledCost: 12.2673,
            })),
        );
        // Cost Management devuelve el MTD del recurso: UNA cifra para todo el mes.
        mtdByResourceMock.mockResolvedValue(new Map([[RESOURCE_ID.toLowerCase(), 184.01]]));

        const overview = await getRealConsumptionOverview("t1", "All");
        const service = overview.services.find((s) => s.resources?.length);
        const resource = service?.resources?.[0];

        expect(resource?.costMtd).toBeCloseTo(184.01, 2);
        // La invariante que se rompía: el recurso no puede costar más que su servicio.
        expect(resource!.costMtd).toBeLessThanOrEqual(Number(service!.totalCost.toFixed(2)) + 0.02);
    });

    it("el total del servicio sigue siendo la suma de las filas diarias", async () => {
        amortizedMock.mockResolvedValue(
            Array.from({ length: 15 }, () => ({
                ServiceName: "Microsoft.CognitiveServices/accounts",
                EffectiveCost: 12.2673,
                BilledCost: 12.2673,
            })),
        );
        mtdByResourceMock.mockResolvedValue(new Map([[RESOURCE_ID.toLowerCase(), 184.01]]));

        const overview = await getRealConsumptionOverview("t1", "All");

        expect(overview.totalCost).toBeCloseTo(184.01, 1);
    });

    it("sin desglose por recurso, el prorrateo diario SÍ se acumula", async () => {
        // Cost Management no devolvió costo por ResourceId: cada fila diaria se
        // reparte entre los recursos y hay que sumarlas para llegar al mes.
        amortizedMock.mockResolvedValue(
            Array.from({ length: 10 }, () => ({
                ServiceName: "Microsoft.CognitiveServices/accounts",
                EffectiveCost: 10,
                BilledCost: 10,
            })),
        );
        mtdByResourceMock.mockResolvedValue(new Map());

        const overview = await getRealConsumptionOverview("t1", "All");
        const resource = overview.services.find((s) => s.resources?.length)?.resources?.[0];

        // 10 días x 10 = 100 para el único recurso del servicio.
        expect(resource?.costMtd).toBeCloseTo(100, 2);
    });

    // Segundo bug: el filtro difuso metía el MISMO recurso en varias tarjetas
    // ("Foundry Models" y "Cognitive Services" para una cuenta de Cognitive
    // Services), y como el costo por recurso viene sumado sobre todos los
    // servicios, cada tarjeta mostraba el total completo.
    it("no repite el mismo recurso en dos tarjetas de servicio", async () => {
        amortizedMock.mockResolvedValue([
            { ServiceName: "Foundry Models", EffectiveCost: 150, BilledCost: 150 },
            { ServiceName: "Cognitive Services", EffectiveCost: 34.01, BilledCost: 34.01 },
        ]);
        mtdByResourceMock.mockResolvedValue(new Map([[RESOURCE_ID.toLowerCase(), 184.01]]));

        const overview = await getRealConsumptionOverview("t1", "All");

        const apariciones = overview.services.flatMap((s) =>
            (s.resources || []).filter((r) => r.id === RESOURCE_ID).map(() => s.serviceName));
        expect(apariciones).toHaveLength(1);
        // Gana la coincidencia exacta con el serviceName mapeado del recurso.
        expect(apariciones[0]).toBe("Foundry Models");
    });

    it("ningún servicio muestra recursos que sumen más que su propio total", async () => {
        amortizedMock.mockResolvedValue([
            { ServiceName: "Foundry Models", EffectiveCost: 150, BilledCost: 150 },
            { ServiceName: "Cognitive Services", EffectiveCost: 34.01, BilledCost: 34.01 },
        ]);
        mtdByResourceMock.mockResolvedValue(new Map([[RESOURCE_ID.toLowerCase(), 150]]));

        const overview = await getRealConsumptionOverview("t1", "All");

        for (const s of overview.services) {
            const suma = (s.resources || []).reduce((acc, r) => acc + r.costMtd, 0);
            expect(suma).toBeLessThanOrEqual(Number(s.totalCost.toFixed(2)) + 0.02);
        }
    });
});

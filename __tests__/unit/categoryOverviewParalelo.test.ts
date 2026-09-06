/**
 * `getRealCategoryOverview` pide el inventario de ARG y el mes amortizado de
 * Cost Management. El segundo no depende del primero, pero antes se esperaba a
 * que la cadena inventario → getResourceCostsById terminara para recién
 * pedirlo: dos viajes lentos en serie sin necesidad.
 *
 * Este test fija que las dos llamadas estén en vuelo a la vez. Si alguien las
 * vuelve a encadenar, el inventario se ejecuta sin que el mes amortizado haya
 * arrancado y falla.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const llamadas: string[] = [];

vi.mock("@/services/realConsumptionService", () => ({
    fetchTenantRealResourceInventory: vi.fn(async () => {
        llamadas.push("inventario:inicio");
        await new Promise((r) => setTimeout(r, 20));
        llamadas.push("inventario:fin");
        return { resources: [], resourceGroups: ["rg-test"], primaryRegion: "eastus2" };
    }),
}));

vi.mock("@/modules/collectors/azure/billingService", () => ({
    getCurrentMonthAmortizedCosts: vi.fn(async () => {
        llamadas.push("amortizado:inicio");
        await new Promise((r) => setTimeout(r, 20));
        llamadas.push("amortizado:fin");
        return [{ ServiceName: "Virtual Machines", EffectiveCost: 10, ResourceType: "microsoft.compute/virtualmachines" }];
    }),
}));

vi.mock("@/modules/collectors/azure/resourceInventoryService", () => ({
    getResourceCostsById: vi.fn(async () => new Map<string, number>()),
}));

vi.mock("@/modules/storage/db", () => ({
    default: {
        getConnection: vi.fn(async () => ({
            execute: vi.fn(async () => [[]]),
            release: vi.fn(),
        })),
    },
}));

describe("getRealCategoryOverview — llamadas a Azure en paralelo", () => {
    beforeEach(() => {
        llamadas.length = 0;
    });

    it("arranca el mes amortizado sin esperar al inventario", async () => {
        const { getRealCategoryOverview } = await import("@/services/categoryConsumptionService");
        await getRealCategoryOverview("54d7cf18-0baa-4da7-8242-fbf59a92aaac", 30);

        const iInvInicio = llamadas.indexOf("inventario:inicio");
        const iAmoInicio = llamadas.indexOf("amortizado:inicio");
        const iInvFin = llamadas.indexOf("inventario:fin");

        expect(iInvInicio).toBeGreaterThanOrEqual(0);
        expect(iAmoInicio).toBeGreaterThanOrEqual(0);
        // Lo que importa: el amortizado arrancó ANTES de que el inventario
        // terminara. En serie, su inicio caería después de "inventario:fin".
        expect(iAmoInicio).toBeLessThan(iInvFin);
    });
});

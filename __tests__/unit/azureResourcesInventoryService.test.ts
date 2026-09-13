import { describe, it, expect, vi } from "vitest";
import {
    generateMockResourcesSearch,
    generateMockResourcesInventory,
    generateMockCreatedByAggregation,
    generateMockCostsByTagSummary,
    getLiveResourcesInventory,
    attributeResourceCost,
} from "@/services/azureResourcesInventory.service";
import * as azureLib from "@/lib/azure";
import pool from "@/modules/storage/db";

describe("Azure Resources Inventory Service", () => {
    describe("generateMockResourcesSearch", () => {
        it("should return paginated mock resource search items", () => {
            const res = generateMockResourcesSearch("Professional", { page: 1, pageSize: 15 });
            expect(res).toBeDefined();
            expect(res.mock).toBe(true);
            expect(res.page).toBe(1);
            expect(res.pageSize).toBe(15);
            expect(res.rows.length).toBeLessThanOrEqual(15);
            expect(res.total).toBeGreaterThan(0);
            expect(res.kpis).toBeDefined();
            expect(res.kpis.resources).toBeGreaterThan(0);
        });

        it("should filter mock resources by search text", () => {
            const res = generateMockResourcesSearch("Professional", { search: "vm" });
            expect(res.rows.every(r => 
                r.name.toLowerCase().includes("vm") || 
                r.type.toLowerCase().includes("vm") ||
                r.typeDisplayName.toLowerCase().includes("vm")
            )).toBe(true);
        });

        it("should filter mock resources by resource group", () => {
            const res = generateMockResourcesSearch("Professional", { resourceGroup: "rg-prod-compute-core" });
            expect(res.rows.every(r => r.resourceGroup === "rg-prod-compute-core")).toBe(true);
        });

        it("should filter mock resources by tagKey", () => {
            const res = generateMockResourcesSearch("Professional", { tagKey: "Environment" });
            expect(res.rows.every(r => Boolean(r.tags && r.tags.Environment))).toBe(true);
        });

        it("should scale costs with Enterprise tier multiplier", () => {
            const proRes = generateMockResourcesSearch("Professional", { page: 1, pageSize: 5 });
            const entRes = generateMockResourcesSearch("Enterprise", { page: 1, pageSize: 5 });

            expect(entRes.rows[0].monthlyCostUSD).toBeGreaterThan(proRes.rows[0].monthlyCostUSD);
        });
    });

    describe("generateMockResourcesInventory", () => {
        it("should return inventory distribution by type, subscription and region", () => {
            const inv = generateMockResourcesInventory("Professional");
            expect(inv).toBeDefined();
            expect(inv.mock).toBe(true);
            expect(inv.byType.length).toBeGreaterThan(0);
            expect(inv.bySubscription.length).toBeGreaterThan(0);
            expect(inv.byRegion.length).toBeGreaterThan(0);
            expect(inv.kpis.resources).toBeGreaterThan(0);
            expect(inv.kpis.costGroups).toBeGreaterThan(0);
        });
    });

    describe("generateMockCreatedByAggregation", () => {
        it("should return creator aggregation with resources, rgs and subscriptions count", () => {
            const createdBy = generateMockCreatedByAggregation("Professional");
            expect(createdBy).toBeDefined();
            expect(createdBy.mock).toBe(true);
            expect(createdBy.rows.length).toBeGreaterThan(0);
            expect(createdBy.rows[0].creatorName).toBeDefined();
            expect(createdBy.rows[0].resourcesCount).toBeGreaterThan(0);
            expect(createdBy.kpis.createdBy).toBe(createdBy.rows.length);
        });
    });

    describe("generateMockCostsByTagSummary", () => {
        it("should return hierarchical tag costs summary with tag keys and distinct values", () => {
            const tagSummary = generateMockCostsByTagSummary("Professional");
            expect(tagSummary).toBeDefined();
            expect(tagSummary.mock).toBe(true);
            expect(tagSummary.tags.length).toBeGreaterThan(0);
            expect(tagSummary.tags[0].tagKey).toBeDefined();
            expect(tagSummary.tags[0].values.length).toBeGreaterThan(0);
            expect(tagSummary.tags[0].monthlySpendUSD).toBeGreaterThan(0);
            expect(tagSummary.kpis.tagNames).toBe(tagSummary.tags.length);
            expect(tagSummary.kpis.tagValues).toBeGreaterThan(0);
        });
    });

    describe("getLiveResourcesInventory fallback", () => {
        it("should return structured empty state when no subscriptions are found", async () => {
            const subsSpy = vi.spyOn(azureLib, "getSubscriptionsForTenant").mockResolvedValue([]);
            const querySpy = vi.spyOn(pool, "query").mockImplementation(async () => [[]] as any);

            const result = await getLiveResourcesInventory("test-tenant-unconfigured");
            expect(result).toBeDefined();
            expect(result.mock).toBe(false);
            expect(result.byType).toEqual([]);
            expect(result.bySubscription).toEqual([]);
            expect(result.byRegion).toEqual([]);
            expect(result.kpis.resources).toBe(0);

            subsSpy.mockRestore();
            querySpy.mockRestore();
        });
    });
});

describe("attributeResourceCost — costo del padre (MEJ-05)", () => {
    const VM = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm-app-01";

    it("con cargo propio medido, gana el cargo propio", () => {
        const r = attributeResourceCost(142.005, { id: VM, cost: 999 });
        expect(r.monthlyCostUSD).toBe(142.01);
        expect(r.costSource).toBe("cost_management");
        expect(r.billedIn).toBeUndefined();
    });

    it("sin cargo propio, informa el padre y NO suma su costo en la fila", () => {
        // El invariante de MEJ-05: el costo se cuenta una sola vez, en el padre.
        // Si esta fila trajera 142, el total de la tabla lo contaría dos veces.
        const r = attributeResourceCost(undefined, { id: VM, cost: 142 });
        expect(r.monthlyCostUSD).toBe(0);
        expect(r.costSource).toBe("parent");
        expect(r.billedIn).toEqual({ id: VM, name: "vm-app-01", monthlyCostUSD: 142 });
    });

    it("un cargo propio de 0 medido NO se confunde con no tener cargo", () => {
        const r = attributeResourceCost(0, { id: VM, cost: 142 });
        expect(r.costSource).toBe("cost_management");
        expect(r.billedIn).toBeUndefined();
    });

    it("si el padre tampoco tiene costo medido, queda sin medir", () => {
        // Decir "facturado en X" sin número no agrega nada sobre el "—".
        const r = attributeResourceCost(undefined, { id: VM, cost: undefined });
        expect(r.costSource).toBe("unmeasured");
        expect(r.billedIn).toBeUndefined();
        expect(r.monthlyCostUSD).toBe(0);
    });

    it("sin padre resuelto, queda sin medir", () => {
        const r = attributeResourceCost(undefined, undefined);
        expect(r.costSource).toBe("unmeasured");
        expect(r.monthlyCostUSD).toBe(0);
    });

    it("la suma de una página no cambia por atribuir padres", () => {
        // Tres hijos de la misma VM: el total tiene que ser el de la VM sola.
        const vm = attributeResourceCost(142, undefined);
        const hijos = ["ext1", "ext2", "nic1"].map(() =>
            attributeResourceCost(undefined, { id: VM, cost: 142 })
        );
        const total = [vm, ...hijos].reduce((a, x) => a + x.monthlyCostUSD, 0);
        expect(total).toBe(142);
    });
});

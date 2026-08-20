import { describe, it, expect, vi } from "vitest";
import {
    generateMockResourcesSearch,
    generateMockResourcesInventory,
    generateMockCreatedByAggregation,
    generateMockCostsByTagSummary,
    getLiveResourcesInventory,
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

import { describe, it, expect, vi } from "vitest";
import { generateMockTopSpend, getLiveTopSpend } from "@/services/azureTopSpend.service";
import pool from "@/modules/storage/db";

describe("Azure Top Spend Service", () => {
    describe("generateMockTopSpend", () => {
        it("should generate mock top spend data for Professional tier", () => {
            const summary = generateMockTopSpend("Professional", "30d", 5);
            expect(summary).toBeDefined();
            expect(summary.mock).toBe(true);
            expect(summary.timeframe).toBe("30d");
            expect(summary.topLimit).toBe(5);
            expect(summary.topCostGroups.length).toBe(5);
            expect(summary.topSubscriptions.length).toBe(5);
            expect(summary.topResourceGroups.length).toBe(5);
            expect(summary.topResources.length).toBe(5);
            expect(summary.totalAnalyzedCostUSD).toBeGreaterThan(0);
        });

        it("should scale with Enterprise tier multiplier", () => {
            const proSummary = generateMockTopSpend("Professional", "30d", 3);
            const entSummary = generateMockTopSpend("Enterprise", "30d", 3);

            expect(entSummary.totalAnalyzedCostUSD).toBeGreaterThan(proSummary.totalAnalyzedCostUSD);
            expect(entSummary.topCostGroups[0].costUSD).toBeGreaterThan(proSummary.topCostGroups[0].costUSD);
        });

        it("should adjust cost for MTD timeframe", () => {
            const summary30d = generateMockTopSpend("Professional", "30d", 5);
            const summaryMtd = generateMockTopSpend("Professional", "mtd", 5);

            expect(summaryMtd.timeframe).toBe("mtd");
            expect(summaryMtd.totalAnalyzedCostUSD).toBeLessThan(summary30d.totalAnalyzedCostUSD);
        });

        it("should respect the requested limit", () => {
            const summary3 = generateMockTopSpend("Professional", "30d", 3);
            expect(summary3.topCostGroups.length).toBe(3);
            expect(summary3.topSubscriptions.length).toBe(3);

            const summary10 = generateMockTopSpend("Professional", "30d", 10);
            expect(summary10.topCostGroups.length).toBe(10);
            expect(summary10.topSubscriptions.length).toBe(10);
        });
    });

    describe("getLiveTopSpend", () => {
        it("should query MySQL and return aggregated dimensions", async () => {
            const querySpy = vi.spyOn(pool, "query").mockImplementation(async (sql: any) => {
                const s = String(sql);
                if (s.includes("SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS totalCost")) {
                    return [[{ totalCost: 15420.50 }]] as any;
                }
                if (s.includes("CostCenter")) {
                    return [[
                        { name: "Engineering", cost: 6200 },
                        { name: "Marketing", cost: 3100 },
                    ]] as any;
                }
                if (s.includes("subscription_id AS name")) {
                    return [[
                        { name: "sub-12345", cost: 9500 },
                        { name: "sub-67890", cost: 4200 },
                    ]] as any;
                }
                if (s.includes("resource_group AS name")) {
                    return [[
                        { name: "rg-prod-core", sub_id: "sub-12345", cost: 4800 },
                    ]] as any;
                }
                if (s.includes("service_name, resource_group")) {
                    return [[
                        { service_name: "Virtual Machines", resource_group: "rg-prod-core", cost: 3200 },
                    ]] as any;
                }
                return [[]] as any;
            });

            const result = await getLiveTopSpend("real-tenant-guid", "30d", 5);
            expect(result).toBeDefined();
            expect(result.mock).toBe(false);
            expect(result.totalAnalyzedCostUSD).toBe(15420.5);
            expect(result.topCostGroups.length).toBe(2);
            expect(result.topCostGroups[0].name).toBe("Engineering");
            expect(result.topCostGroups[0].sharePercentage).toBeGreaterThan(0);

            querySpy.mockRestore();
        });
    });
});

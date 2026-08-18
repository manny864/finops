import { describe, it, expect } from "vitest";
import {
    getMockCategoryOverview,
    getCategoryRemediationRule,
    mapServiceToCategory,
    getCategoryIconName,
} from "@/services/categoryConsumptionService";

describe("categoryConsumptionService", () => {
    it("returns calibrated mock category overview with dominant categories matching specs", () => {
        const overview = getMockCategoryOverview("demo-tenant-mock");

        expect(overview).toBeDefined();
        expect(overview.total).toBe(442.24);
        expect(overview.dailyBurnRate).toBeGreaterThan(0);
        expect(overview.projectedTotal).toBeGreaterThan(overview.total);
        expect(overview.topCategory).toBe("Databases");
        expect(overview.topCategoryPercentage).toBeCloseTo(49.58, 1);

        // Verify categories
        expect(overview.categories.length).toBe(5);

        // 1. Databases ($184.51 / ~50%)
        const dbCat = overview.categories.find((c) => c.category === "Databases");
        expect(dbCat).toBeDefined();
        expect(dbCat?.totalCost).toBe(184.51);
        expect(dbCat?.percentage).toBeCloseTo(49.58, 1);
        expect(dbCat?.services.length).toBe(3);
        expect(dbCat?.budget.monthlyBudget).toBe(150.0);
        expect(dbCat?.budget.isOverBudget).toBe(true);
        expect(dbCat?.remediationActionKey).toBe("db_reservations_and_scale");
        expect(dbCat?.resources.length).toBe(3);

        // 2. Compute ($104.24 / ~28%)
        const compCat = overview.categories.find((c) => c.category === "Compute");
        expect(compCat).toBeDefined();
        expect(compCat?.totalCost).toBe(104.24);
        expect(dbCat?.remediationActionKey).toBe("db_reservations_and_scale");

        // 3. Networking ($70.59 / ~19%)
        const netCat = overview.categories.find((c) => c.category === "Networking");
        expect(netCat).toBeDefined();
        expect(netCat?.totalCost).toBe(70.59);
        expect(netCat?.hasSpike).toBe(true);
        expect(netCat?.momVariation).toBe(24.0);

        // Verify historical 6-month points
        expect(overview.historical6Months.length).toBe(6);
        const lastMonth = overview.historical6Months[5];
        expect(lastMonth.Databases).toBe(184.51);
        expect(lastMonth.Compute).toBe(104.24);
        expect(lastMonth.Networking).toBe(70.59);

        // Verify optimization opportunities
        expect(overview.optimizationOpportunities.length).toBeGreaterThanOrEqual(3);
        const dbOpp = overview.optimizationOpportunities.find((o) => o.category === "Databases");
        expect(dbOpp?.potentialSavings).toBe(65.0);
    });

    it("correctly maps Azure services and resource types to FinOps FOCUS categories", () => {
        expect(mapServiceToCategory("Azure Database for MySQL")).toBe("Databases");
        expect(mapServiceToCategory("Redis Cache")).toBe("Databases");
        expect(mapServiceToCategory("Azure Cosmos DB")).toBe("Databases");
        expect(mapServiceToCategory("Azure Container Apps")).toBe("Compute");
        expect(mapServiceToCategory("Virtual Machines")).toBe("Compute");
        expect(mapServiceToCategory("Virtual Network")).toBe("Networking");
        expect(mapServiceToCategory("Azure Load Balancer")).toBe("Networking");
        expect(mapServiceToCategory("Azure OpenAI Service")).toBe("AI and Machine Learning");
        expect(mapServiceToCategory("Foundry Models")).toBe("AI and Machine Learning");
        expect(mapServiceToCategory("Azure Blob Storage")).toBe("Storage");
        expect(mapServiceToCategory("Azure Key Vault")).toBe("Security");
        expect(mapServiceToCategory("Azure Synapse Analytics")).toBe("Analytics");
    });

    it("returns correct remediation rules by category", () => {
        const dbRule = getCategoryRemediationRule("Databases", 184.51);
        expect(dbRule.remediationActionKey).toBe("db_reservations_and_scale");
        expect(dbRule.potentialSavings).toBeGreaterThan(0);

        const compRule = getCategoryRemediationRule("Compute", 104.24);
        expect(compRule.remediationActionKey).toBe("compute_rightsizing_scale_zero");

        const netRule = getCategoryRemediationRule("Networking", 70.59);
        expect(netRule.remediationActionKey).toBe("networking_egress_and_nat_audit");

        const aiRule = getCategoryRemediationRule("AI and Machine Learning", 37.78);
        expect(aiRule.remediationActionKey).toBe("ai_token_quota_limits");

        const stRule = getCategoryRemediationRule("Storage", 45.12);
        expect(stRule.remediationActionKey).toBe("storage_lifecycle_cool_archive");
    });

    it("returns appropriate icon names", () => {
        expect(getCategoryIconName("Databases")).toBe("database");
        expect(getCategoryIconName("Compute")).toBe("cpu");
        expect(getCategoryIconName("Networking")).toBe("network");
        expect(getCategoryIconName("AI and Machine Learning")).toBe("brain");
        expect(getCategoryIconName("Storage")).toBe("hard-drive");
        expect(getCategoryIconName("Security")).toBe("shield-lock");
    });
});

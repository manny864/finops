import { describe, it, expect } from "vitest";
import { AzureZombieHuntingService } from "@/services/azureZombieHunting.service";

describe("AzureZombieHuntingService", () => {
    describe("getMockFinancialLeaks", () => {
        it("should return Enterprise mock data with full multipliers", () => {
            const summary = AzureZombieHuntingService.getMockFinancialLeaks("Enterprise");
            expect(summary).toBeDefined();
            expect(summary.totalAffectedResources).toBeGreaterThan(0);
            expect(summary.totalMonthlyLeakUSD).toBeGreaterThan(0);
            expect(summary.breakdownByCategory.length).toBeGreaterThan(0);
            expect(summary.resources.length).toBe(summary.totalAffectedResources);

            // Verify categories exist in breakdown
            const categoryKeys = summary.breakdownByCategory.map((b) => b.categoryKey);
            expect(categoryKeys).toContain("UNATTACHED_DISK");
            expect(categoryKeys).toContain("DEALLOCATED_VM");
            expect(categoryKeys).toContain("ORPHAN_IP");
            expect(categoryKeys).toContain("EMPTY_ASP");
            expect(categoryKeys).toContain("OLD_SNAPSHOT");
        });

        it("should scale costs down for Professional tier", () => {
            const enterprise = AzureZombieHuntingService.getMockFinancialLeaks("Enterprise");
            const pro = AzureZombieHuntingService.getMockFinancialLeaks("Professional");

            expect(pro.totalMonthlyLeakUSD).toBeLessThan(enterprise.totalMonthlyLeakUSD);
            expect(pro.totalAffectedResources).toBe(enterprise.totalAffectedResources);
        });

        it("should scale costs down for Business tier proportionally", () => {
            const enterprise = AzureZombieHuntingService.getMockFinancialLeaks("Enterprise");
            const business = AzureZombieHuntingService.getMockFinancialLeaks("Business");
            const pro = AzureZombieHuntingService.getMockFinancialLeaks("Professional");

            expect(business.totalMonthlyLeakUSD).toBeLessThan(enterprise.totalMonthlyLeakUSD);
            expect(business.totalMonthlyLeakUSD).toBeGreaterThan(pro.totalMonthlyLeakUSD);
        });

        it("should include clean human-readable names and resolved subscriptions", () => {
            const summary = AzureZombieHuntingService.getMockFinancialLeaks("Enterprise");
            for (const r of summary.resources) {
                expect(r.id).toBeDefined();
                expect(r.name).not.toMatch(/^\{?[0-9a-f]{8}-[0-9a-f]{4}/i); // Not raw GUID
                expect(r.subscriptionName).toBeDefined();
                expect(r.resourceGroup).toBeDefined();
                expect(r.leakCategory).toBeDefined();
                expect(typeof r.estimatedMonthlySavingsUSD).toBe("number");
            }
        });

        it("should calculate category breakdown colors matching corporate blue scheme", () => {
            const summary = AzureZombieHuntingService.getMockFinancialLeaks("Enterprise");
            for (const cat of summary.breakdownByCategory) {
                expect(cat.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
                expect(cat.savingsUSD).toBeGreaterThanOrEqual(0);
                expect(cat.count).toBeGreaterThan(0);
            }
        });
    });

    describe("getFinancialLeaksSummary", () => {
        it("should return mock data immediately for demo tenants", async () => {
            const summary = await AzureZombieHuntingService.getFinancialLeaksSummary(
                "demo-tenant-123",
                null,
                "Enterprise"
            );
            expect(summary).toBeDefined();
            expect(summary.totalAffectedResources).toBeGreaterThan(0);
        });
    });
});

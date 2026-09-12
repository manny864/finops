import { describe, it, expect } from "vitest";
import { AzureCommitmentSimulatorService } from "@/services/azureCommitmentSimulator.service";

describe("MEJ-16: AzureCommitmentSimulatorService", () => {
    it("calcula deterministamente el breakeven a 1 y 3 años con valores estándar", () => {
        const result = AzureCommitmentSimulatorService.calculateBreakeven({
            paygMonthly: 3500,
            discount1yrPct: 0.38,
            discount3yrPct: 0.62
        });

        expect(result.paygMonthly).toBe(3500);
        expect(result.ri1yrMonthly).toBeCloseTo(3500 * 0.62, 2);
        expect(result.ri3yrMonthly).toBeCloseTo(3500 * 0.38, 2);
        expect(result.savingsMonthly1yr).toBeCloseTo(3500 * 0.38, 2);
        expect(result.savingsMonthly3yr).toBeCloseTo(3500 * 0.62, 2);

        // 12 * 0.62 = 7.44 -> 7.4
        expect(result.breakevenMonths1yr).toBe(7.4);
        // 36 * 0.38 = 13.68 -> 13.7
        expect(result.breakevenMonths3yr).toBe(13.7);

        expect(result.recommendedMix.savingsPlansPercent).toBe(55);
        expect(result.recommendedMix.reservedInstancesPercent).toBe(30);
        expect(result.recommendedMix.paygPercent).toBe(15);
        expect(result.recommendedMix.projectedAnnualSavingsUSD).toBeGreaterThan(0);
    });

    it("adapta el mix sugerido cuando el workload es database", () => {
        const result = AzureCommitmentSimulatorService.calculateBreakeven({
            paygMonthly: 5000,
            workloadType: "database"
        });

        expect(result.recommendedMix.reservedInstancesPercent).toBe(70);
        expect(result.recommendedMix.savingsPlansPercent).toBe(20);
        expect(result.recommendedMix.paygPercent).toBe(10);
        expect(result.recommendedMix.explanation).toContain("bases de datos");
    });

    it("adapta el mix sugerido cuando el workload es compute", () => {
        const result = AzureCommitmentSimulatorService.calculateBreakeven({
            paygMonthly: 8000,
            workloadType: "compute"
        });

        expect(result.recommendedMix.savingsPlansPercent).toBe(70);
        expect(result.recommendedMix.reservedInstancesPercent).toBe(15);
        expect(result.recommendedMix.paygPercent).toBe(15);
        expect(result.recommendedMix.explanation).toContain("cómputo elástico");
    });

    it("devuelve breakeven 0 si paygMonthly es 0", () => {
        const result = AzureCommitmentSimulatorService.calculateBreakeven({
            paygMonthly: 0
        });

        expect(result.breakevenMonths1yr).toBe(0);
        expect(result.breakevenMonths3yr).toBe(0);
        expect(result.savingsMonthly1yr).toBe(0);
    });

    it("obtiene la cuota de $50,000 USD de devolución para tenants demo con cálculo de restantes", async () => {
        const quota = await AzureCommitmentSimulatorService.getExchangeQuota("demo-tenant-1");

        expect(quota.totalLimitUSD).toBe(50000);
        expect(quota.usedRefundsUSD).toBe(8500);
        expect(quota.remainingQuotaUSD).toBe(41500);
        expect(quota.usagePercentage).toBe(17.0);
        expect(quota.isWarning).toBe(false);
        expect(quota.isCritical).toBe(false);
    });
});

import { describe, it, expect } from "vitest";
import {
  estimateAppServiceMonthlyCost,
  estimateFunctionAppMonthlyCost,
} from "@/app/api/intelligence/compute/workloads/route";

describe("Compute Workloads Retail Pricing Fallback Estimators", () => {
  describe("App Service Plans (Web Apps)", () => {
    it("should estimate Free and Shared tiers correctly", () => {
      expect(estimateAppServiceMonthlyCost("F1", "Free")).toBe(0);
      expect(estimateAppServiceMonthlyCost("D1", "Shared", 1)).toBe(9.49);
      expect(estimateAppServiceMonthlyCost("D1", "Shared", 2)).toBe(18.98);
    });

    it("should estimate Basic tier on Linux and Windows", () => {
      // Linux B1
      expect(estimateAppServiceMonthlyCost("B1", "Basic", 1, true)).toBe(13.14);
      // Windows B1
      expect(estimateAppServiceMonthlyCost("B1", "Basic", 1, false)).toBe(54.75);
      // Linux B2 (2 workers)
      expect(estimateAppServiceMonthlyCost("B2", "Basic", 2, true)).toBe(52.56);
    });

    it("should estimate Standard and Premium v3 tiers accurately", () => {
      // Standard S1 Linux
      expect(estimateAppServiceMonthlyCost("S1", "Standard", 1, true)).toBe(43.80);
      // Premium P1v3 Linux
      expect(estimateAppServiceMonthlyCost("P1v3", "PremiumV3", 1, true)).toBe(62.05);
      // Premium P1v3 Windows
      expect(estimateAppServiceMonthlyCost("P1v3", "PremiumV3", 1, false)).toBe(91.25);
    });
  });

  describe("Function Apps", () => {
    it("should estimate Consumption (Y1) with base serverless costs", () => {
      const zeroCost = estimateFunctionAppMonthlyCost("consumption", "Y1", 0, 0);
      expect(zeroCost).toBe(2.50);

      const highTrafficCost = estimateFunctionAppMonthlyCost("consumption", "Y1", 5_000_000, 2_000_000);
      expect(highTrafficCost).toBeGreaterThan(2.50);
    });

    it("should estimate Elastic Premium tiers accurately", () => {
      expect(estimateFunctionAppMonthlyCost("elastic_premium", "EP1")).toBe(153.30);
      expect(estimateFunctionAppMonthlyCost("elastic_premium", "EP2")).toBe(306.60);
      expect(estimateFunctionAppMonthlyCost("elastic_premium", "EP3")).toBe(613.20);
    });

    it("should estimate Flex Consumption tier accurately", () => {
      expect(estimateFunctionAppMonthlyCost("flex_consumption", "FC1")).toBe(28.50);
    });

    it("should estimate Dedicated Function App hosting plan", () => {
      const dedicatedCost = estimateFunctionAppMonthlyCost("dedicated", "B1");
      expect(dedicatedCost).toBe(13.14);
    });
  });
});

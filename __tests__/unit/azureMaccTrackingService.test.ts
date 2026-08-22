import { describe, it, expect } from "vitest";
import {
  computeMaccStatus,
  generateMaccPacingTrend,
  simulateMaccRenegotiation,
  getMockMaccPayload,
  assembleLiveMaccTracking,
} from "@/services/azureMaccTracking.service";

describe("azureMaccTracking.service", () => {
  describe("computeMaccStatus", () => {
    it("returns EARLY_COMPLETION when projected > commitment * 1.10", () => {
      const status = computeMaccStatus(6200000, 10000000, 14000000);
      expect(status).toBe("EARLY_COMPLETION");
    });

    it("returns ON_TRACK when projected is within 90%-110% of commitment", () => {
      const status = computeMaccStatus(5000000, 10000000, 10500000);
      expect(status).toBe("ON_TRACK");
    });

    it("returns UNDER_BURN_RISK when projected < commitment * 0.90", () => {
      const status = computeMaccStatus(2000000, 10000000, 8000000);
      expect(status).toBe("UNDER_BURN_RISK");
    });
  });

  describe("generateMaccPacingTrend", () => {
    it("generates monthly pacing data points with actual, linear, and forecast targets", () => {
      const trend = generateMaccPacingTrend(
        10000000,
        5000000,
        500000,
        "2025-01-01",
        "2027-01-01"
      );

      expect(trend.length).toBeGreaterThan(0);
      expect(trend[0].commitmentTargetUSD).toBe(10000000);
      expect(trend[0].linearTargetUSD).toBeDefined();
    });
  });

  describe("simulateMaccRenegotiation", () => {
    it("calculates estimated completion date and higher tier savings accurately", () => {
      const result = simulateMaccRenegotiation(10000000, 6000000, 500000, 50);

      expect(result.simulatedCommitmentUSD).toBe(15000000);
      expect(result.simulatedDiscountPercentage).toBeGreaterThanOrEqual(result.currentTierDiscountPercentage);
      expect(result.additionalAnnualSavingsUSD).toBeGreaterThan(0);
      expect(result.estimatedCompletionDate).toBeDefined();
    });
  });

  describe("getMockMaccPayload & assembleLiveMaccTracking", () => {
    it("returns deterministic enterprise mock payload with 2 billing accounts", () => {
      const payload = getMockMaccPayload("demo-4444");
      expect(payload.source).toBe("mock");
      expect(payload.metrics.billingAccounts.length).toBe(2);
      expect(payload.metrics.totalCommitmentUSD).toBe(15000000);
    });

    it("assembles live MACC tracking payload with zero/empty fallback for live tenants", () => {
      const payload = assembleLiveMaccTracking({
        billingAccounts: [],
        subscriptionsBreakdown: [],
      });
      expect(payload.source).toBe("live");
      expect(payload.metrics.totalCommitmentUSD).toBe(0);
      expect(payload.metrics.billingAccounts.length).toBe(0);
    });
  });
});

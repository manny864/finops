import { describe, it, expect } from "vitest";
import {
  generateMockHistoricalProgress,
  getDaysForRange,
  estimateMonthlySavings,
} from "@/services/azureHistoricalProgress.service";

describe("azureHistoricalProgress.service", () => {
  it("should calculate correct day count for each time range", () => {
    expect(getDaysForRange("30d")).toBe(30);
    expect(getDaysForRange("90d")).toBe(90);
    expect(getDaysForRange("180d")).toBe(180);
    expect(getDaysForRange("365d")).toBe(365);
  });

  it("should estimate monthly savings by ARM type", () => {
    // El disco Premium ya no vale el viejo literal de 15 USD: la línea base pasa
    // a `AZURE_MONTHLY_BASELINE_BY_TYPE` con el precio real de un P10 128 GiB.
    expect(
      estimateMonthlySavings(
        "/subscriptions/sub1/resourceGroups/rg/providers/Microsoft.Compute/disks/disk1"
      )
    ).toBeCloseTo(19.71, 2);
    expect(
      estimateMonthlySavings(
        "/subscriptions/sub1/resourceGroups/rg/providers/Microsoft.Network/ddosProtectionPlans/plan1"
      )
    ).toBe(2944.0);
    // Regresión del bug reportado: un Azure Bastion declaraba 15 USD/mes de
    // ahorro porque no estaba catalogado y caía en el fallback.
    expect(
      estimateMonthlySavings(
        "/subscriptions/sub1/resourceGroups/rg-network-core/providers/Microsoft.Network/bastionHosts/bastion-prod"
      )
    ).toBeGreaterThanOrEqual(140);
    // Un tipo desconocido ya no devuelve el fallback inventado, devuelve 0.
    expect(
      estimateMonthlySavings(
        "/subscriptions/sub1/resourceGroups/rg/providers/Microsoft.Fake/widgets/w1"
      )
    ).toBe(0);
  });

  it("should generate deterministic mock historical progress for demo tenant", () => {
    const report = generateMockHistoricalProgress("90d", "Enterprise");
    expect(report.success).toBe(true);
    expect(report.summary.currentMaturityScore).toBeGreaterThan(0);
    expect(report.summary.currentMaturityScore).toBeLessThanOrEqual(100);
    expect(report.series.length).toBeGreaterThan(0);

    // Verify Counterfactual Spend >= Actual Spend
    const lastPoint = report.series[report.series.length - 1];
    expect(lastPoint.counterfactualSpendUSD).toBeGreaterThanOrEqual(
      lastPoint.actualSpendUSD
    );

    // Verify 4 tabs of data
    expect(report.beforeAfterVerifications.length).toBeGreaterThan(0);
    expect(report.architectureMilestones.length).toBeGreaterThan(0);
    expect(report.waiverLedger.length).toBeGreaterThan(0);
  });
});

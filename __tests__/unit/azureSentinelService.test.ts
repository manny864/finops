import { describe, it, expect } from "vitest";
import {
  generateMockSentinelData,
  calculateSentinelSummary,
  generateSentinelRecommendations,
} from "@/services/azureSentinelFinops.service";
import { buildSentinelRemediationCommand } from "@/lib/aiRemediations";
import type {
  SentinelResource,
  SentinelRemediationAction,
} from "@/types/azureSentinel.types";

describe("Microsoft Sentinel FinOps Service", () => {
  it("should generate mock Sentinel data with valid structure and metrics", () => {
    const data = generateMockSentinelData();
    expect(data.source).toBe("mock");
    expect(data.workspaces.length).toBeGreaterThan(0);
    expect(data.summary.activeWorkspacesCount).toBeGreaterThan(0);
    expect(data.summary.totalMonthlyCostUSD).toBeGreaterThan(0);
    expect(data.summary.totalIngestedGB).toBeGreaterThan(0);
    expect(data.topTables.length).toBe(5);
    expect(data.dailyTrend.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should calculate summary metrics and evaluate FinOps Sentinel optimization rules", () => {
    const testWorkspaces: SentinelResource[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-soc/providers/microsoft.operationalinsights/workspaces/law-sentinel-heavy",
        name: "law-sentinel-heavy",
        location: "eastus2",
        resourceGroup: "rg-soc",
        subscriptionId: "sub-1",
        subscriptionName: "SOC Prod Sub",
        lawPricingTier: "PerGB2018",
        retentionInDays: 180,
        dailyCapGB: null,
        isDailyCapUnlimited: true,
        totalIngestedGB_MTD: 4500.0,
        avgDailyIngestionGB: 150.0, // > 100 GB/day -> Commitment Tier candidate
        costMtdUSD: 10350.0, // 4500 * 2.30
        specializedCostUSD: 9000.0, // 4500 * 2.00
        totalRealCostUSD: 19350.0, // 4500 * 4.30
        potentialSavingsUSD: 0,
        isWasteful: true,
        isDevOrTest: false,
        isOrphan: false,
        orphanRulesCount: 3,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/microsoft.operationalinsights/workspaces/law-sentinel-dev",
        name: "law-sentinel-dev",
        location: "eastus",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        lawPricingTier: "PerGB2018",
        retentionInDays: 30,
        dailyCapGB: null,
        isDailyCapUnlimited: true,
        totalIngestedGB_MTD: 150.0,
        avgDailyIngestionGB: 5.0,
        costMtdUSD: 345.0,
        specializedCostUSD: 300.0,
        totalRealCostUSD: 645.0,
        potentialSavingsUSD: 0,
        isWasteful: true,
        isDevOrTest: true,
        isOrphan: false,
        orphanRulesCount: 0,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-pci/providers/microsoft.operationalinsights/workspaces/law-sentinel-pci",
        name: "law-sentinel-pci",
        location: "westeurope",
        resourceGroup: "rg-pci",
        subscriptionId: "sub-1",
        subscriptionName: "PCI Sub",
        lawPricingTier: "CapacityReservation100GB",
        retentionInDays: 365, // > 90d -> Retention adjust candidate
        dailyCapGB: 50,
        isDailyCapUnlimited: false,
        totalIngestedGB_MTD: 2500.0,
        avgDailyIngestionGB: 83.3,
        costMtdUSD: 4900.0,
        specializedCostUSD: 3075.0,
        totalRealCostUSD: 7975.0,
        potentialSavingsUSD: 0,
        isWasteful: true,
        isDevOrTest: false,
        isOrphan: false,
        orphanRulesCount: 0,
      },
    ];

    const recommendations = generateSentinelRecommendations(testWorkspaces);
    expect(recommendations.length).toBeGreaterThan(0);

    const summary = calculateSentinelSummary(testWorkspaces, recommendations);
    expect(summary.activeWorkspacesCount).toBe(3);
    expect(summary.unlimitedCapCount).toBe(2);
    expect(summary.orphanRulesCount).toBe(3);
    expect(summary.totalIngestedGB).toBe(7150.0);
    expect(summary.totalMonthlyCostUSD).toBeCloseTo(27970.0, 1);
    expect(summary.potentialSavingsUSD).toBeGreaterThan(0);
  });

  it("should generate valid Azure CLI and PowerShell remediation scripts for Sentinel", () => {
    const action: SentinelRemediationAction = {
      id: "rem-sentinel-tier-1",
      resourceId:
        "/subscriptions/sub-1/resourceGroups/rg-soc/providers/microsoft.operationalinsights/workspaces/law-sentinel-prod",
      resourceName: "law-sentinel-prod",
      title: "Migrar a Capacity Reservation 100 GB",
      description: "Ahorro del 25% en tarifa combinada Sentinel + LAW",
      category: "COMMITMENT_TIER",
      estimatedSavingsUSD: 2450.0,
      confidence: "HIGH",
      actionType: "SWITCH_TO_CAPACITY_RESERVATION",
      recommendedTier: "CapacityReservation100GB",
    };

    const command = buildSentinelRemediationCommand(action);
    expect(command.cli).toContain("az monitor log-analytics workspace update");
    expect(command.cli).toContain("law-sentinel-prod");
    expect(command.cli).toContain("rg-soc");
    expect(command.cli).toContain("CapacityReservation");
    expect(command.powershell).toContain("Set-AzOperationalInsightsWorkspace");
  });
});

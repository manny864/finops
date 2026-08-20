import { describe, it, expect } from "vitest";
import {
  generateMockLogAnalyticsData,
  calculateLogAnalyticsSummary,
  generateLogAnalyticsRecommendations,
} from "@/services/azureLogAnalytics.service";
import { buildLogAnalyticsRemediationCommand } from "@/lib/aiRemediations";
import type {
  LogAnalyticsResource,
  LogAnalyticsRemediationAction,
} from "@/types/azureLogAnalytics.types";

describe("Azure Log Analytics Workspace FinOps Service", () => {
  it("should generate mock Log Analytics data with valid structure and metrics", () => {
    const data = generateMockLogAnalyticsData();
    expect(data.source).toBe("mock");
    expect(data.workspaces.length).toBeGreaterThan(0);
    expect(data.summary.workspacesCount).toBeGreaterThan(0);
    expect(data.summary.totalMonthlyCostUSD).toBeGreaterThan(0);
    expect(data.summary.totalIngestedGB).toBeGreaterThan(0);
    expect(data.summary.breakdownByPricingTier.length).toBeGreaterThan(0);
    expect(data.dailyIngestionTrend.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should correctly calculate summary metrics and evaluate FinOps optimization rules", () => {
    const testWorkspaces: LogAnalyticsResource[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.operationalinsights/workspaces/law-prod-heavy",
        name: "law-prod-heavy",
        location: "eastus2",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        pricingTier: "PerGB2018",
        retentionInDays: 30,
        totalBillableGB_MTD: 4500.0,
        avgDailyIngestionGB: 150.0, // > 100 GB/day -> Commitment Tier
        dailyCapGB: null,
        isDailyCapUnlimited: true,
        isDevOrTest: false,
        isOrphan: false,
        isWasteful: true,
        monthlyCostUSD: 10350.0, // 4500 * 2.30
        specializedCostUSD: 0,
        totalRealCostUSD: 10350.0,
        potentialSavingsUSD: 0,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/microsoft.operationalinsights/workspaces/law-dev-nocap",
        name: "law-dev-nocap",
        location: "eastus",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        pricingTier: "PerGB2018",
        retentionInDays: 30,
        totalBillableGB_MTD: 150.0,
        avgDailyIngestionGB: 5.0,
        dailyCapGB: null,
        isDailyCapUnlimited: true, // Dev without Daily Cap
        isDevOrTest: true,
        isOrphan: false,
        isWasteful: true,
        monthlyCostUSD: 345.0, // 150 * 2.30
        specializedCostUSD: 0,
        totalRealCostUSD: 345.0,
        potentialSavingsUSD: 0,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-audit/providers/microsoft.operationalinsights/workspaces/law-audit-longretention",
        name: "law-audit-longretention",
        location: "westeurope",
        resourceGroup: "rg-audit",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        pricingTier: "PerGB2018",
        retentionInDays: 365, // > 90 days retention
        totalBillableGB_MTD: 600.0,
        avgDailyIngestionGB: 20.0,
        dailyCapGB: 25,
        isDailyCapUnlimited: false,
        isDevOrTest: false,
        isOrphan: false,
        isWasteful: true,
        monthlyCostUSD: 1380.0,
        specializedCostUSD: 801.6, // 600 * (334/30) * 0.12
        totalRealCostUSD: 2181.6,
        potentialSavingsUSD: 0,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dead/providers/microsoft.operationalinsights/workspaces/law-orphan-idle",
        name: "law-orphan-idle",
        location: "westeurope",
        resourceGroup: "rg-dead",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        pricingTier: "PerGB2018",
        retentionInDays: 30,
        totalBillableGB_MTD: 0,
        avgDailyIngestionGB: 0,
        dailyCapGB: null,
        isDailyCapUnlimited: true,
        isDevOrTest: false,
        isOrphan: true, // Orphan LAW
        isWasteful: true,
        monthlyCostUSD: 0,
        specializedCostUSD: 0,
        totalRealCostUSD: 0,
        potentialSavingsUSD: 0,
      },
    ];

    const summary = calculateLogAnalyticsSummary(testWorkspaces);
    expect(summary.workspacesCount).toBe(4);
    expect(summary.unlimitedCapCount).toBe(3);
    expect(summary.totalIngestedGB).toBe(5250.0);
    expect(summary.totalMonthlyCostUSD).toBe(12876.6);

    const recommendations = generateLogAnalyticsRecommendations(testWorkspaces);
    expect(recommendations.length).toBeGreaterThan(0);

    // Rule 1: Commitment tier upgrade for heavy workload
    const tierRec = recommendations.find(
      (r) => r.category === "COMMITMENT_TIER" && r.resourceId.includes("law-prod-heavy")
    );
    expect(tierRec).toBeDefined();
    expect(tierRec?.estimatedSavingsUSD).toBeGreaterThan(1000);
    expect(tierRec?.recommendedTier).toBe("CapacityReservation100GB");

    // Rule 2: Daily cap for dev environment
    const capRec = recommendations.find(
      (r) => r.category === "DAILY_CAP" && r.resourceId.includes("law-dev-nocap")
    );
    expect(capRec).toBeDefined();
    expect(capRec?.recommendedDailyCapGB).toBe(5);

    // Rule 3: Retention adjustment for 365 days
    const retentionRec = recommendations.find(
      (r) => r.category === "RETENTION_ADJUST" && r.resourceId.includes("law-audit-longretention")
    );
    expect(retentionRec).toBeDefined();
    expect(retentionRec?.recommendedRetentionDays).toBe(30);

    // Rule 4: Orphan workspace purge
    const orphanRec = recommendations.find(
      (r) => r.category === "PURGE_ORPHAN" && r.resourceId.includes("law-orphan-idle")
    );
    expect(orphanRec).toBeDefined();
  });

  it("should generate valid Azure CLI and PowerShell remediation scripts", () => {
    const tierAction: LogAnalyticsRemediationAction = {
      id: "rem-law-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/microsoft.operationalinsights/workspaces/law-prod",
      resourceName: "law-prod",
      title: "Migrar a Commitment Tier de 100 GB/día",
      description: "Ahorro por volumen sostenido",
      category: "COMMITMENT_TIER",
      estimatedSavingsUSD: 1470,
      confidence: "HIGH",
      actionType: "UPGRADE_COMMITMENT_TIER",
      recommendedTier: "CapacityReservation100GB",
    };

    const tierCmd = buildLogAnalyticsRemediationCommand(tierAction);
    expect(tierCmd.cli).toContain("az monitor log-analytics workspace update");
    expect(tierCmd.cli).toContain("--capacity-reservation-level 100");
    expect(tierCmd.powershell).toContain("Set-AzOperationalInsightsWorkspace");
    expect(tierCmd.powershell).toContain("-CapacityReservationLevel 100");

    const capAction: LogAnalyticsRemediationAction = {
      id: "rem-law-2",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-dev/providers/microsoft.operationalinsights/workspaces/law-dev",
      resourceName: "law-dev",
      title: "Fijar Daily Cap de 5 GB/día",
      description: "Evitar picos",
      category: "DAILY_CAP",
      estimatedSavingsUSD: 100,
      confidence: "HIGH",
      actionType: "SET_DAILY_CAP",
      recommendedDailyCapGB: 5,
    };

    const capCmd = buildLogAnalyticsRemediationCommand(capAction);
    expect(capCmd.cli).toContain("az monitor log-analytics workspace update");
    expect(capCmd.cli).toContain("--daily-quota 5");
    expect(capCmd.powershell).toContain("Set-AzOperationalInsightsWorkspace");
    expect(capCmd.powershell).toContain("-DailyQuotaGb 5");

    const retentionAction: LogAnalyticsRemediationAction = {
      id: "rem-law-3",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-audit/providers/microsoft.operationalinsights/workspaces/law-audit",
      resourceName: "law-audit",
      title: "Optimizar Retención a 30 días",
      description: "Reducir retención",
      category: "RETENTION_ADJUST",
      estimatedSavingsUSD: 400,
      confidence: "MEDIUM",
      actionType: "REDUCE_RETENTION",
      recommendedRetentionDays: 30,
    };

    const retentionCmd = buildLogAnalyticsRemediationCommand(retentionAction);
    expect(retentionCmd.cli).toContain("az monitor log-analytics workspace update");
    expect(retentionCmd.cli).toContain("--retention-time 30");
    expect(retentionCmd.powershell).toContain("Set-AzOperationalInsightsWorkspace");
    expect(retentionCmd.powershell).toContain("-RetentionInDays 30");
  });
});

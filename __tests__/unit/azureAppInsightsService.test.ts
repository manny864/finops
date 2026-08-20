import { describe, it, expect } from "vitest";
import {
  generateMockAppInsightsData,
  calculateAppInsightsSummary,
  generateAppInsightsRecommendations,
  buildAppInsightsRemediationCommand,
} from "@/services/azureAppInsights.service";
import type { AppInsightsResourceItem, AppInsightsRemediationAction } from "@/types/azureAppInsights.types";

describe("Azure Application Insights FinOps Service", () => {
  it("should generate mock Application Insights data with valid structure and metrics", () => {
    const data = generateMockAppInsightsData();
    expect(data.source).toBe("mock");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.summary.instancesCount).toBeGreaterThan(0);
    expect(data.summary.totalCostMtdUSD).toBeGreaterThan(0);
    expect(data.summary.totalIngestedGB).toBeGreaterThan(0);
    expect(data.summary.breakdownByTelemetryType.length).toBe(4);
    expect(data.dailyIngestionTrend.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should correctly calculate summary metrics and detection of runaway telemetry risks", () => {
    const testItems: AppInsightsResourceItem[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-staging/providers/microsoft.insights/components/appi-staging-core",
        name: "appi-staging-core",
        location: "eastus2",
        resourceGroup: "rg-staging",
        subscriptionId: "sub-1",
        subscriptionName: "Staging Sub",
        linkedWorkspaceId: "/subscriptions/sub-1/resourceGroups/rg-staging/providers/Microsoft.OperationalInsights/workspaces/law-staging",
        linkedWorkspaceName: "law-staging",
        applicationType: "web",
        samplingPercentage: 100,
        dailyCapGB: undefined,
        isDailyCapUnlimited: true,
        ingestedTotalGB: 45.0,
        tracesGB: 30.0,
        dependenciesGB: 8.0,
        requestsGB: 5.0,
        exceptionsGB: 2.0,
        estimatedCostMtdUSD: 103.5, // 45 * 2.30
        forecastCostUSD: 140.0,
        isDevOrTest: true,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/microsoft.insights/components/appi-prod-api",
        name: "appi-prod-api",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        linkedWorkspaceId: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.OperationalInsights/workspaces/law-prod",
        linkedWorkspaceName: "law-prod",
        applicationType: "web",
        samplingPercentage: 100,
        dailyCapGB: 50,
        isDailyCapUnlimited: false,
        ingestedTotalGB: 120.0,
        tracesGB: 90.0, // 75% traces
        dependenciesGB: 15.0,
        requestsGB: 10.0,
        exceptionsGB: 5.0,
        estimatedCostMtdUSD: 276.0, // 120 * 2.30
        forecastCostUSD: 360.0,
        isDevOrTest: false,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-legacy/providers/microsoft.insights/components/appi-dead-legacy",
        name: "appi-dead-legacy",
        location: "westeurope",
        resourceGroup: "rg-legacy",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        linkedWorkspaceId: "/subscriptions/sub-1/resourceGroups/rg-legacy/providers/Microsoft.OperationalInsights/workspaces/law-dev",
        linkedWorkspaceName: "law-dev",
        applicationType: "web",
        samplingPercentage: 100,
        dailyCapGB: undefined,
        isDailyCapUnlimited: true,
        ingestedTotalGB: 0.0,
        tracesGB: 0.0,
        dependenciesGB: 0.0,
        requestsGB: 0.0,
        exceptionsGB: 0.0,
        estimatedCostMtdUSD: 0.0,
        forecastCostUSD: 0.0,
        isDevOrTest: true,
        isOrphan: true,
      },
    ];

    const summary = calculateAppInsightsSummary(testItems);
    expect(summary.instancesCount).toBe(3);
    expect(summary.unlimitedCapCount).toBe(2);
    expect(summary.totalIngestedGB).toBe(165.0);
    expect(summary.totalCostMtdUSD).toBe(379.5);

    const recommendations = generateAppInsightsRecommendations(testItems);
    expect(recommendations.length).toBeGreaterThan(0);

    // Rule 1: Staging without Daily Cap
    const dailyCapRec = recommendations.find(
      (r) => r.category === "SET_DAILY_CAP" && r.resourceId.includes("appi-staging-core")
    );
    expect(dailyCapRec).toBeDefined();
    expect(dailyCapRec?.actionType).toBe("SET_DAILY_CAP");

    // Rule 2: High traces sampling optimization
    const samplingRec = recommendations.find(
      (r) => r.category === "REDUCE_SAMPLING" && r.resourceId.includes("appi-prod-api")
    );
    expect(samplingRec).toBeDefined();
    expect(samplingRec?.estimatedSavingsUSD).toBeCloseTo(110.4, 1);

    // Rule 3: Orphan instance purge
    const orphanRec = recommendations.find(
      (r) => r.category === "PURGE_ORPHAN" && r.resourceId.includes("appi-dead-legacy")
    );
    expect(orphanRec).toBeDefined();
  });

  it("should generate valid Azure CLI and PowerShell remediation commands", () => {
    const capAction: AppInsightsRemediationAction = {
      id: "rem-ai-cap-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-staging/providers/microsoft.insights/components/appi-staging",
      resourceName: "appi-staging",
      title: "Fijar Daily Cap de 5 GB/día",
      description: "Establecer tope diario de ingesta",
      category: "SET_DAILY_CAP",
      estimatedSavingsUSD: 50,
      confidence: "HIGH",
      actionType: "SET_DAILY_CAP",
      recommendedDailyCapGB: 5,
    };

    const capCmd = buildAppInsightsRemediationCommand(capAction);
    expect(capCmd.cli).toContain("az monitor app-insights component update");
    expect(capCmd.cli).toContain("--daily-cap 5");
    expect(capCmd.powershell).toContain("Set-AzApplicationInsights");

    const samplingAction: AppInsightsRemediationAction = {
      id: "rem-ai-samp-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/microsoft.insights/components/appi-prod",
      resourceName: "appi-prod",
      title: "Optimizar Adaptive Sampling al 50%",
      description: "Ajustar tasa de muestreo",
      category: "REDUCE_SAMPLING",
      estimatedSavingsUSD: 120,
      confidence: "HIGH",
      actionType: "REDUCE_SAMPLING",
      recommendedSamplingPercentage: 50,
    };

    const samplingCmd = buildAppInsightsRemediationCommand(samplingAction);
    expect(samplingCmd.cli).toContain("az monitor app-insights component update");
    expect(samplingCmd.cli).toContain("--sampling-percentage 50");
    expect(samplingCmd.powershell).toContain("Set-AzApplicationInsights");

    const orphanAction: AppInsightsRemediationAction = {
      id: "rem-ai-orph-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-dev/providers/microsoft.insights/components/appi-orphan",
      resourceName: "appi-orphan",
      title: "Purgar App Insights Huérfana",
      description: "Eliminar instancia desmantelada",
      category: "PURGE_ORPHAN",
      estimatedSavingsUSD: 10,
      confidence: "HIGH",
      actionType: "PURGE_ORPHAN",
    };

    const orphanCmd = buildAppInsightsRemediationCommand(orphanAction);
    expect(orphanCmd.cli).toContain("az monitor app-insights component delete");
    expect(orphanCmd.powershell).toContain("Remove-AzApplicationInsights");
  });
});

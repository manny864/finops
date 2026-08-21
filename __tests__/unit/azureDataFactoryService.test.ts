import { describe, it, expect } from "vitest";
import {
  generateMockAdfData,
  calculateAdfSummary,
  generateAdfRecommendations,
  buildAdfRemediationCommand,
} from "@/services/azureDataFactory.service";
import type { AdfResourceItem, AdfRemediationAction } from "@/types/azureDataFactory.types";

describe("Azure Data Factory (ADF) FinOps Service", () => {
  it("should generate mock ADF data with valid structure and metrics", () => {
    const data = generateMockAdfData();
    expect(data.source).toBe("mock");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.summary.totalDataFactories).toBeGreaterThan(0);
    expect(data.summary.costMtdUSD).toBeGreaterThan(0);
    expect(data.costDistribution.length).toBeGreaterThan(0);
    expect(data.trendHistory.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should correctly calculate summary and arbitrage opportunities", () => {
    const testItems: AdfResourceItem[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.DataFactory/factories/adf-prod-heavy",
        name: "adf-prod-heavy",
        location: "eastus2",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        avgIRUtilizationPercentage: 15.0,
        totalPipelineRuns: 1500,
        avgPipelineDurationMinutes: 12.0,
        costMtdUSD: 1200.0,
        costPreviousPeriodUSD: 1200.0,
        forecastEomUSD: 1200.0,
        integrationRuntimesCount: 3,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.DataFactory/factories/adf-prod-dataflows",
        name: "adf-prod-dataflows",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        avgIRUtilizationPercentage: 65.0,
        totalPipelineRuns: 450,
        avgPipelineDurationMinutes: 25.0,
        costMtdUSD: 800.0,
        costPreviousPeriodUSD: 780.0,
        forecastEomUSD: 820.0,
        integrationRuntimesCount: 2,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dead/providers/Microsoft.DataFactory/factories/adf-dead-orphan",
        name: "adf-dead-orphan",
        location: "westeurope",
        resourceGroup: "rg-dead",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        avgIRUtilizationPercentage: 0.0,
        totalPipelineRuns: 0,
        avgPipelineDurationMinutes: 0.0,
        costMtdUSD: 120.0,
        costPreviousPeriodUSD: 120.0,
        forecastEomUSD: 120.0,
        integrationRuntimesCount: 1,
        isOrphan: true,
      },
    ];

    const summary = calculateAdfSummary(testItems);
    expect(summary.totalDataFactories).toBe(3);
    expect(summary.totalPipelineRunsMTD).toBe(1950);
    expect(summary.costMtdUSD).toBe(2120.0);

    const recommendations = generateAdfRecommendations(testItems);
    expect(recommendations.length).toBeGreaterThan(0);

    const irDowngrade = recommendations.find(
      (r) => r.category === "IR_DOWNGRADE"
    );
    expect(irDowngrade).toBeDefined();
    expect(irDowngrade?.estimatedSavingsUSD).toBe(540.0); // 1200 * 0.45

    const dfCache = recommendations.find(
      (r) => r.category === "DATA_FLOW_CACHE_ENABLE"
    );
    expect(dfCache).toBeDefined();
    expect(dfCache?.estimatedSavingsUSD).toBe(200.0); // 800 * 0.25

    const orphanPurge = recommendations.find(
      (r) => r.category === "ORPHAN_PURGE"
    );
    expect(orphanPurge).toBeDefined();
    expect(orphanPurge?.estimatedSavingsUSD).toBe(120.0);
  });

  it("should generate valid Azure CLI and PowerShell scripts for remediation", () => {
    const irAction: AdfRemediationAction = {
      id: "rem-adf-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.DataFactory/factories/adf-prod",
      resourceName: "adf-prod",
      title: "Rightsizing IR",
      description: "Reducir cores a 8 y TTL a 10 min",
      category: "IR_DOWNGRADE",
      estimatedSavingsUSD: 540,
      confidence: "HIGH",
      actionType: "RIGHTSIZE_IR",
      currentCores: 16,
      recommendedCores: 8,
    };

    const irCmd = buildAdfRemediationCommand(irAction);
    expect(irCmd.cli).toContain("az datafactory integration-runtime managed update");
    expect(irCmd.cli).toContain("--time-to-live 10");
    expect(irCmd.powershell).toContain("Set-AzDataFactoryV2IntegrationRuntime");

    const cacheAction: AdfRemediationAction = {
      id: "rem-adf-2",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.DataFactory/factories/adf-prod",
      resourceName: "adf-prod",
      title: "Habilitar Caché Data Flow",
      description: "Activar Quick Reuse TTL 15 min",
      category: "DATA_FLOW_CACHE_ENABLE",
      estimatedSavingsUSD: 200,
      confidence: "MEDIUM",
      actionType: "ENABLE_DATA_FLOW_CACHE",
    };

    const cacheCmd = buildAdfRemediationCommand(cacheAction);
    expect(cacheCmd.cli).toContain("az datafactory integration-runtime managed update");
    expect(cacheCmd.cli).toContain("--time-to-live 15");
    expect(cacheCmd.powershell).toContain("Set-AzDataFactoryV2IntegrationRuntime");

    const orphanAction: AdfRemediationAction = {
      id: "rem-adf-3",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-dev/providers/Microsoft.DataFactory/factories/adf-dead",
      resourceName: "adf-dead",
      title: "Eliminar factoría huérfana",
      description: "Desmantelar factoría inactiva",
      category: "ORPHAN_PURGE",
      estimatedSavingsUSD: 120,
      confidence: "HIGH",
      actionType: "PURGE_ORPHAN",
    };

    const orphanCmd = buildAdfRemediationCommand(orphanAction);
    expect(orphanCmd.cli).toContain("az datafactory delete");
    expect(orphanCmd.powershell).toContain("Remove-AzDataFactoryV2");
  });
});

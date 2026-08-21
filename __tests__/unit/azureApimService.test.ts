import { describe, it, expect } from "vitest";
import {
  generateMockApimData,
  calculateApimSummary,
  generateApimRecommendations,
  buildApimRemediationCommand,
} from "@/services/azureApim.service";
import type { ApimResourceItem } from "@/types/azureApim.types";

describe("Azure API Management (APIM) FinOps Service", () => {
  it("should generate mock APIM data with valid structure and metrics", () => {
    const data = generateMockApimData();
    expect(data.source).toBe("mock");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.summary.totalInstances).toBe(data.items.length);
    expect(data.summary.costMtdUSD).toBeGreaterThan(0);
    expect(data.skuDistribution.length).toBeGreaterThan(0);
    expect(data.trendHistory.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should correctly calculate summary and arbitrage opportunities", () => {
    const testItems: ApimResourceItem[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.ApiManagement/service/apim-dev-eastus",
        name: "apim-dev-eastus",
        location: "eastus",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-1",
        subscriptionName: "Dev/Test Sub",
        skuName: "Premium",
        skuCapacity: 1,
        avgCapacityPercentage: 15,
        totalRequests: 500_000,
        avgLatencyMs: 45,
        costMtdUSD: 2800.0,
        costPreviousPeriodUSD: 2800.0,
        forecastEomUSD: 2800.0,
        isDevOrTest: true,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.ApiManagement/service/apim-prod-eastus",
        name: "apim-prod-eastus",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        skuName: "Premium",
        skuCapacity: 3,
        avgCapacityPercentage: 20,
        totalRequests: 80_000_000,
        avgLatencyMs: 120,
        costMtdUSD: 8400.0,
        costPreviousPeriodUSD: 8400.0,
        forecastEomUSD: 8400.0,
        isDevOrTest: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.ApiManagement/service/apim-prod-basic",
        name: "apim-prod-basic",
        location: "westeurope",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        skuName: "Basic",
        skuCapacity: 1,
        avgCapacityPercentage: 65,
        totalRequests: 5_000_000,
        avgLatencyMs: 85,
        costMtdUSD: 150.0,
        costPreviousPeriodUSD: 150.0,
        forecastEomUSD: 150.0,
        isDevOrTest: false,
      },
    ];

    const summary = calculateApimSummary(testItems);
    expect(summary.totalInstances).toBe(3);
    expect(summary.totalUnits).toBe(5);
    expect(summary.costMtdUSD).toBe(11350.0);
    expect(summary.nonProdSpendPercentage).toBeGreaterThan(20);

    const recommendations = generateApimRecommendations(testItems);
    expect(recommendations.length).toBeGreaterThan(0);

    const devDowngrade = recommendations.find(
      (r) => r.category === "DEV_SKU_DOWNGRADE"
    );
    expect(devDowngrade).toBeDefined();
    expect(devDowngrade?.estimatedSavingsUSD).toBe(2750.0);

    const unitsRightsizing = recommendations.find(
      (r) => r.category === "UNITS_RIGHTSIZING"
    );
    expect(unitsRightsizing).toBeDefined();
    expect(unitsRightsizing?.estimatedSavingsUSD).toBeGreaterThan(0);

    const cacheEnable = recommendations.find(
      (r) => r.category === "CACHE_ENABLE"
    );
    expect(cacheEnable).toBeDefined();
  });

  it("should generate valid Azure CLI and PowerShell scripts for remediation", () => {
    const devAction: ApimRemediationAction = {
      id: "rem-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-dev/providers/Microsoft.ApiManagement/service/apim-dev",
      resourceName: "apim-dev",
      title: "Arbitraje a Developer",
      description: "Downgrade dev SKU",
      category: "DEV_SKU_DOWNGRADE",
      estimatedSavingsUSD: 2750,
      confidence: "HIGH",
      actionType: "SKU_DOWNGRADE",
      currentSku: "Premium",
      recommendedSku: "Developer",
    };

    const devCmd = buildApimRemediationCommand(devAction);
    expect(devCmd.cli).toContain("az apim update");
    expect(devCmd.cli).toContain("--sku-name Developer");
    expect(devCmd.powershell).toContain("Update-AzApiManagement");

    const unitsAction: ApimRemediationAction = {
      id: "rem-2",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.ApiManagement/service/apim-prod",
      resourceName: "apim-prod",
      title: "Rightsizing de Unidades",
      description: "Reducir unidades",
      category: "UNITS_RIGHTSIZING",
      estimatedSavingsUSD: 2800,
      confidence: "HIGH",
      actionType: "REDUCE_UNITS",
      currentCapacity: 3,
      recommendedCapacity: 1,
    };

    const unitsCmd = buildApimRemediationCommand(unitsAction);
    expect(unitsCmd.cli).toContain("az apim update");
    expect(unitsCmd.cli).toContain("--sku-capacity 1");
    expect(unitsCmd.powershell).toContain("-Capacity 1");
  });
});

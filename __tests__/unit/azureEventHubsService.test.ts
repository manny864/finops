import { describe, it, expect } from "vitest";
import {
  generateMockEventHubsData,
  calculateEventHubsSummary,
  generateEventHubsRecommendations,
  buildEventHubsRemediationCommand,
} from "@/services/azureEventHubs.service";
import type { EventHubsResourceItem, EventHubsRemediationAction } from "@/types/azureEventHubs.types";

describe("Azure Event Hubs FinOps Service", () => {
  it("should generate mock Event Hubs data with valid structure and metrics", () => {
    const data = generateMockEventHubsData();
    expect(data.source).toBe("mock");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.summary.totalNamespaces).toBeGreaterThan(0);
    expect(data.summary.costMtdUSD).toBeGreaterThan(0);
    expect(data.skuDistribution.length).toBeGreaterThan(0);
    expect(data.trendHistory.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should correctly calculate summary and arbitrage opportunities", () => {
    const testItems: EventHubsResourceItem[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.EventHub/namespaces/eh-prod-dedicated",
        name: "eh-prod-dedicated",
        location: "eastus2",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        skuName: "Dedicated",
        skuCapacity: 1,
        avgCapacityPercentage: 15.0,
        totalIngressBytes: 500 * 1024 * 1024 * 1024,
        totalEgressBytes: 1000 * 1024 * 1024 * 1024,
        costMtdUSD: 5500.0,
        costPreviousPeriodUSD: 5500.0,
        forecastEomUSD: 5500.0,
        eventHubsCount: 4,
        autoInflateEnabled: false,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.EventHub/namespaces/eh-prod-pu",
        name: "eh-prod-pu",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        skuName: "Premium",
        skuCapacity: 4,
        avgCapacityPercentage: 20.0,
        totalIngressBytes: 200 * 1024 * 1024 * 1024,
        totalEgressBytes: 400 * 1024 * 1024 * 1024,
        costMtdUSD: 1400.0,
        costPreviousPeriodUSD: 1400.0,
        forecastEomUSD: 1400.0,
        eventHubsCount: 6,
        autoInflateEnabled: false,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.EventHub/namespaces/eh-std-autoinflate",
        name: "eh-std-autoinflate",
        location: "westeurope",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        skuName: "Standard",
        skuCapacity: 5,
        avgCapacityPercentage: 25.0,
        totalIngressBytes: 50 * 1024 * 1024 * 1024,
        totalEgressBytes: 100 * 1024 * 1024 * 1024,
        costMtdUSD: 110.0,
        costPreviousPeriodUSD: 110.0,
        forecastEomUSD: 110.0,
        eventHubsCount: 2,
        autoInflateEnabled: true,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dead/providers/Microsoft.EventHub/namespaces/eh-dead-orphan",
        name: "eh-dead-orphan",
        location: "westeurope",
        resourceGroup: "rg-dead",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        skuName: "Basic",
        skuCapacity: 1,
        avgCapacityPercentage: 0.0,
        totalIngressBytes: 0,
        totalEgressBytes: 0,
        costMtdUSD: 11.0,
        costPreviousPeriodUSD: 11.0,
        forecastEomUSD: 11.0,
        eventHubsCount: 1,
        autoInflateEnabled: false,
        isOrphan: true,
      },
    ];

    const summary = calculateEventHubsSummary(testItems);
    expect(summary.totalNamespaces).toBe(4);
    expect(summary.totalEventHubs).toBe(13);
    expect(summary.costMtdUSD).toBe(7021.0);

    const recommendations = generateEventHubsRecommendations(testItems);
    expect(recommendations.length).toBeGreaterThan(0);

    const dedicatedDowngrade = recommendations.find(
      (r) => r.actionType === "DOWNGRADE_DEDICATED"
    );
    expect(dedicatedDowngrade).toBeDefined();
    expect(dedicatedDowngrade?.estimatedSavingsUSD).toBeGreaterThan(5000);

    const puRightsizing = recommendations.find(
      (r) => r.actionType === "REDUCE_UNITS"
    );
    expect(puRightsizing).toBeDefined();
    expect(puRightsizing?.estimatedSavingsUSD).toBe(700.0); // 2 PUs * $350

    const autoInflateOptimize = recommendations.find(
      (r) => r.category === "AUTO_INFLATE_OPTIMIZE"
    );
    expect(autoInflateOptimize).toBeDefined();
    expect(autoInflateOptimize?.estimatedSavingsUSD).toBe(88.0); // 4 TUs * $22

    const orphanPurge = recommendations.find(
      (r) => r.category === "ORPHAN_PURGE"
    );
    expect(orphanPurge).toBeDefined();
  });

  it("should generate valid Azure CLI and PowerShell scripts for remediation", () => {
    const puAction: EventHubsRemediationAction = {
      id: "rem-eh-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.EventHub/namespaces/eh-premium",
      resourceName: "eh-premium",
      title: "Rightsizing PUs",
      description: "Reducir PUs a 2",
      category: "SKU_DOWNGRADE",
      estimatedSavingsUSD: 700,
      confidence: "HIGH",
      actionType: "REDUCE_UNITS",
      currentCapacity: 4,
      recommendedCapacity: 2,
    };

    const puCmd = buildEventHubsRemediationCommand(puAction);
    expect(puCmd.cli).toContain("az eventhubs namespace update");
    expect(puCmd.cli).toContain("--capacity 2");
    expect(puCmd.powershell).toContain("Set-AzEventHubNamespace");

    const autoInflateAction: EventHubsRemediationAction = {
      id: "rem-eh-2",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.EventHub/namespaces/eh-std",
      resourceName: "eh-std",
      title: "Optimizar Auto-inflate",
      description: "Ajustar base a 1 TU",
      category: "AUTO_INFLATE_OPTIMIZE",
      estimatedSavingsUSD: 88,
      confidence: "MEDIUM",
      actionType: "OPTIMIZE_AUTO_INFLATE",
    };

    const autoInflateCmd = buildEventHubsRemediationCommand(autoInflateAction);
    expect(autoInflateCmd.cli).toContain("az eventhubs namespace update");
    expect(autoInflateCmd.cli).toContain("--enable-auto-inflate true");
    expect(autoInflateCmd.powershell).toContain("Set-AzEventHubNamespace");
  });
});

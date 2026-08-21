import { describe, it, expect } from "vitest";
import {
  generateMockServiceBusData,
  calculateServiceBusSummary,
  generateServiceBusRecommendations,
  buildServiceBusRemediationCommand,
} from "@/services/azureServiceBus.service";
import type { ServiceBusNamespaceResource, ServiceBusRemediationAction } from "@/types/azureServiceBus.types";

describe("Azure Service Bus FinOps Service", () => {
  it("should generate mock Service Bus data with valid structure and metrics", () => {
    const data = generateMockServiceBusData();
    expect(data.source).toBe("mock");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.summary.totalNamespaces).toBe(data.items.length);
    expect(data.summary.costMtdUSD).toBeGreaterThan(0);
    expect(data.skuDistribution.length).toBeGreaterThan(0);
    expect(data.trendHistory.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should correctly calculate summary and arbitrage opportunities", () => {
    const testItems: ServiceBusNamespaceResource[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/sb-prod-premium",
        name: "sb-prod-premium",
        location: "eastus2",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        skuName: "Premium",
        skuCapacity: 4,
        avgCapacityPercentage: 20,
        totalMessages: 150_000_000,
        totalMessagingSize: 2048,
        costMtdUSD: 2680.0,
        costPreviousPeriodUSD: 2680.0,
        forecastEomUSD: 2680.0,
        queuesCount: 10,
        topicsCount: 5,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dev/providers/Microsoft.ServiceBus/namespaces/sb-dev-premium",
        name: "sb-dev-premium",
        location: "eastus",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        skuName: "Premium",
        skuCapacity: 1,
        avgCapacityPercentage: 5,
        totalMessages: 500_000,
        totalMessagingSize: 50,
        costMtdUSD: 670.0,
        costPreviousPeriodUSD: 670.0,
        forecastEomUSD: 670.0,
        queuesCount: 2,
        topicsCount: 1,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dead/providers/Microsoft.ServiceBus/namespaces/sb-dead-orphan",
        name: "sb-dead-orphan",
        location: "westeurope",
        resourceGroup: "rg-dead",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        skuName: "Basic",
        skuCapacity: 1,
        avgCapacityPercentage: 0,
        totalMessages: 0,
        totalMessagingSize: 0,
        costMtdUSD: 0.0,
        costPreviousPeriodUSD: 0.0,
        forecastEomUSD: 0.0,
        queuesCount: 1,
        topicsCount: 0,
        isOrphan: true,
      },
    ];

    const summary = calculateServiceBusSummary(testItems);
    expect(summary.totalNamespaces).toBe(3);
    expect(summary.costMtdUSD).toBe(3350.0);
    expect(summary.totalQueues).toBe(13);
    expect(summary.totalTopics).toBe(6);

    const recommendations = generateServiceBusRecommendations(testItems);
    expect(recommendations.length).toBeGreaterThan(0);

    const unitsRightsizing = recommendations.find(
      (r) => r.category === "SKU_DOWNGRADE" && r.actionType === "REDUCE_UNITS"
    );
    expect(unitsRightsizing).toBeDefined();
    expect(unitsRightsizing?.estimatedSavingsUSD).toBe(1340.0); // (4 - 2) * 670

    const skuDowngrade = recommendations.find(
      (r) => r.category === "SKU_DOWNGRADE" && r.actionType === "SKU_DOWNGRADE"
    );
    expect(skuDowngrade).toBeDefined();
    expect(skuDowngrade?.estimatedSavingsUSD).toBe(660.0); // 670 - 10

    const orphanPurge = recommendations.find(
      (r) => r.category === "ORPHAN_PURGE"
    );
    expect(orphanPurge).toBeDefined();
  });

  it("should generate valid Azure CLI and PowerShell scripts for remediation", () => {
    const unitsAction: ServiceBusRemediationAction = {
      id: "rem-sb-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/sb-prod",
      resourceName: "sb-prod",
      title: "Rightsizing MUs",
      description: "Reducir unidades",
      category: "SKU_DOWNGRADE",
      estimatedSavingsUSD: 1340,
      confidence: "HIGH",
      actionType: "REDUCE_UNITS",
      currentCapacity: 4,
      recommendedCapacity: 2,
    };

    const unitsCmd = buildServiceBusRemediationCommand(unitsAction);
    expect(unitsCmd.cli).toContain("az servicebus namespace update");
    expect(unitsCmd.cli).toContain("--capacity 2");
    expect(unitsCmd.powershell).toContain("Set-AzServiceBusNamespace");
    expect(unitsCmd.powershell).toContain("-Capacity 2");

    const orphanAction: ServiceBusRemediationAction = {
      id: "rem-sb-2",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-dev/providers/Microsoft.ServiceBus/namespaces/sb-dead",
      resourceName: "sb-dead",
      title: "Purga de huérfanos",
      description: "Eliminar colas",
      category: "ORPHAN_PURGE",
      estimatedSavingsUSD: 0,
      confidence: "MEDIUM",
      actionType: "PURGE_ORPHANS",
    };

    const orphanCmd = buildServiceBusRemediationCommand(orphanAction);
    expect(orphanCmd.cli).toContain("az servicebus queue delete");
    expect(orphanCmd.powershell).toContain("Remove-AzServiceBusQueue");
  });
});

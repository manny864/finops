import { describe, it, expect } from "vitest";
import {
  generateMockEventGridData,
  calculateEventGridSummary,
  generateEventGridRecommendations,
  buildEventGridRemediationCommand,
} from "@/services/azureEventGrid.service";
import type { EventGridResourceItem, EventGridRemediationAction } from "@/types/azureEventGrid.types";

describe("Azure Event Grid FinOps Service", () => {
  it("should generate mock Event Grid data with valid structure and metrics", () => {
    const data = generateMockEventGridData();
    expect(data.source).toBe("mock");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.summary.totalDomains).toBeGreaterThan(0);
    expect(data.summary.costMtdUSD).toBeGreaterThan(0);
    expect(data.skuDistribution.length).toBeGreaterThan(0);
    expect(data.trendHistory.length).toBe(30);
    expect(data.remediationActions.length).toBeGreaterThan(0);
  });

  it("should correctly calculate summary and arbitrage opportunities", () => {
    const testItems: EventGridResourceItem[] = [
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.EventGrid/domains/eg-prod-domain",
        name: "eg-prod-domain",
        resourceType: "Domain",
        location: "eastus2",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        skuName: "Premium",
        publishedEvents: 5_000_000,
        deliveredEvents: 4_990_000,
        costMtdUSD: 400.0,
        costPreviousPeriodUSD: 400.0,
        forecastEomUSD: 400.0,
        topicsCount: 10,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.EventGrid/topics/eg-prod-topic",
        name: "eg-prod-topic",
        resourceType: "Topic",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod Sub",
        skuName: "Basic",
        publishedEvents: 50_000_000,
        deliveredEvents: 49_950_000,
        costMtdUSD: 30.0,
        costPreviousPeriodUSD: 28.0,
        forecastEomUSD: 32.0,
        topicsCount: 1,
        isOrphan: false,
      },
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-dead/providers/Microsoft.EventGrid/topics/eg-dead-orphan",
        name: "eg-dead-orphan",
        resourceType: "Topic",
        location: "westeurope",
        resourceGroup: "rg-dead",
        subscriptionId: "sub-1",
        subscriptionName: "Dev Sub",
        skuName: "Basic",
        publishedEvents: 0,
        deliveredEvents: 0,
        costMtdUSD: 0.0,
        costPreviousPeriodUSD: 0.0,
        forecastEomUSD: 0.0,
        topicsCount: 1,
        isOrphan: true,
      },
    ];

    const summary = calculateEventGridSummary(testItems);
    expect(summary.totalDomains).toBe(1);
    expect(summary.totalTopics).toBe(12);
    expect(summary.costMtdUSD).toBe(430.0);
    expect(summary.totalEventsMTD).toBe(55_000_000);

    const recommendations = generateEventGridRecommendations(testItems);
    expect(recommendations.length).toBeGreaterThan(0);

    const skuDowngrade = recommendations.find(
      (r) => r.category === "SKU_DOWNGRADE"
    );
    expect(skuDowngrade).toBeDefined();
    expect(skuDowngrade?.estimatedSavingsUSD).toBe(300.0); // 400 * 0.75

    const orphanPurge = recommendations.find(
      (r) => r.category === "ORPHAN_PURGE"
    );
    expect(orphanPurge).toBeDefined();
  });

  it("should generate valid Azure CLI and PowerShell scripts for remediation", () => {
    const downgradeAction: EventGridRemediationAction = {
      id: "rem-eg-1",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.EventGrid/domains/eg-domain",
      resourceName: "eg-domain",
      title: "Arbitraje SKU",
      description: "Downgrade a Basic",
      category: "SKU_DOWNGRADE",
      estimatedSavingsUSD: 300,
      confidence: "HIGH",
      actionType: "SKU_DOWNGRADE",
      currentSku: "Premium",
      recommendedSku: "Basic",
    };

    const downgradeCmd = buildEventGridRemediationCommand(downgradeAction);
    expect(downgradeCmd.cli).toContain("az eventgrid domain update");
    expect(downgradeCmd.cli).toContain("--sku Basic");
    expect(downgradeCmd.powershell).toContain("Update-AzEventGridDomain");

    const orphanAction: EventGridRemediationAction = {
      id: "rem-eg-2",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-dev/providers/Microsoft.EventGrid/topics/eg-dead",
      resourceName: "eg-dead",
      title: "Purga de huérfano",
      description: "Eliminar tema",
      category: "ORPHAN_PURGE",
      estimatedSavingsUSD: 0,
      confidence: "MEDIUM",
      actionType: "PURGE_ORPHANS",
    };

    const orphanCmd = buildEventGridRemediationCommand(orphanAction);
    expect(orphanCmd.cli).toContain("az eventgrid topic delete");
    expect(orphanCmd.powershell).toContain("Remove-AzEventGridTopic");
  });
});

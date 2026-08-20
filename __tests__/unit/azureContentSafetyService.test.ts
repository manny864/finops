import { describe, it, expect } from "vitest";
import {
  generateMockContentSafetyData,
  calculateContentSafetySummary,
  generateContentSafetyRecommendations,
  buildContentSafetyRemediationCommand,
} from "@/services/azureContentSafety.service";
import type { ContentSafetyResource } from "@/types/azureContentSafety.types";

describe("azureContentSafety.service", () => {
  it("generates deterministic mock payload with valid summary and resources", () => {
    const payload = generateMockContentSafetyData();

    expect(payload.source).toBe("mock");
    expect(payload.resources.length).toBeGreaterThanOrEqual(4);
    expect(payload.summary.totalCostUSD).toBeGreaterThan(0);
    expect(payload.summary.totalTextRecords).toBeGreaterThan(0);
    expect(payload.summary.breakdownByModality.length).toBeGreaterThan(0);
    expect(payload.dailyTrend.length).toBe(30);
    expect(payload.remediationActions.length).toBeGreaterThan(0);
  });

  it("calculates summary metrics and modality breakdown correctly", () => {
    const sampleResources: ContentSafetyResource[] = [
      {
        id: "/sub/1/cs1",
        name: "cs-prod",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        skuName: "S0",
        textRecordsCount: 500_000,
        imagesAnalyzedCount: 20_000,
        blocklistMatchesCount: 1000,
        blockedItemsCount: 450,
        totalCostUSD: 405.0,
        isDevOrTest: false,
        isOrphan: false,
      },
    ];

    const summary = calculateContentSafetySummary(sampleResources);
    expect(summary.totalCostUSD).toBe(405.0);
    expect(summary.totalTextRecords).toBe(500_000);
    expect(summary.totalImagesAnalyzed).toBe(20_000);
    expect(summary.totalBlockedItems).toBe(450);
    expect(summary.blockRatePercentage).toBeGreaterThan(0);
    expect(summary.breakdownByModality.length).toBeGreaterThanOrEqual(2);
  });

  it("identifies Hash Caching, Dev F0 Downgrade and Blocklist Optimization", () => {
    const sampleResources: ContentSafetyResource[] = [
      {
        id: "/sub/1/cs-heavy",
        name: "cs-heavy",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        skuName: "S0",
        textRecordsCount: 600_000,
        imagesAnalyzedCount: 0,
        blocklistMatchesCount: 6000,
        blockedItemsCount: 800,
        totalCostUSD: 450.0,
        isDevOrTest: false,
        isOrphan: false,
      },
      {
        id: "/sub/1/cs-dev",
        name: "cs-dev",
        location: "eastus",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-1",
        subscriptionName: "Dev",
        skuName: "S0",
        textRecordsCount: 800,
        imagesAnalyzedCount: 50,
        blocklistMatchesCount: 10,
        blockedItemsCount: 2,
        totalCostUSD: 50.0,
        isDevOrTest: true,
        isOrphan: false,
      },
    ];

    const recommendations = generateContentSafetyRecommendations(sampleResources);
    expect(recommendations.some((r) => r.category === "HASH_CACHING")).toBe(true);
    expect(recommendations.some((r) => r.category === "DEV_F0_DOWNGRADE")).toBe(true);
    expect(recommendations.some((r) => r.category === "BLOCKLIST_OPTIMIZATION")).toBe(true);

    const f0Action = recommendations.find((r) => r.category === "DEV_F0_DOWNGRADE");
    expect(f0Action).toBeDefined();
    const cmd = buildContentSafetyRemediationCommand(f0Action!);
    expect(cmd.cli).toContain("az cognitiveservices account update");
    expect(cmd.powershell).toContain("Update-AzCognitiveServicesAccount");
  });
});

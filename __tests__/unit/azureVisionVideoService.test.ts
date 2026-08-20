import { describe, it, expect } from "vitest";
import {
  generateMockVisionVideoData,
  calculateVisionVideoSummary,
  generateVisionVideoRecommendations,
  buildVisionRemediationCommand,
} from "@/services/azureVisionVideo.service";
import type { VisionVideoResource } from "@/types/azureVisionVideo.types";

describe("azureVisionVideo.service", () => {
  it("generates deterministic mock payload with valid summary and resources", () => {
    const payload = generateMockVisionVideoData();

    expect(payload.source).toBe("mock");
    expect(payload.resources.length).toBeGreaterThanOrEqual(5);
    expect(payload.summary.totalCostUSD).toBeGreaterThan(0);
    expect(payload.summary.totalImages).toBeGreaterThan(0);
    expect(payload.summary.totalVideoMinutes).toBeGreaterThan(0);
    expect(payload.summary.totalFaceCalls).toBeGreaterThan(0);
    expect(payload.summary.breakdownByService.length).toBeGreaterThan(0);
    expect(payload.dailyTrend.length).toBe(30);
    expect(payload.remediationActions.length).toBeGreaterThan(0);
  });

  it("calculates summary metrics and service breakdown correctly", () => {
    const sampleResources: VisionVideoResource[] = [
      {
        id: "/sub/1/cv1",
        name: "cv-prod",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        kind: "ComputerVision",
        skuName: "S0",
        imagesAnalyzed: 100_000,
        videoMinutesProcessed: 0,
        faceCallsCount: 0,
        trainingHours: 0,
        totalCostUSD: 250.0,
        isDevOrTest: false,
        isOrphan: false,
      },
      {
        id: "/sub/1/vi1",
        name: "vi-media",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        kind: "VideoIndexer",
        skuName: "S0",
        imagesAnalyzed: 0,
        videoMinutesProcessed: 1000,
        faceCallsCount: 0,
        trainingHours: 0,
        totalCostUSD: 150.0,
        isDevOrTest: false,
        isOrphan: false,
      },
    ];

    const summary = calculateVisionVideoSummary(sampleResources);
    expect(summary.totalCostUSD).toBe(400.0);
    expect(summary.totalImages).toBe(100_000);
    expect(summary.totalVideoMinutes).toBe(1000);
    expect(summary.breakdownByService.length).toBe(2);
    expect(summary.breakdownByService[0].serviceName).toBe("Computer Vision (OCR)");
    expect(summary.breakdownByService[0].costUSD).toBe(250.0);
    expect(summary.breakdownByService[0].percentage).toBe(62.5);
  });

  it("identifies Dev F0 Downgrade, Video Preset Optimization and Orphan Accounts", () => {
    const sampleResources: VisionVideoResource[] = [
      {
        id: "/sub/1/cv-dev",
        name: "cv-dev",
        location: "eastus",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-1",
        subscriptionName: "Dev",
        kind: "ComputerVision",
        skuName: "S0",
        imagesAnalyzed: 250,
        videoMinutesProcessed: 0,
        faceCallsCount: 0,
        trainingHours: 0,
        totalCostUSD: 85.0,
        isDevOrTest: true,
        isOrphan: false,
      },
      {
        id: "/sub/1/vi-prod",
        name: "vi-prod",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        kind: "VideoIndexer",
        skuName: "S0",
        imagesAnalyzed: 0,
        videoMinutesProcessed: 1200,
        faceCallsCount: 0,
        trainingHours: 0,
        totalCostUSD: 300.0,
        isDevOrTest: false,
        isOrphan: false,
      },
      {
        id: "/sub/1/cv-large",
        name: "cv-large",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        kind: "ComputerVision",
        skuName: "S0",
        imagesAnalyzed: 80_000,
        videoMinutesProcessed: 0,
        faceCallsCount: 0,
        trainingHours: 0,
        totalCostUSD: 200.0,
        isDevOrTest: false,
        isOrphan: false,
      },
      {
        id: "/sub/1/orphan-face",
        name: "face-unused",
        location: "eastus",
        resourceGroup: "rg-dev",
        subscriptionId: "sub-1",
        subscriptionName: "Dev",
        kind: "Face",
        skuName: "S0",
        imagesAnalyzed: 0,
        videoMinutesProcessed: 0,
        faceCallsCount: 10,
        trainingHours: 0,
        totalCostUSD: 30.0,
        isDevOrTest: true,
        isOrphan: true,
      },
    ];

    const recommendations = generateVisionVideoRecommendations(sampleResources);
    expect(recommendations.some((r) => r.category === "DEV_F0_DOWNGRADE")).toBe(true);
    expect(recommendations.some((r) => r.category === "VIDEO_PRESET_OPTIMIZE")).toBe(true);
    expect(recommendations.some((r) => r.category === "BATCH_PROCESSING")).toBe(true);
    expect(recommendations.some((r) => r.category === "ORPHAN_ACCOUNT")).toBe(true);

    const f0Action = recommendations.find((r) => r.category === "DEV_F0_DOWNGRADE");
    expect(f0Action).toBeDefined();
    const cmd = buildVisionRemediationCommand(f0Action!);
    expect(cmd.cli).toContain("az cognitiveservices account update");
    expect(cmd.powershell).toContain("Update-AzCognitiveServicesAccount");
  });
});

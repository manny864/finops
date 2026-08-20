import { describe, it, expect } from "vitest";
import {
  generateMockAmlData,
  calculateAmlSummary,
  generateAmlRecommendations,
  buildAmlRemediationCommand,
} from "@/services/azureMachineLearning.service";
import type { AmlComputeResource } from "@/types/azureMachineLearning.types";

describe("azureMachineLearning.service", () => {
  it("generates deterministic mock payload with valid summary and resources", () => {
    const payload = generateMockAmlData();

    expect(payload.source).toBe("mock");
    expect(payload.resources.length).toBeGreaterThanOrEqual(4);
    expect(payload.summary.totalMonthlyCostUSD).toBeGreaterThan(0);
    expect(payload.summary.computeInstancesCount).toBeGreaterThan(0);
    expect(payload.summary.breakdownByComputeType.length).toBeGreaterThan(0);
    expect(payload.dailyTrend.length).toBe(30);
    expect(payload.remediationActions.length).toBeGreaterThan(0);
  });

  it("calculates summary metrics and breakdown by compute type correctly", () => {
    const sampleResources: AmlComputeResource[] = [
      {
        id: "/sub/1/ci1",
        name: "ci-test",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        computeType: "ComputeInstance",
        vmSize: "Standard_DS3_v2",
        state: "Running",
        minNodes: 1,
        maxNodes: 1,
        currentNodes: 1,
        hasAutoShutdownSchedule: false,
        avgCpuPercentage: 10,
        monthlyCostUSD: 160.0,
        isWasteful: true,
      },
      {
        id: "/sub/1/cluster1",
        name: "cluster-gpu",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        computeType: "AmlComputeCluster",
        vmSize: "Standard_NC6s_v3",
        state: "Idle",
        minNodes: 2,
        maxNodes: 6,
        currentNodes: 2,
        hasAutoShutdownSchedule: false,
        avgCpuPercentage: 0,
        monthlyCostUSD: 1200.0,
        isWasteful: true,
      },
    ];

    const summary = calculateAmlSummary(sampleResources);
    expect(summary.totalMonthlyCostUSD).toBe(1360.0);
    expect(summary.computeInstancesCount).toBe(1);
    expect(summary.activeTrainingClustersCount).toBe(1);
    expect(summary.idleNodesCount).toBe(2);
    expect(summary.breakdownByComputeType.length).toBe(2);
  });

  it("identifies Auto-Shutdown, Scale to Zero, Spot Training and Idle Endpoints", () => {
    const sampleResources: AmlComputeResource[] = [
      {
        id: "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.MachineLearningServices/workspaces/ws1/computes/ci-unscheduled",
        name: "ci-unscheduled",
        location: "eastus",
        resourceGroup: "rg1",
        subscriptionId: "s1",
        subscriptionName: "Prod",
        computeType: "ComputeInstance",
        vmSize: "Standard_DS3_v2",
        state: "Running",
        minNodes: 1,
        maxNodes: 1,
        currentNodes: 1,
        hasAutoShutdownSchedule: false,
        avgCpuPercentage: 8,
        monthlyCostUSD: 150.0,
        isWasteful: true,
      },
      {
        id: "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.MachineLearningServices/workspaces/ws1/computes/cluster-fixed",
        name: "cluster-fixed",
        location: "eastus",
        resourceGroup: "rg1",
        subscriptionId: "s1",
        subscriptionName: "Prod",
        computeType: "AmlComputeCluster",
        vmSize: "Standard_NC6s_v3",
        state: "Idle",
        minNodes: 2,
        maxNodes: 8,
        currentNodes: 2,
        hasAutoShutdownSchedule: false,
        avgCpuPercentage: 0,
        monthlyCostUSD: 1500.0,
        isWasteful: true,
      },
      {
        id: "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.MachineLearningServices/workspaces/ws1/onlineEndpoints/endpoint-idle",
        name: "endpoint-idle",
        location: "eastus",
        resourceGroup: "rg1",
        subscriptionId: "s1",
        subscriptionName: "Prod",
        computeType: "OnlineEndpoint",
        vmSize: "Standard_F4s_v2",
        state: "Running",
        minNodes: 2,
        maxNodes: 4,
        currentNodes: 2,
        hasAutoShutdownSchedule: false,
        avgCpuPercentage: 3,
        monthlyCostUSD: 300.0,
        isWasteful: true,
      },
    ];

    const recommendations = generateAmlRecommendations(sampleResources);
    expect(recommendations.some((r) => r.category === "AUTO_SHUTDOWN_CI")).toBe(true);
    expect(recommendations.some((r) => r.category === "SCALE_TO_ZERO_CLUSTER")).toBe(true);
    expect(recommendations.some((r) => r.category === "SPOT_TRAINING")).toBe(true);
    expect(recommendations.some((r) => r.category === "IDLE_ENDPOINT")).toBe(true);

    const autoShutdownAction = recommendations.find((r) => r.category === "AUTO_SHUTDOWN_CI");
    expect(autoShutdownAction).toBeDefined();
    const cmd = buildAmlRemediationCommand(autoShutdownAction!);
    expect(cmd.cli).toContain("az ml compute update");
  });
});

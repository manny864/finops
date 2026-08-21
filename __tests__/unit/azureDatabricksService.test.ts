import { describe, it, expect } from "vitest";
import {
  generateMockDatabricksData,
  calculateDatabricksSummary,
  generateDatabricksRecommendations,
  buildDatabricksRemediationCommand,
} from "@/services/azureDatabricks.service";
import type {
  DatabricksWorkspaceResource,
  DatabricksClusterItem,
} from "@/types/azureDatabricks.types";

describe("azureDatabricks.service", () => {
  it("generates deterministic mock payload with valid summary, workspaces and clusters", () => {
    const payload = generateMockDatabricksData();

    expect(payload.source).toBe("mock");
    expect(payload.workspaces.length).toBeGreaterThanOrEqual(2);
    expect(payload.clusters.length).toBeGreaterThanOrEqual(3);
    expect(payload.summary.totalCostUSD).toBeGreaterThan(0);
    expect(payload.summary.totalDbus).toBeGreaterThan(0);
    expect(payload.summary.breakdownByComponent.length).toBe(4);
    expect(payload.dailyTrend.length).toBe(30);
    expect(payload.remediationActions.length).toBeGreaterThan(0);
  });

  it("calculates summary metrics and tripartite component breakdown correctly", () => {
    const sampleWorkspaces: DatabricksWorkspaceResource[] = [
      {
        id: "/sub/1/ws1",
        name: "dbx-prod",
        location: "eastus",
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        subscriptionName: "Prod",
        skuTier: "Premium",
        managedResourceGroupId: "/sub/1/managed-rg",
        totalDbuConsumed: 2000,
        dbuCostUSD: 800.0,
        vmComputeCostUSD: 500.0,
        storageCostUSD: 100.0,
        totalMonthlyCostUSD: 1400.0,
        allPurposePercentage: 40,
        jobsPercentage: 60,
        activeClustersCount: 2,
        isOrphan: false,
      },
    ];

    const sampleClusters: DatabricksClusterItem[] = [
      {
        clusterId: "c-1",
        clusterName: "etl-pipeline",
        workspaceId: "/sub/1/ws1",
        workspaceName: "dbx-prod",
        resourceGroup: "rg-prod",
        subscriptionName: "Prod",
        computeType: "Job",
        nodeType: "Standard_D8s_v5",
        driverNodeType: "Standard_D8s_v5",
        minWorkers: 2,
        maxWorkers: 4,
        autoterminationMinutes: 20,
        state: "Running",
        dbuRatePerHour: 2.0,
        monthlyCostUSD: 600.0,
        isInefficient: false,
      },
    ];

    const summary = calculateDatabricksSummary(sampleWorkspaces, sampleClusters);
    expect(summary.totalCostUSD).toBe(1400.0);
    expect(summary.totalDbus).toBe(2000);
    expect(summary.dbuSpendUSD).toBe(800.0);
    expect(summary.azureComputeSpendUSD).toBe(500.0);
    expect(summary.jobsEfficiencyRatio).toBe(60);
    expect(summary.breakdownByComponent.length).toBe(4);
  });

  it("identifies Migrate to Jobs, Auto-Termination, and Single-Node Dev recommendations", () => {
    const sampleWorkspaces: DatabricksWorkspaceResource[] = [];
    const sampleClusters: DatabricksClusterItem[] = [
      {
        clusterId: "c-prod-pipeline",
        clusterName: "prod-etl-pipeline",
        workspaceId: "/ws/1",
        workspaceName: "dbx-prod",
        resourceGroup: "rg-prod",
        subscriptionName: "Prod",
        computeType: "AllPurpose",
        nodeType: "Standard_D8s_v5",
        driverNodeType: "Standard_D8s_v5",
        minWorkers: 2,
        maxWorkers: 6,
        autoterminationMinutes: 120,
        state: "Running",
        dbuRatePerHour: 3.5,
        monthlyCostUSD: 700.0,
        isInefficient: true,
      },
      {
        clusterId: "c-dev",
        clusterName: "dev-interactive-cluster",
        workspaceId: "/ws/2",
        workspaceName: "dbx-dev",
        resourceGroup: "rg-dev",
        subscriptionName: "Dev",
        computeType: "AllPurpose",
        nodeType: "Standard_D4s_v5",
        driverNodeType: "Standard_D4s_v5",
        minWorkers: 2,
        maxWorkers: 2,
        autoterminationMinutes: 0,
        state: "Running",
        dbuRatePerHour: 1.5,
        monthlyCostUSD: 300.0,
        isInefficient: true,
      },
    ];

    const recommendations = generateDatabricksRecommendations(sampleWorkspaces, sampleClusters);
    expect(recommendations.some((r) => r.category === "MIGRATE_TO_JOBS")).toBe(true);
    expect(recommendations.some((r) => r.category === "REDUCE_AUTOTERMINATION")).toBe(true);
    expect(recommendations.some((r) => r.category === "SINGLE_NODE_DEV")).toBe(true);

    const migrateAction = recommendations.find((r) => r.category === "MIGRATE_TO_JOBS");
    expect(migrateAction).toBeDefined();
    const cmd = buildDatabricksRemediationCommand(migrateAction!);
    expect(cmd.cli).toContain("databricks jobs create");
  });
});

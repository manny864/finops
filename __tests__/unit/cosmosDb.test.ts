import { describe, it, expect } from "vitest";
import {
  CosmosDbAccountDetail,
  CosmosRemediationAction,
  CosmosArchitectureType,
} from "@/types/cosmosDb";

describe("Cosmos DB FinOps Types & Logic", () => {
  it("should define valid NoSQL autoscale model", () => {
    const account: CosmosDbAccountDetail = {
      id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.DocumentDB/databaseAccounts/cosmos-orders",
      name: "cosmos-orders",
      type: "Microsoft.DocumentDB/databaseAccounts",
      kind: "GlobalDocumentDB",
      apiLabel: "Azure Cosmos DB for NoSQL",
      resourceGroup: "rg-prod",
      subscriptionId: "sub-1",
      subscriptionName: "Producción Cloud",
      region: "eastus",
      state: "healthy",
      architecture: "ru-based",
      throughputProfile: {
        mode: "autoscale",
        totalProvisionedRu: 10000,
        maxAutoscaleRu: 10000,
        regionsCount: 2,
        regionsList: [
          { name: "eastus", isZoneRedundant: true, isWriteRegion: true },
          { name: "westus", isZoneRedundant: false, isWriteRegion: false },
        ],
        isMultiRegionWrite: false,
        freeTierEnabled: false,
        dedicatedGatewayEnabled: true,
        analyticalStoreEnabled: false,
      },
      metrics: {
        avgNormalizedRuPct: 45.0,
        p95NormalizedRuPct: 70.0,
        throttling429Rate: 0.01,
        totalRequests: 1000000,
        throttledRequests: 100,
        serverLatencyMs: 4.5,
      },
      storage: {
        dataUsageGb: 100,
        indexUsageGb: 25,
        analyticalStorageGb: 0,
        indexRatio: 0.25,
      },
      cost: {
        throughputMonthlyUsd: 365,
        storageMonthlyUsd: 25,
        regionsMultiplier: 2,
        dedicatedGatewayMonthlyUsd: 50.4,
        analyticalStoreMonthlyUsd: 0,
        totalMonthlyCostUsd: 780.4,
        efficiencyRatio: 78.04,
      },
      recommendations: [],
    };

    expect(account.architecture).toBe("ru-based");
    expect(account.throughputProfile.mode).toBe("autoscale");
    expect(account.throughputProfile.regionsCount).toBe(2);
    expect(account.storage.indexRatio).toBeLessThanOrEqual(0.5);
  });

  it("should define valid MongoDB vCore cluster model", () => {
    const vCoreAccount: CosmosDbAccountDetail = {
      id: "/subscriptions/sub-1/resourceGroups/rg-crm/providers/Microsoft.DocumentDB/mongoClusters/mongovcore-crm",
      name: "mongovcore-crm",
      type: "Microsoft.DocumentDB/mongoClusters",
      kind: "MongoCluster",
      apiLabel: "Cosmos DB for MongoDB (vCore)",
      resourceGroup: "rg-crm",
      subscriptionId: "sub-1",
      subscriptionName: "Producción Cloud",
      region: "eastus2",
      state: "healthy",
      architecture: "vcore-based",
      throughputProfile: {
        mode: "vcore",
        vCores: 8,
        ramGb: 32,
        storageSizeGb: 512,
        highAvailability: "Enabled",
        regionsCount: 1,
        regionsList: [{ name: "eastus2", isZoneRedundant: true, isWriteRegion: true }],
        isMultiRegionWrite: false,
        freeTierEnabled: false,
        dedicatedGatewayEnabled: false,
        analyticalStoreEnabled: false,
      },
      metrics: {
        avgNormalizedRuPct: 0,
        p95NormalizedRuPct: 0,
        throttling429Rate: 0,
        totalRequests: 500000,
        throttledRequests: 0,
        serverLatencyMs: 3.0,
        cpuPercent: 12.5,
        memoryPercent: 40.0,
        diskPercent: 30.0,
      },
      storage: {
        dataUsageGb: 200,
        indexUsageGb: 40,
        analyticalStorageGb: 0,
        indexRatio: 0.2,
      },
      cost: {
        throughputMonthlyUsd: 0,
        storageMonthlyUsd: 60,
        regionsMultiplier: 1,
        dedicatedGatewayMonthlyUsd: 0,
        analyticalStoreMonthlyUsd: 0,
        totalMonthlyCostUsd: 620,
        efficiencyRatio: 62.0,
      },
      recommendations: [],
    };

    expect(vCoreAccount.architecture).toBe("vcore-based");
    expect(vCoreAccount.throughputProfile.vCores).toBe(8);
    expect(vCoreAccount.metrics.cpuPercent).toBe(12.5);
  });
});

import { describe, it, expect } from "vitest";
import {
  RedisCacheDetail,
  RedisSkuProfile,
  RedisPerformanceMetrics,
} from "@/types/redisCache";

describe("Azure Cache for Redis FinOps Types & Rules", () => {
  it("should correctly represent an Enterprise Redis instance", () => {
    const instance: RedisCacheDetail = {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cscs-finops-prod-westus2-rg/providers/Microsoft.Cache/redisEnterprise/cscs-finops-prod-westus2-redis",
      name: "cscs-finops-prod-westus2-redis",
      type: "Microsoft.Cache/redisEnterprise",
      resourceGroup: "cscs-finops-prod-westus2-rg",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "CSCS-LandingZone",
      region: "westus2",
      state: "healthy",
      skuProfile: {
        name: "Enterprise Balanced_B3",
        family: "Enterprise",
        capacity: 1,
        nominalMemoryMb: 1024,
        nominalMemoryGb: 1.0,
        isEnterprise: true,
        version: "7.2 (Enterprise)",
        enableNonSslPort: false,
        maxMemoryPolicy: "volatile-lru",
        modules: ["RediSearch", "RedisJSON"],
      },
      metrics: {
        serverLoadAvgPct: 2.4,
        serverLoadMaxPct: 8.1,
        cpuPercentAvg: 2.4,
        usedMemoryBytes: 64826880,
        usedMemoryMb: 61.82,
        usedMemoryGb: 0.06,
        usedMemoryRatioPct: 6.04,
        cacheHits: 450,
        cacheMisses: 1650,
        hitRatePercentage: 21.43,
        missRatePercentage: 78.57,
        connectedClients: 8,
        operationsPerSecond: 45,
        evictedKeys: 0,
        expiredKeys: 120,
        memoryFragmentationRatio: 1.12,
        persistenceMode: "Disabled",
      },
      cost: {
        monthlyCostUsd: 8.58,
        nominalMemoryCostPerGb: 8.58,
        effectiveMemoryCostPerGb: 143.0,
        savingsMonthlyUsd: 1.54,
      },
      recommendations: [
        {
          id: "rec-1",
          ruleKey: "inefficient_hit_rate",
          title: "Optimización de Cache Hit Rate Ineficiente",
          description: "Hit rate de 21.43% indica misses constantes.",
          savingsMonthlyUsd: 1.54,
          risk: "low",
          confidence: "medium",
          actionType: "guided",
        },
      ],
    };

    expect(instance.skuProfile.isEnterprise).toBe(true);
    expect(instance.metrics.hitRatePercentage).toBe(21.43);
    expect(instance.metrics.memoryFragmentationRatio).toBe(1.12);
    expect(instance.recommendations).toHaveLength(1);
  });

  it("should compute accurate hit rate percentage", () => {
    const hits = 450;
    const misses = 1650;
    const total = hits + misses;
    const hitRate = (hits / total) * 100;
    const missRate = (misses / total) * 100;

    expect(Number(hitRate.toFixed(2))).toBe(21.43);
    expect(Number(missRate.toFixed(2))).toBe(78.57);
    expect(hitRate + missRate).toBe(100);
  });

  it("should estimate monthly cost for Enterprise, Premium, Standard and Basic tiers", async () => {
    const { estimateRedisMonthlyCost } = await import(
      "@/app/api/intelligence/databases/redis-metrics/route"
    );

    // Enterprise Balanced_B3
    expect(estimateRedisMonthlyCost("Balanced_B3", "Enterprise", 1, true)).toBe(292.0);
    // Premium P1
    expect(estimateRedisMonthlyCost("Premium_P1", "Premium", 1, false)).toBe(438.0);
    // Standard C1
    expect(estimateRedisMonthlyCost("Standard_C1", "Standard", 1, false)).toBe(80.3);
    // Basic C1
    expect(estimateRedisMonthlyCost("Basic_C1", "Basic", 1, false)).toBe(40.15);
  });
});

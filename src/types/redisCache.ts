export type RedisTierFamily = "Basic" | "Standard" | "Premium" | "Enterprise" | "EnterpriseFlash";

export interface RedisSkuProfile {
  name: string; // e.g. "Basic_C0", "Standard_C1", "Premium_P1", "Enterprise_Balanced_B3"
  family: string; // C, P, Balanced, Compute, Memory, Flash
  capacity: number; // 0, 1, 2, 3...
  nominalMemoryMb: number; // Nominal RAM in MB
  nominalMemoryGb: number;
  isEnterprise: boolean;
  version?: string;
  enableNonSslPort: boolean;
  maxMemoryPolicy?: string;
  modules?: string[]; // RediSearch, RedisJSON, RedisBloom, etc.
}

export interface RedisPerformanceMetrics {
  serverLoadAvgPct: number;
  serverLoadMaxPct: number;
  cpuPercentAvg?: number;
  usedMemoryBytes: number;
  usedMemoryMb: number;
  usedMemoryGb: number;
  usedMemoryRatioPct: number; // (used / nominal) * 100
  cacheHits: number;
  cacheMisses: number;
  hitRatePercentage: number; // (hits / (hits + misses)) * 100
  missRatePercentage: number;
  connectedClients: number;
  operationsPerSecond: number;
  evictedKeys: number;
  expiredKeys: number;
  memoryFragmentationRatio: number; // memory_fragmentation_ratio
  persistenceMode: "Disabled" | "RDB" | "AOF";
}

export interface RedisCostBreakdown {
  monthlyCostUsd: number;
  nominalMemoryCostPerGb: number; // Cost / nominal GB
  effectiveMemoryCostPerGb: number; // Cost / used GB
  savingsMonthlyUsd: number;
}

export interface RedisRemediationAction {
  id: string;
  ruleKey:
    | "staging_overkill_rightsizing"
    | "idle_zombie_instance"
    | "inefficient_hit_rate"
    | "reserved_capacity_coverage";
  title: string;
  description: string;
  savingsMonthlyUsd: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
  cliCommand?: string;
  bicepSnippet?: string;
}

export interface RedisCacheDetail {
  id: string;
  name: string;
  type: "Microsoft.Cache/Redis" | "Microsoft.Cache/redisEnterprise";
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  region: string;
  state: "healthy" | "warning" | "critical";
  skuProfile: RedisSkuProfile;
  metrics: RedisPerformanceMetrics;
  cost: RedisCostBreakdown;
  recommendations: RedisRemediationAction[];
  hostName?: string;
  sslPort?: number;
  tags?: Record<string, string>;
}

export interface RedisFinopsSummaryResponse {
  instances: RedisCacheDetail[];
  financialSummary: {
    mtdCost: number;
    forecastEom: { value: number; low: number; high: number };
    deltaMoM: { value: number; percentage: number };
    potentialSavings: number;
  };
  efficiency: {
    nominalCostPerGb: number;
    effectiveCostPerGb: number;
    costPerKOps: number;
    underutilizedCount: number;
  };
  risk: {
    healthScore: number;
    criticalAlerts: number;
    idleInstancesCount: number;
    lowHitRateCount: number;
  };
  recommendations: RedisRemediationAction[];
}

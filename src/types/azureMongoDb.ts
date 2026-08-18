// -----------------------------------------------------------------------
// Azure Cosmos DB for MongoDB — FinOps Type Definitions
// Architectures: vCore Cluster vs. RU-based (Request Units)
// -----------------------------------------------------------------------

export type MongoArchitectureType = "vCore" | "RequestUnits";

export type MongoVCoreHaMode = "Disabled" | "SameZone" | "ZoneRedundant";

export type MongoRuThroughputMode = "Manual" | "Autoscale" | "Serverless";

export type MongoServerState = "Ready" | "Updating" | "Dropping" | "Stopped" | "healthy" | "warning" | "critical";

export interface MongoVCoreProfile {
  skuName: string; // e.g. "M25", "M30", "M40", "M50", "M60", "M80"
  vCores: number;
  memoryGib: number;
  diskSizeGb: number;
  iops: number;
  nodeCount: number;
  haMode: MongoVCoreHaMode;
  haNodes: number;
  version: string;
}

export interface MongoRuProfile {
  throughputMode: MongoRuThroughputMode;
  provisionedRu: number;
  maxAutoscaleRu?: number;
  regions: string[];
  regionsCount: number;
  enableFreeTier: boolean;
  dataUsageGb: number;
  indexUsageGb: number;
  version: string;
}

export interface MongoVCoreMetrics {
  cpuPercentAvg: number;
  cpuPercentMax: number;
  memoryPercentAvg: number;
  diskSpacePercent: number;
  iopsConsumedAvg: number;
}

export interface MongoRuMetrics {
  normalizedRuPercentAvg: number;
  normalizedRuPercentMax: number;
  throttling429Count: number;
  dataUsageGb: number;
  indexUsageGb: number;
  requestCount: number;
  serverLatencyMs: number;
}

export interface MongoPerformanceMetrics {
  vCoreMetrics?: MongoVCoreMetrics;
  ruMetrics?: MongoRuMetrics;
}

export interface MongoCostBreakdown {
  monthlyCostUsd: number;
  computeCostUsd: number;
  storageCostUsd: number;
  haCostUsd: number;
  throughputCostUsd: number;
  potentialSavingsUsd: number;
}

export type MongoRemediationRuleKey =
  | "vcore_downsize"
  | "vcore_ha_dev_test"
  | "ru_manual_to_autoscale_serverless"
  | "reserved_capacity"
  | "storage_index_optimization";

export interface MongoRemediationAction {
  id: string;
  ruleKey: MongoRemediationRuleKey;
  title: string;
  description: string;
  savingsMonthlyUsd: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
  cliCommand?: string;
  bicepSnippet?: string;
}

export interface MongoDbResourceDetail {
  id: string;
  name: string;
  architecture: MongoArchitectureType;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  region: string;
  state: MongoServerState;
  version: string;
  vcoreProfile?: MongoVCoreProfile;
  ruProfile?: MongoRuProfile;
  metrics: MongoPerformanceMetrics;
  cost: MongoCostBreakdown;
  recommendations: MongoRemediationAction[];
  fqdn?: string;
  tags?: Record<string, string>;
}

export interface MongoDbFinopsSummaryResponse {
  success: boolean;
  instances: MongoDbResourceDetail[];
  financialSummary: {
    mtdCost: number;
    forecastEom: {
      value: number;
      low: number;
      high: number;
    };
    deltaMoM: {
      value: number;
      percentage: number;
    };
    potentialSavings: number;
  };
  efficiency: {
    vCoreInstancesCount: number;
    ruInstancesCount: number;
    costPerVcoreOrKOps: number;
    underutilizedCount: number;
    haOverprovisionedCount: number;
    manualRuCandidateCount: number;
    riEligibleCount: number;
  };
  risk: {
    healthScore: number;
    criticalAlerts: number;
    throttling429InstancesCount: number;
    highCpuPressureCount: number;
  };
  recommendations: MongoRemediationAction[];
  lastUpdatedAt: string;
  isDemoMode: boolean;
}

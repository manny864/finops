export type CosmosArchitectureType = "ru-based" | "vcore-based";

export type CosmosApiKind =
  | "GlobalDocumentDB" // NoSQL
  | "MongoDB"
  | "Cassandra"
  | "Gremlin"
  | "Table"
  | "MongoCluster"; // MongoDB vCore

export type CosmosThroughputMode = "manual" | "autoscale" | "serverless" | "vcore";

export interface CosmosStorageBreakdown {
  dataUsageGb: number;
  indexUsageGb: number;
  analyticalStorageGb: number;
  indexRatio: number; // index / data
}

export interface CosmosPerformanceMetrics {
  avgNormalizedRuPct: number;
  p95NormalizedRuPct: number;
  throttling429Rate: number; // Percentage of 429 requests
  totalRequests: number;
  throttledRequests: number;
  serverLatencyMs: number;
  // vCore metrics
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
}

export interface CosmosThroughputProfile {
  mode: CosmosThroughputMode;
  totalProvisionedRu?: number;
  maxAutoscaleRu?: number;
  // vCore Profile
  vCores?: number;
  ramGb?: number;
  storageSizeGb?: number;
  highAvailability?: "Enabled" | "Disabled";
  // Topology
  regionsCount: number;
  regionsList: Array<{ name: string; isZoneRedundant: boolean; isWriteRegion: boolean }>;
  isMultiRegionWrite: boolean;
  freeTierEnabled: boolean;
  dedicatedGatewayEnabled: boolean;
  analyticalStoreEnabled: boolean;
}

export interface CosmosCostBreakdown {
  throughputMonthlyUsd: number;
  storageMonthlyUsd: number;
  regionsMultiplier: number;
  dedicatedGatewayMonthlyUsd: number;
  analyticalStoreMonthlyUsd: number;
  totalMonthlyCostUsd: number;
  efficiencyRatio: number; // $/1k RU or $/GB
}

export interface CosmosRemediationAction {
  id: string;
  ruleKey:
    | "manual_overprovisioned"
    | "free_tier_activation"
    | "multi_region_dev"
    | "reserved_capacity"
    | "index_overhead"
    | "vcore_rightsizing";
  title: string;
  description: string;
  savingsMonthlyUsd: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
  cliCommand?: string;
  bicepSnippet?: string;
}

export interface CosmosDbAccountDetail {
  id: string;
  name: string;
  type: string;
  kind: CosmosApiKind;
  apiLabel: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  region: string;
  state: "healthy" | "warning" | "critical";
  architecture: CosmosArchitectureType;
  throughputProfile: CosmosThroughputProfile;
  metrics: CosmosPerformanceMetrics;
  storage: CosmosStorageBreakdown;
  cost: CosmosCostBreakdown;
  recommendations: CosmosRemediationAction[];
  endpoints?: {
    documentEndpoint?: string;
    connectionStringHint?: string;
  };
  tags?: Record<string, string>;
}

export interface CosmosFinopsSummaryResponse {
  instances: CosmosDbAccountDetail[];
  financialSummary: {
    mtdCost: number;
    forecastEom: { value: number; low: number; high: number };
    deltaMoM: { value: number; percentage: number };
    potentialSavings: number;
  };
  efficiency: {
    costPerUsedGb: number;
    costPerKOps: number;
    avgCostPer1kRu: number;
    underutilizedCount: number;
  };
  risk: {
    healthScore: number;
    criticalAlerts: number;
    throttledInstancesCount: number;
  };
  recommendations: CosmosRemediationAction[];
}

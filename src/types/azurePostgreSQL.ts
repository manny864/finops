// -----------------------------------------------------------------------
// Azure Database for PostgreSQL — FinOps Type Definitions
// Architecture: Flexible Server, Single Server (Legacy), Cosmos DB (Citus)
// -----------------------------------------------------------------------

export type PostgreSqlServerType = "FlexibleServer" | "SingleServer" | "CosmosDbCitus";

export type PostgreSqlSkuTier = "Burstable" | "GeneralPurpose" | "MemoryOptimized";

export type PostgreSqlHaMode = "Disabled" | "SameZone" | "ZoneRedundant";

export type PostgreSqlState = "Ready" | "Stopped" | "Dropping" | "Disabled" | "healthy" | "warning" | "critical";

export interface PostgreSqlSkuProfile {
  /** e.g. "Standard_D4ds_v5", "Standard_B2s", "Standard_E8ds_v5" */
  name: string;
  tier: PostgreSqlSkuTier;
  vCores: number;
  memoryGib: number;
  version: string;
  haMode: PostgreSqlHaMode;
  haReplicas: number;
  readReplicas: number;
  backupRetentionDays: number;
  geoRedundantBackup: boolean;
}

export interface PostgreSqlStorageProfile {
  storageSizeGb: number;
  usedStorageGb: number;
  storageUtilizationPct: number;
  autoGrow: boolean;
  autoIoScaling: boolean; // Autoscale IOPS vs Provisioned
  iops: number;
  isOverallocated: boolean;
}

export interface PostgreSqlPerformanceMetrics {
  cpuPercentAvg: number;
  cpuPercentMax: number;
  memoryPercentAvg: number;
  storageUsedGib: number;
  storageUsedPct: number;
  activeConnectionsAvg: number;
  activeConnectionsMax: number;
  ioConsumptionPct: number;
  diskIopsConsumedAvg: number;
  failedConnections: number;
}

export interface PostgreSqlCostBreakdown {
  monthlyCostUsd: number;
  computeCostUsd: number;
  storageCostUsd: number;
  haCostUsd: number;
  backupCostUsd: number;
  potentialSavingsUsd: number;
}

export type PostgreSqlRemediationRuleKey =
  | "downsize_sku"
  | "storage_overallocated"
  | "ha_disabled_dev_test"
  | "auto_stop_schedule"
  | "single_server_migration"
  | "autoscale_iops_optimization";

export interface PostgreSqlRemediationAction {
  id: string;
  ruleKey: PostgreSqlRemediationRuleKey;
  title: string;
  description: string;
  savingsMonthlyUsd: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
  cliCommand?: string;
  bicepSnippet?: string;
}

export interface AzurePostgreSqlResourceDetail {
  id: string;
  name: string;
  serverType: PostgreSqlServerType;
  isLegacySingleServer: boolean;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  region: string;
  state: PostgreSqlState;
  version: string;
  skuProfile: PostgreSqlSkuProfile;
  storageProfile: PostgreSqlStorageProfile;
  metrics: PostgreSqlPerformanceMetrics;
  cost: PostgreSqlCostBreakdown;
  recommendations: PostgreSqlRemediationAction[];
  fqdn?: string;
  tags?: Record<string, string>;
}

export interface PostgreSqlFinopsSummaryResponse {
  success: boolean;
  instances: AzurePostgreSqlResourceDetail[];
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
    costPerEffectiveVcore: number;
    costPerManagedGb: number;
    underutilizedCount: number;
    legacySingleServerCount: number;
    haOverprovisionedCount: number;
    autoscaleIopsCandidatesCount: number;
    autoStopCandidatesCount: number;
  };
  risk: {
    healthScore: number;
    criticalAlerts: number;
    highConnectionPressureCount: number;
    highCpuPressureCount: number;
  };
  recommendations: PostgreSqlRemediationAction[];
  lastUpdatedAt: string;
  isDemoMode: boolean;
}

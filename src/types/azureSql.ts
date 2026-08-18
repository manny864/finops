export type SqlArchitectureType = "single-database" | "elastic-pool" | "managed-instance";

export type SqlPurchasingModelType = "dtu" | "vcore-provisioned" | "vcore-serverless";

export interface SqlPurchasingModel {
  type: SqlPurchasingModelType;
  tier: string; // e.g. "General Purpose", "Business Critical", "Standard", "Basic", "Hyperscale"
  skuName: string; // e.g. "GP_Gen5_2", "GP_S_Gen5_4", "Standard S2", "Basic", "BC_Gen5_8"
  capacity: number; // DTUs (e.g. 50) or vCores (e.g. 2, 4)
  family?: string; // e.g. "Gen5"
  minVcores?: number; // Serverless min
  maxVcores?: number; // Serverless max
  autoPauseDelayMinutes?: number | null; // e.g. 60 min, or null if disabled
  isServerless: boolean;
}

export interface SqlStorageProfile {
  usedStorageGb: number;
  allocatedStorageGb: number;
  maxStorageGb: number;
  storageUtilizationPct: number;
  redundancy: "LRS" | "ZRS" | "GRS" | "RA-GRS" | string;
  isOverallocated: boolean;
}

export interface SqlLicenseProfile {
  licenseType: "BasePrice" | "LicenseIncluded" | string;
  hasHybridBenefit: boolean;
  ahubEligible: boolean;
  estimatedAhubSavingsUsd: number;
}

export interface SqlPerformanceMetrics {
  avgCpuPercent: number;
  maxCpuPercent: number;
  avgDtuPercent?: number;
  maxDtuPercent?: number;
  logWritePercent: number;
  dataIoPercent: number;
  activeSessions: number;
  maxSessionsLimit: number;
  sessionsPercent: number;
  activeWorkers: number;
  workersPercent: number;
  failedConnections: number;
  serverlessAutoPausedHoursPerMonth?: number;
}

export interface SqlCostProfile {
  monthlyCostUsd: number;
  computeCostUsd: number;
  storageCostUsd: number;
  licensingCostUsd: number;
  potentialSavingsUsd: number;
}

export type SqlRemediationRuleKey =
  | "serverless_migration"
  | "elastic_pool_consolidation"
  | "ahub_activation"
  | "storage_trim"
  | "reserved_capacity";

export interface SqlRemediationAction {
  id: string;
  ruleKey: SqlRemediationRuleKey;
  title: string;
  description: string;
  savingsMonthlyUsd: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
  cliCommand?: string;
  bicepSnippet?: string;
}

export interface AzureSqlResourceDetail {
  id: string;
  name: string;
  type: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  region: string;
  serverName: string;
  state: "online" | "paused" | "disabled" | "creating" | string;
  architecture: SqlArchitectureType;
  isSystemDatabase: boolean; // e.g. "master"
  elasticPoolName?: string | null;
  elasticPoolId?: string | null;
  databaseCount?: number; // For elastic pools
  purchasingModel: SqlPurchasingModel;
  storage: SqlStorageProfile;
  licensing: SqlLicenseProfile;
  metrics: SqlPerformanceMetrics;
  cost: SqlCostProfile;
  recommendations: SqlRemediationAction[];
}

export interface AzureSqlFinopsSummaryResponse {
  success: boolean;
  instances: AzureSqlResourceDetail[];
  financialSummary: {
    mtdCost: number;
    forecastEom: { value: number; low: number; high: number };
    deltaMoM: { value: number; percentage: number };
    potentialSavings: number;
  };
  efficiency: {
    costPerEffectiveVcore: number;
    costPerDtu: number;
    underutilizedCount: number;
    serverlessCandidateCount: number;
    ahubEligibleCount: number;
    storageTrimCandidateCount: number;
  };
  risk: {
    healthScore: number;
    systemDatabasesCount: number;
    highConnectionPressureCount: number;
    highLogIoPressureCount: number;
  };
  recommendations: SqlRemediationAction[];
  lastUpdatedAt: string;
  isDemoMode?: boolean;
}

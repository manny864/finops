// -----------------------------------------------------------------------
// Azure Database for MySQL — FinOps Type Definitions
// Required roles: Reader + Cost Management Reader (tenant-scoped)
// -----------------------------------------------------------------------

export type MySqlServerType = "FlexibleServer" | "SingleServer";

export type MySqlSkuTier = "Burstable" | "GeneralPurpose" | "MemoryOptimized";

export type MySqlHaMode = "Disabled" | "SameZone" | "ZoneRedundant";

export type MySqlState =
  | "healthy"
  | "warning"
  | "critical";

export interface MySqlSkuProfile {
  /** e.g. "Standard_B1ms", "Standard_D4ds_v4", "Standard_E8ds_v5" */
  name: string;
  tier: MySqlSkuTier;
  /** vCores assigned to the server */
  vCores: number;
  /** Nominal memory in GiB based on SKU */
  memoryGib: number;
  /** Max IOPS provisioned */
  iops: number;
  /** Storage provisioned in GiB */
  storageGib: number;
  /** Storage auto-grow enabled */
  storageAutoGrow: boolean;
  /** MySQL engine version */
  version: string;
  /** High Availability mode */
  haMode: MySqlHaMode;
  /** Number of HA standby replicas */
  haReplicas: number;
  /** Read replicas count */
  readReplicas: number;
  /** Backup retention days */
  backupRetentionDays: number;
  /** Geo-redundant backup enabled */
  geoRedundantBackup: boolean;
}

export interface MySqlPerformanceMetrics {
  /** CPU utilization average (%) over last 24h */
  cpuPercentAvg: number;
  /** CPU utilization peak (%) over last 24h */
  cpuPercentMax: number;
  /** Memory utilization average (%) */
  memoryPercentAvg: number;
  /** Storage used in GiB */
  storageUsedGib: number;
  /** Storage utilization ratio (used / provisioned * 100) */
  storageUsedPct: number;
  /** Active connections average */
  activeConnectionsAvg: number;
  /** Active connections peak */
  activeConnectionsMax: number;
  /** IO consumption percent (average) */
  ioConsumptionPct: number;
  /** Queries per second (average) */
  queriesPerSecond: number;
  /** Slow queries count (last 24h) */
  slowQueries: number;
  /** Network ingress bytes/sec (average) */
  networkIngressBps: number;
  /** Network egress bytes/sec (average) */
  networkEgressBps: number;
  /** Failed connections count (last 24h) */
  failedConnections: number;
}

export interface MySqlCostBreakdown {
  /** Total monthly cost in USD (compute + storage + backup) */
  monthlyCostUsd: number;
  /** Estimated compute portion */
  computeCostUsd: number;
  /** Estimated storage portion */
  storageCostUsd: number;
  /** Estimated backup storage portion */
  backupCostUsd: number;
  /** Potential monthly savings from remediation actions */
  savingsMonthlyUsd: number;
}

export type MySqlRemediationRuleKey =
  | "downsize_burstable_sku"
  | "migrate_to_burstable"
  | "storage_overprovisioned"
  | "ha_dev_test"
  | "single_server_migration"
  | "idle_server";

export interface MySqlRemediationAction {
  id: string;
  ruleKey: MySqlRemediationRuleKey;
  title: string;
  description: string;
  savingsMonthlyUsd: number;
  risk: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  actionType: "manual" | "guided" | "automatic";
  cliCommand?: string;
  bicepSnippet?: string;
}

export interface MySqlServerDetail {
  id: string;
  name: string;
  serverType: MySqlServerType;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  region: string;
  state: MySqlState;
  skuProfile: MySqlSkuProfile;
  metrics: MySqlPerformanceMetrics;
  cost: MySqlCostBreakdown;
  recommendations: MySqlRemediationAction[];
  /** Fully qualified domain name */
  fqdn?: string;
  tags?: Record<string, string>;
  /** Whether this is flagged as Legacy (SingleServer → scheduled retirement) */
  isLegacy: boolean;
  /** Provisioning state from ARM */
  provisioningState?: string;
  /** Whether SSL enforcement is enabled */
  sslEnforcement?: boolean;
}

export interface MySqlFinopsSummaryResponse {
  servers: MySqlServerDetail[];
  financialSummary: {
    mtdCost: number;
    forecastEom: { value: number; low: number; high: number };
    deltaMoM: { value: number; percentage: number };
    potentialSavings: number;
  };
  efficiency: {
    costPerVCore: number;
    costPerGibStorage: number;
    underutilizedCount: number;
    legacySingleServerCount: number;
  };
  risk: {
    healthScore: number;
    criticalAlerts: number;
    idleServersCount: number;
    haOverprovisionedCount: number;
  };
  recommendations: MySqlRemediationAction[];
}

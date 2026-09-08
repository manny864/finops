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

/**
 * Claves i18n del titulo y la descripcion de cada recomendacion.
 *
 * Mismo motivo y misma solucion que en Redis, MongoDB y MySQL: la ruta cachea
 * con una clave que NO incluye el locale, asi que traducir en el servidor sirve
 * el idioma equivocado desde el cache. El payload lleva clave + parametros.
 *
 * Record sobre la union cerrada, y exportado para `i18nClavesDinamicas.test.ts`.
 */
export const POSTGRES_RULE_I18N: Record<PostgreSqlRemediationRuleKey, { title: string; desc: string }> = {
  downsize_sku: { title: "rec_downsize_sku_title", desc: "rec_downsize_sku_desc" },
  storage_overallocated: { title: "rec_storage_over_title", desc: "rec_storage_over_desc" },
  ha_disabled_dev_test: { title: "rec_ha_dev_test_title", desc: "rec_ha_dev_test_desc" },
  auto_stop_schedule: { title: "rec_auto_stop_title", desc: "rec_auto_stop_desc" },
  single_server_migration: { title: "rec_single_server_title", desc: "rec_single_server_desc" },
  autoscale_iops_optimization: { title: "rec_autoscale_iops_title", desc: "rec_autoscale_iops_desc" },
};

export interface PostgreSqlRemediationAction {
  id: string;
  ruleKey: PostgreSqlRemediationRuleKey;
  /** Valores a interpolar en el titulo y la descripcion. Numeros y nombres, nunca frases. */
  params: Record<string, string | number>;
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

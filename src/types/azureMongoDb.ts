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

/**
 * Claves i18n del titulo y la descripcion de cada recomendacion.
 *
 * El payload traia `title` y `description` armados en el servidor, en
 * castellano, con los numeros ya interpolados. Mismo motivo y misma solucion que
 * en Redis (ver `REDIS_RULE_I18N`): las rutas de bases de datos cachean con
 * `getDiagnosticsCacheKey(tenantId, ...)`, que NO incluye el locale, asi que
 * traducir en el servidor sirve el idioma equivocado desde el cache. El payload
 * lleva la clave y los parametros, que son locale-independientes.
 *
 * Record sobre la union cerrada, y exportado para que
 * `i18nClavesDinamicas.test.ts` pueda afirmar que las claves existen: la UI arma
 * la clave en runtime y `i18nKeyIntegrity` no la ve.
 */
export const MONGO_RULE_I18N: Record<MongoRemediationRuleKey, { title: string; desc: string }> = {
  vcore_downsize: { title: "rec_vcore_downsize_title", desc: "rec_vcore_downsize_desc" },
  vcore_ha_dev_test: { title: "rec_vcore_ha_title", desc: "rec_vcore_ha_desc" },
  ru_manual_to_autoscale_serverless: { title: "rec_ru_autoscale_title", desc: "rec_ru_autoscale_desc" },
  reserved_capacity: { title: "rec_reserved_capacity_title", desc: "rec_reserved_capacity_desc" },
  storage_index_optimization: { title: "rec_storage_index_title", desc: "rec_storage_index_desc" },
};

export interface MongoRemediationAction {
  id: string;
  ruleKey: MongoRemediationRuleKey;
  /** Valores a interpolar en el titulo y la descripcion. Numeros y nombres, nunca frases. */
  params: Record<string, string | number>;
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

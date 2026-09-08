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

/**
 * `index_overhead` se parte en dos.
 *
 * La ruta emitia UNA ruleKey con dos descripciones distintas segun
 * `isHeavyIndex`: o los indices ya ocupan una porcion excesiva, o Cosmos indexa
 * por defecto todas las rutas. Son dos diagnosticos, no dos redacciones del
 * mismo, y el servidor ya sabe cual es. Con una sola clave el cliente no podria
 * distinguirlos, asi que el discriminador se hace explicito.
 */
export type CosmosRemediationRuleKey =
  | "manual_overprovisioned"
  | "free_tier_activation"
  | "multi_region_dev"
  | "reserved_capacity"
  | "index_overhead_heavy"
  | "index_overhead_default"
  | "vcore_rightsizing";

/**
 * Claves i18n del titulo y la descripcion de cada recomendacion.
 *
 * Mismo motivo y misma solucion que en Redis, MongoDB, MySQL y PostgreSQL: la
 * ruta cachea con una clave que NO incluye el locale, asi que traducir en el
 * servidor sirve el idioma equivocado desde el cache. El payload lleva clave +
 * parametros. Exportado para `i18nClavesDinamicas.test.ts`.
 */
export const COSMOS_RULE_I18N: Record<CosmosRemediationRuleKey, { title: string; desc: string }> = {
  manual_overprovisioned: { title: "rec_manual_over_title", desc: "rec_manual_over_desc" },
  free_tier_activation: { title: "rec_free_tier_title", desc: "rec_free_tier_desc" },
  multi_region_dev: { title: "rec_multi_region_title", desc: "rec_multi_region_desc" },
  reserved_capacity: { title: "rec_reserved_capacity_title", desc: "rec_reserved_capacity_desc" },
  index_overhead_heavy: { title: "rec_index_overhead_title", desc: "rec_index_overhead_heavy_desc" },
  index_overhead_default: { title: "rec_index_overhead_title", desc: "rec_index_overhead_default_desc" },
  vcore_rightsizing: { title: "rec_vcore_rightsizing_title", desc: "rec_vcore_rightsizing_desc" },
};

export interface CosmosRemediationAction {
  id: string;
  ruleKey: CosmosRemediationRuleKey;
  /** Valores a interpolar en el titulo y la descripcion. Numeros y nombres, nunca frases. */
  params: Record<string, string | number>;
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

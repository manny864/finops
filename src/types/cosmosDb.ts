export type CosmosArchitectureType = "ru-based" | "vcore-based";

export type CosmosApiKind =
  | "GlobalDocumentDB" // NoSQL
  | "MongoDB"
  | "Cassandra"
  | "Gremlin"
  | "Table"
  | "MongoCluster"; // MongoDB vCore

/**
 * "unknown" existe porque el modo se deduce de las metricas —Azure sólo emite
 * `AutoscaleMaxThroughput` para contenedores en autoscale— y si Azure no
 * devuelve ninguna serie no hay con que decidir. Antes se asumia "autoscale"
 * para todo lo que no fuera serverless, que es una afirmacion sin respaldo.
 */
export type CosmosThroughputMode = "manual" | "autoscale" | "serverless" | "vcore" | "unknown";

export interface CosmosStorageBreakdown {
  dataUsageGb: number | null;
  indexUsageGb: number | null;
  analyticalStorageGb: number;
  indexRatio: number | null; // index / data
}

/**
 * `null` = no se pudo medir, y NO es lo mismo que cero (MEJ-18). Antes estos
 * campos eran `number` y el camino real los llenaba con constantes escritas en
 * el codigo -35% de RU, 0% de throttling, 100.000 requests- para cualquier
 * cuenta de cualquier cliente. Con el tipo anulable, una serie que Azure no
 * devuelve llega como null hasta la pantalla y la pantalla lo dice.
 */
export interface CosmosPerformanceMetrics {
  avgNormalizedRuPct: number | null;
  p95NormalizedRuPct: number | null;
  /** Pico absoluto del periodo. 100 sostenido implica throttling. */
  maxNormalizedRuPct?: number | null;
  /** PORCENTAJE 0-100, no fraccion. El mock servia 0.04 para decir 4%. */
  throttling429Rate: number | null;
  totalRequests: number | null;
  throttledRequests: number | null;
  serverLatencyMs: number | null;
  // vCore metrics
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
}

/** Reparto del consumo por particion fisica, para el diagnostico de hot partition. */
export interface CosmosPartitionSkew {
  particiones: Array<{ partitionId: string; avgNormalizedRuPct: number; maxNormalizedRuPct: number }>;
  esCaliente: boolean;
  partitionIdCaliente: string | null;
  concentracionPct: number | null;
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
  /** Sólo para cuentas RU. Ausente si no se pudo desglosar por partición. */
  partitionSkew?: CosmosPartitionSkew;
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

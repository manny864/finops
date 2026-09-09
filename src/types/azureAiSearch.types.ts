/**
 * Azure AI Search — TypeScript strict types for the AI Search sub-tab.
 *
 * Covers: KPI summary, per-service detail, SKU breakdown, time-series data,
 * and remediation actions (rightsizing, orphan detection, replica reduction).
 *
 * All monetary values are in USD as decimal strings (Regla Cero — no floats).
 */

// ── Per-Service Item ────────────────────────────────────────────────────────

export type AiSearchSkuName =
  | "Free"
  | "Basic"
  | "Standard"
  | "Standard2"
  | "Standard3"
  | "StorageOptimizedL1"
  | "StorageOptimizedL2";

export type SemanticSearchTier = "disabled" | "free" | "standard";

export interface AiSearchServiceItem {
  /** Azure resource ID. */
  id: string;
  /** Human-readable service name. */
  name: string;
  /** Azure region (e.g. "eastus2"). */
  location: string;
  /** Resource group name. */
  resourceGroup: string;
  /** Subscription GUID. */
  subscriptionId: string;
  /** Resolved subscription display name. */
  subscriptionName: string;
  /** SKU / tier name. */
  skuName: AiSearchSkuName;
  /** Number of replicas (1-12). */
  replicaCount: number;
  /** Number of partitions (1-12). */
  partitionCount: number;
  /** Search Units = replicaCount × partitionCount. */
  searchUnits: number;
  /** Semantic search tier: disabled, free, or standard. */
  semanticSearchTier: SemanticSearchTier;
  /** Average QPS over the observation window. */
  qpsAvg: number;
  /** Average search latency in milliseconds. */
  latencyMsAvg: number;
  /** Storage used in GB. */
  storageUsedGB: number;
  /** Number of indexed documents. */
  documentsCount: number;
  /** Estimated monthly cost in USD (decimal string). */
  monthlyCostUSD: string;
  /** Current Azure Cost Management month-to-date cost (USD, decimal string). */
  currentCostMtdUSD?: string;
  /** Whether this is a dev/test/staging environment. */
  isDevOrTest: boolean;
  /** Whether the service has zero indexes or zero calls in 30 days. */
  isOrphan: boolean;
  /** Number of active indexes. */
  indexCount: number;
  /** Peak QPS observed. */
  qpsPeak: number;
  /** Throttle rate (HTTP 503 percentage). */
  throttleRatePct: number;
  /** Public network access enabled? */
  publicNetworkAccess: boolean;
}

// ── KPI Summary ─────────────────────────────────────────────────────────────

export interface AiSearchSummary {
  /** Current Azure Cost Management month-to-date cost (USD, decimal string). */
  currentCostMtdUSD: string;
  /** Total MTD cost across all search services (USD, decimal string). */
  totalMonthlyCostUSD: string;
  /** Total Search Units provisioned. */
  totalSearchUnits: number;
  /** Number of search services. */
  totalServicesCount: number;
  /** Total indexed documents across all services. */
  totalDocumentsCount: number;
  /** Total active indexes. */
  totalIndexesCount: number;
  /** Potential monthly savings from optimization (USD, decimal string). */
  potentialSavingsUSD: string;
  /** Average QPS across all services. */
  avgQps: number;
  /** Average latency across all services (ms). */
  avgLatencyMs: number;
  /** Breakdown by SKU tier. */
  breakdownBySku: AiSearchSkuBreakdown[];
  /** ISO timestamp of computation. */
  computedAt: string;
  /** Data provenance. */
  source: "live" | "snapshot" | "mock";
}

export interface AiSearchSkuBreakdown {
  /** SKU name. */
  sku: string;
  /** MTD cost for this SKU (USD, decimal string). */
  costUSD: string;
  /** Number of services with this SKU. */
  count: number;
  /** Percentage of total AI Search spend (0-100). */
  percentage: number;
  /** Tailwind-compatible hex color for charts. */
  color: string;
}

// ── Full Payload ────────────────────────────────────────────────────────────

export interface AiSearchPayload {
  /** KPI summary. */
  summary: AiSearchSummary;
  /** Per-service detail list. */
  services: AiSearchServiceItem[];
  /** Prioritized remediation actions. */
  remediationActions: AiSearchRemediationAction[];
}

// ── Remediation Actions ─────────────────────────────────────────────────────

export const AI_SEARCH_REMEDIATION_CATEGORIES = [
  "DOWNGRADE_TIER",
  "REDUCE_REPLICAS",
  "ORPHAN_SERVICE",
  "SEMANTIC_RANKER_AUDIT",
] as const;

export type AiSearchRemediationCategory =
  (typeof AI_SEARCH_REMEDIATION_CATEGORIES)[number];

export interface AiSearchRemediationAction {
  /** Unique action identifier. */
  id: string;
  /** Service ID this action targets. */
  serviceId: string;
  /** Service name for display. */
  serviceName: string;
  /** Valores a interpolar en `rem_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
  /** Category of remediation. */
  category: AiSearchRemediationCategory;
  /** Estimated monthly savings (USD, decimal string). */
  estimatedSavingsUSD: string;
  /** Confidence level. */
  confidence: "HIGH" | "MEDIUM";
  /** Action type for the remediation engine. */
  actionType: string;
  /** Optional Azure CLI / REST payload for automation. */
  commandPayload?: string;
}

// ── Time-Series (for charts) ────────────────────────────────────────────────

export interface AiSearchTimeSeriesPoint {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** Total cost for that day (USD, decimal string). */
  costUSD: string;
  /** Average QPS for that day. */
  qpsAvg: number;
  /** Total queries for that day. */
  queriesCount: number;
}
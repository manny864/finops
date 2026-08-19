/**
 * Azure AI Foundry — TypeScript strict types for the Foundry sub-tab.
 *
 * Covers: KPI summary, model usage breakdown, application consumers,
 * time-series data points, and remediation actions.
 *
 * All monetary values are in USD as decimal strings (Regla Cero — no floats).
 */

// ── KPI Summary (top 5 cards) ───────────────────────────────────────────────

export interface FoundrySummaryMetrics {
  /** Total API requests in the selected time window. */
  totalRequests: number;
  /** Average requests per day. */
  avgRequestsPerDay: number;
  /** Total tokens processed (input + output). */
  totalTokens: number;
  /** Average tokens per request. */
  avgTokensPerRequest: number;
  /** Estimated MTD cost (USD, decimal string). */
  estimatedCostUSD: string;
  /** Projected end-of-month cost (USD, decimal string). */
  forecastCostUSD: string;
  /** Total input/prompt tokens. */
  inputTokens: number;
  /** Prompt caching hit rate (0-100). */
  promptCacheHitRate: number;
  /** Total output/completion tokens. */
  outputTokens: number;
  /** Weighted average cost per 1K output tokens (USD, decimal string). */
  avgCostPer1kOutputTokensUSD: string;
  /** Total cached tokens served. */
  cachedTokens: number;
  /** Number of active model deployments. */
  activeDeployments: number;
  /** Number of distinct applications/consumers. */
  activeApplications: number;
  /** Dominant billing model. */
  billingModel: "PAYG" | "PTU" | "HYBRID" | "UNKNOWN";
  /** ISO timestamp of computation. */
  computedAt: string;
  /** Data provenance. */
  source: "live" | "snapshot" | "mock";
}

// ── Per-Model Usage ─────────────────────────────────────────────────────────

export interface FoundryModelUsageItem {
  /** Deployment name in Azure. */
  deploymentName: string;
  /** Model name (e.g. "gpt-4o-mini"). */
  modelName: string;
  /** Model version. */
  modelVersion: string;
  /** Input tokens consumed. */
  inputTokens: number;
  /** Output tokens generated. */
  outputTokens: number;
  /** Tokens served from prompt cache. */
  cachedTokens: number;
  /** Cost per 1K tokens (USD, decimal string). */
  costPer1kTokensUSD: string;
  /** Total cost for this model in the period (USD, decimal string). */
  totalCostUSD: string;
  /** Percentage share of total Foundry spend. */
  percentageOfSpend: number;
  /** SKU tier (Standard, ProvisionedManaged, GlobalStandard, etc.). */
  skuTier: string;
  /** Provisioned TPM capacity (if PTU). */
  provisionedTpm?: number;
}

// ── Application / Consumer Attribution ──────────────────────────────────────

export interface FoundryApplicationConsumer {
  /** Application identifier (resolved to friendly name). */
  appId: string;
  /** Human-readable display name. */
  appDisplayName: string;
  /** Primary model used by this app. */
  modelUsed: string;
  /** Total cost attributed to this app (USD, decimal string). */
  totalCostUSD: string;
  /** Percentage share of total Foundry spend. */
  percentageOfSpend: number;
  /** Number of API requests from this app. */
  requestsCount: number;
  /** Whether this app has a CostCenter tag assigned. */
  hasCostCenter: boolean;
  /** CostCenter value if assigned. */
  costCenter?: string;
}

// ── Time Series ─────────────────────────────────────────────────────────────

export interface FoundryTimeSeriesPoint {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** Daily cost in USD. */
  costUSD: number;
  /** Cumulative MTD cost. */
  cumulativeCostUSD: number;
  /** Daily input tokens. */
  inputTokens: number;
  /** Daily output tokens. */
  outputTokens: number;
  /** Daily total tokens. */
  totalTokens: number;
  /** Daily cached tokens. */
  cachedTokens: number;
}

// ── Remediation Actions ─────────────────────────────────────────────────────

export type FoundryRemediationCategory =
  | "MODEL_DOWNGRADE"
  | "PROMPT_CACHING"
  | "PTU_ARBITRAGE"
  | "TAG_SHOWBACK"
  | "IDLE_DEPLOYMENT";

export interface FoundryRemediationAction {
  /** Unique identifier. */
  id: string;
  /** Short title. */
  title: string;
  /** Detailed description. */
  description: string;
  /** Remediation category. */
  category: FoundryRemediationCategory;
  /** Estimated monthly savings (USD, decimal string). */
  estimatedSavingsUSD: string;
  /** Confidence level. */
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Action type for UI rendering. */
  actionType: string;
  /** Optional Azure CLI / PowerShell payload. */
  commandPayload?: string;
}

// ── Full Payload ────────────────────────────────────────────────────────────

export interface FoundryDetailPayload {
  /** Top-level KPI metrics. */
  metrics: FoundrySummaryMetrics;
  /** Per-model usage breakdown. */
  modelUsage: FoundryModelUsageItem[];
  /** Per-application attribution. */
  applicationConsumers: FoundryApplicationConsumer[];
  /** Time-series data for charts. */
  timeSeries: FoundryTimeSeriesPoint[];
  /** Detected remediation actions. */
  remediationActions: FoundryRemediationAction[];
  /** Whether this is mock/demo data. */
  mock: boolean;
}
/**
 * Azure AI Summary — TypeScript strict types for the Resumen tab.
 *
 * These types power the consolidated AI cost overview: KPI cards, capability
 * breakdown bars, LLM unit economics, risk signals, and remediation actions.
 *
 * All monetary values are in USD as decimal strings (Regla Cero — no floats).
 */

// ── KPI Summary (top 4 cards) ──────────────────────────────────────────────

export interface AzureAiSummaryMetrics {
  /** Total MTD cost across all 8 AI capabilities (USD, decimal string). */
  totalCostMtdUSD: string;
  /** Projected end-of-month cost (USD, decimal string). */
  forecastEomUSD: string;
  /** Estimated waste from idle/orphan/underutilized AI resources (USD, decimal string). */
  estimatedWasteUSD: string;
  /** Sum of all detected optimization opportunities (USD, decimal string). */
  potentialSavingsUSD: string;
  /** Total tokens processed (prompt + completion) across OpenAI/Foundry. */
  totalTokensProcessed: number;
  /** Weighted average cost per 1M tokens (USD, decimal string). */
  avgCostPerMillionTokensUSD: string;
  /** Dominant billing model for the tenant's AI workloads. */
  billingModel: "PAYG" | "PTU" | "HYBRID" | "UNKNOWN";
  /** Month-over-month cost variation as a percentage string (e.g. "+12.4" or "-3.2"). */
  momVariationPct: string;
  /** ISO timestamp of when this summary was computed. */
  computedAt: string;
  /** Data provenance: "live" (real Azure), "snapshot" (cached DB), or "mock" (demo). */
  source: "live" | "snapshot" | "mock";
}

// ── Capability Breakdown (horizontal bar chart) ─────────────────────────────

export type AiCapabilityKey =
  | "foundry"
  | "search"
  | "doc_intelligence"
  | "speech_language"
  | "vision_video"
  | "content_safety"
  | "machine_learning"
  | "databricks";

export interface AiCapabilityBreakdownItem {
  /** Machine-readable key matching the 8 capabilities. */
  capabilityKey: AiCapabilityKey;
  /** Human-readable display name (e.g. "Azure AI Foundry / OpenAI"). */
  displayName: string;
  /** MTD cost for this capability (USD, decimal string). */
  costMtdUSD: string;
  /** Percentage share of total AI spend (0-100, decimal string). */
  sharePercentage: string;
  /** Waste detected within this capability (USD, decimal string). */
  wasteUSD: string;
  /** Number of active billable resources for this capability. */
  activeResourcesCount: number;
  /** Tailwind-compatible hex color for the progress bar (blue scale). */
  colorHex: string;
  /** Whether this capability has active anomaly signals. */
  hasAnomaly: boolean;
}

// ── LLM Unit Economics (mini-grid) ──────────────────────────────────────────

export interface AiUnitEconomics {
  /** Total prompt tokens processed in the current period. */
  promptTokens: number;
  /** Total completion/generation tokens processed. */
  completionTokens: number;
  /** Total tokens (prompt + completion). */
  totalTokens: number;
  /** Weighted average cost per 1M tokens (USD, decimal string). */
  avgCostPerMillionTokensUSD: string;
  /** Dominant billing model. */
  billingModel: "PAYG" | "PTU" | "HYBRID" | "UNKNOWN";
  /** Number of active model deployments/endpoints. */
  activeDeployments: number;
  /** Most-used model name (e.g. "gpt-4o-mini"). */
  topModelName: string;
}

// ── Risk & Anomaly Signals ──────────────────────────────────────────────────

export type AiAnomalySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AiRiskAnomalySignal {
  /** Unique signal identifier. */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** Detailed description of the detected issue. */
  description: string;
  /** Severity classification. */
  severity: AiAnomalySeverity;
  /** ISO timestamp when the signal was detected. */
  detectedAt: string;
  /** Which AI capability this signal originates from. */
  serviceOrigin: AiCapabilityKey;
  /** Human-readable service name. */
  serviceOriginName: string;
  /** Estimated financial impact if unresolved (USD, decimal string). */
  estimatedImpactUSD: string;
}

// ── Remediation Actions ─────────────────────────────────────────────────────

export type AiRemediationConfidence = "HIGH" | "MEDIUM";

export type AiRemediationActionType =
  | "auto_shutdown"
  | "auto_termination"
  | "model_modernization"
  | "rightsizing"
  | "commitment_tier"
  | "consolidation"
  | "token_governance";

export interface AiRemediationAction {
  /** Unique action identifier. */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** Detailed description of what to do and why. */
  description: string;
  /** Which capability this action targets. */
  capabilityKey: AiCapabilityKey;
  /** Human-readable capability name. */
  capabilityName: string;
  /** Estimated monthly savings if executed (USD, decimal string). */
  estimatedMonthlySavingsUSD: string;
  /** Confidence level of the savings estimate. */
  confidence: AiRemediationConfidence;
  /** Type of remediation action. */
  actionType: AiRemediationActionType;
  /** Optional Azure CLI / PowerShell command payload. */
  commandPayload?: string;
}

// ── Full Summary Payload (returned by the API) ──────────────────────────────

export interface AzureAiSummaryPayload {
  /** Top-level KPI metrics. */
  metrics: AzureAiSummaryMetrics;
  /** Breakdown by each of the 8 AI capabilities. */
  capabilityBreakdown: AiCapabilityBreakdownItem[];
  /** LLM/Inference unit economics. */
  unitEconomics: AiUnitEconomics;
  /** Detected risk and anomaly signals. */
  riskSignals: AiRiskAnomalySignal[];
  /** Prioritized remediation actions (sorted by savings desc). */
  remediationActions: AiRemediationAction[];
  /** Whether this payload is mock/demo data. */
  mock: boolean;
}
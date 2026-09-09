/**
 * TypeScript Contracts for Microsoft Sentinel FinOps & Governance Console
 */

export type SentinelPricingTier =
  | "PerGB2018"
  | "CapacityReservation100GB"
  | "CapacityReservation200GB"
  | "CapacityReservation300GB"
  | "CapacityReservation400GB"
  | "CapacityReservation500GB"
  | "Free"
  | "Standalone";

/**
 * Lista en tiempo de ejecucion, no solo un tipo: el texto de cada recomendacion
 * se resuelve con `rem_<category>_title` / `_desc`, asi que el test de claves
 * necesita poder recorrer las categorias. El tipo se deriva de la lista para
 * que no puedan separarse.
 */
export const SENTINEL_REMEDIATION_CATEGORIES = [
  "COMMITMENT_TIER",
  "ORPHAN_RULES",
  "DAILY_CAP",
  "RETENTION_ADJUST",
] as const;

export type SentinelRemediationCategory = (typeof SENTINEL_REMEDIATION_CATEGORIES)[number];

export interface SentinelTableIngestion {
  tableName: string;
  category: string; // e.g. "Security", "Identity", "Network", "Audit"
  ingestedGB: number;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface SentinelResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  lawPricingTier: SentinelPricingTier | string;
  retentionInDays: number;
  dailyCapGB: number | null;
  isDailyCapUnlimited: boolean;
  totalIngestedGB_MTD: number;
  avgDailyIngestionGB: number;
  costMtdUSD: number; // Log Analytics base + Sentinel fee
  specializedCostUSD: number; // Sentinel-specific ingestion license ($2.00/GB)
  totalRealCostUSD: number; // Consolidated total ($4.30/GB)
  potentialSavingsUSD: number;
  isWasteful: boolean;
  isDevOrTest: boolean;
  isOrphan: boolean;
  orphanRulesCount: number;
  topTables?: SentinelTableIngestion[];
  primaryRecommendation?: {
    category: SentinelRemediationCategory;
    params?: Record<string, string | number>;
    savingsUSD: number;
  };
}

export interface SentinelTopTable {
  tableName: string;
  category: string;
  ingestedGB: number;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface SentinelDailyTrendPoint {
  date: string;
  ingestedGB: number;
  costUSD: number;
  securityEventsCount: number;
}

export interface SentinelCategoryBreakdown {
  typeName: string;
  typeLabel: string;
  costUSD: number;
  ingestedGB: number;
  percentage: number;
  color: string;
}

export interface SentinelSummaryMetrics {
  totalMonthlyCostUSD: number;
  totalIngestedGB: number;
  potentialSavingsUSD: number;
  commitmentCandidatesCount: number;
  breakRatePercentage: number;
  activeWorkspacesCount: number;
  orphanRulesCount: number;
  unlimitedCapCount: number;
  breakdownByCategory: SentinelCategoryBreakdown[];
}

export interface SentinelRemediationAction {
  id: string;
  resourceId: string;
  resourceName: string;
  params?: Record<string, string | number>;
  category: SentinelRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentTier?: string;
  recommendedTier?: string;
  recommendedDailyCapGB?: number;
  recommendedRetentionDays?: number;
  orphanRulesCount?: number;
}

export interface SentinelPayload {
  summary: SentinelSummaryMetrics;
  workspaces: SentinelResource[];
  topTables: SentinelTopTable[];
  remediationActions: SentinelRemediationAction[];
  dailyTrend: SentinelDailyTrendPoint[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

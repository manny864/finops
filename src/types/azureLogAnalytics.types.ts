/**
 * TypeScript Contracts for Azure Log Analytics Workspace (LAW) FinOps & Optimization
 */

export type LawPricingTier =
  | "PerGB2018"
  | "CapacityReservation100GB"
  | "CapacityReservation200GB"
  | "CapacityReservation300GB"
  | "CapacityReservation400GB"
  | "CapacityReservation500GB"
  | "CapacityReservation1000GB"
  | "Free"
  | "Standalone"
  | "PerNode";

/**
 * Lista en tiempo de ejecucion, no solo un tipo: el texto de cada recomendacion
 * se resuelve con `rem_<category>_title` / `_desc`, asi que el test de claves
 * necesita poder recorrer las categorias. El tipo se deriva de la lista para
 * que no puedan separarse.
 */
export const LAW_REMEDIATION_CATEGORIES = [
  "COMMITMENT_TIER",
  "DAILY_CAP",
  "RETENTION_ADJUST",
  "PURGE_ORPHAN",
] as const;

export type LawRemediationCategory = (typeof LAW_REMEDIATION_CATEGORIES)[number];

export interface LogAnalyticsResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  pricingTier: LawPricingTier | string;
  capacityReservationLevel?: number; // GB/day (100, 200, 300, etc.)
  retentionInDays: number;
  totalBillableGB_MTD: number;
  avgDailyIngestionGB: number;
  dailyCapGB?: number | null;
  isDailyCapUnlimited: boolean;
  isDevOrTest: boolean;
  isOrphan: boolean;
  isWasteful: boolean;
  monthlyCostUSD: number;
  specializedCostUSD: number; // Extended retention / data export cost
  totalRealCostUSD: number;
  potentialSavingsUSD: number;
  primaryRecommendation?: {
    category: LawRemediationCategory;
    params?: Record<string, string | number>;
    savingsUSD: number;
  };
}

export interface LawPricingTierBreakdown {
  tierName: string;
  workspacesCount: number;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface LawDailyTrendPoint {
  date: string;
  ingestedGB: number;
  costUSD: number;
}

export interface LogAnalyticsSummaryMetrics {
  totalMonthlyCostUSD: number;
  totalIngestedGB: number;
  potentialSavingsUSD: number;
  commitmentCandidatesCount: number;
  unlimitedCapCount: number;
  workspacesCount: number;
  breakdownByPricingTier: LawPricingTierBreakdown[];
}

export interface LogAnalyticsRemediationAction {
  id: string;
  resourceId: string;
  resourceName: string;
  params?: Record<string, string | number>;
  category: LawRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentTier?: string;
  recommendedTier?: string;
  recommendedDailyCapGB?: number;
  currentRetentionDays?: number;
  recommendedRetentionDays?: number;
}

export interface LogAnalyticsPayload {
  summary: LogAnalyticsSummaryMetrics;
  workspaces: LogAnalyticsResource[];
  remediationActions: LogAnalyticsRemediationAction[];
  dailyIngestionTrend: LawDailyTrendPoint[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

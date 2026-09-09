export interface AppInsightsResourceItem {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  linkedWorkspaceId: string;
  linkedWorkspaceName: string;
  samplingPercentage: number;
  dailyCapGB?: number;
  isDailyCapUnlimited: boolean;
  ingestedTotalGB: number;
  tracesGB: number;
  dependenciesGB: number;
  requestsGB: number;
  exceptionsGB: number;
  estimatedCostMtdUSD: number;
  forecastCostUSD: number;
  isDevOrTest: boolean;
  isOrphan: boolean;
  applicationType?: string;
  retentionInDays?: number;
}

export interface TelemetryTypeBreakdown {
  typeName: string;
  gbCount: number;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface AppInsightsSummaryMetrics {
  totalCostMtdUSD: number;
  totalIngestedGB: number;
  instancesCount: number;
  unlimitedCapCount: number;
  potentialSavingsUSD: number;
  breakdownByTelemetryType: TelemetryTypeBreakdown[];
}

export const APP_INSIGHTS_REMEDIATION_CATEGORIES = [
  "SET_DAILY_CAP",
  "REDUCE_SAMPLING",
  "FILTER_LOGS",
  "PURGE_ORPHAN",
] as const;

export type AppInsightsRemediationCategory =
  (typeof APP_INSIGHTS_REMEDIATION_CATEGORIES)[number];

export interface AppInsightsRemediationAction {
  id: string;
  resourceId: string;
  resourceName?: string;
  params?: Record<string, string | number>;
  category: AppInsightsRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentSampling?: number;
  recommendedSampling?: number;
  recommendedDailyCap?: number;
}

export interface AppInsightsDailyIngestionPoint {
  date: string;
  totalGB: number;
  tracesGB: number;
  dependenciesGB: number;
  requestsGB: number;
  exceptionsGB: number;
  costUSD: number;
}

export interface AppInsightsPayload {
  summary: AppInsightsSummaryMetrics;
  items: AppInsightsResourceItem[];
  remediationActions: AppInsightsRemediationAction[];
  dailyIngestionTrend: AppInsightsDailyIngestionPoint[];
  source?: "live" | "mock";
  lastUpdated?: string;
}

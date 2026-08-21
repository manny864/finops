/**
 * TypeScript Contracts for Azure Monitor & Alerting FinOps Console
 */

export type AzureAlertType =
  | "metric"
  | "logSearch"
  | "activityLog"
  | "smartDetector"
  | "webTest";

export type AzureAlertSeverity =
  | "Sev0"
  | "Sev1"
  | "Sev2"
  | "Sev3"
  | "Sev4"
  | "Unknown";

export type AzureMonitorRemediationCategory =
  | "KQL_OPTIMIZE"
  | "MIGRATE_TO_METRIC"
  | "ORPHAN_PURGE"
  | "FREQUENCY_ADJUST";

export interface AzureAlertResource {
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  alertType: AzureAlertType;
  targetResourceId: string;
  targetResourceName: string;
  isEnabled: boolean;
  currentSeverity: AzureAlertSeverity | string;
  isFiring: boolean;
  runFrequency: string; // e.g. "1m", "5m", "15m", "1h", "1d"
  timeWindow?: string; // e.g. "5m", "15m", "1h"
  dataProcessedGB_MTD: number; // GBs processed by KQL in Log Analytics
  avgDailyDataGB: number;
  isDevOrTest: boolean;
  isOrphan: boolean;
  isWasteful: boolean;
  costMtdUSD: number;
  specializedCostUSD: number; // KQL data processing cost ($2.30/GB)
  totalRealCostUSD: number;
  potentialSavingsUSD: number;
  queryPayload?: string; // KQL query string for log search alerts
  primaryRecommendation?: {
    category: AzureMonitorRemediationCategory;
    title: string;
    description: string;
    savingsUSD: number;
  };
}

export interface AzureAlertsByTypeBreakdown {
  typeName: string;
  typeLabel: string;
  alertsCount: number;
  costUSD: number;
  dataProcessedGB: number;
  percentage: number;
  color: string;
}

export interface AzureMonitorDailyTrendPoint {
  date: string;
  dataProcessedGB: number;
  costUSD: number;
  alertsFiringCount: number;
}

export interface AzureMonitorSummaryMetrics {
  totalMonthlyCostUSD: number;
  totalAlertsCount: number;
  enabledCount: number;
  disabledCount: number;
  firingCount: number;
  logSearchDataProcessedGB: number;
  potentialSavingsUSD: number;
  breakdownByAlertType: AzureAlertsByTypeBreakdown[];
}

export interface AzureMonitorRemediationAction {
  id: string;
  resourceId: string;
  resourceName: string;
  title: string;
  description: string;
  category: AzureMonitorRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentFrequency?: string;
  recommendedFrequency?: string;
  currentQuery?: string;
  recommendedQuery?: string;
}

export interface AzureMonitorPayload {
  summary: AzureMonitorSummaryMetrics;
  alerts: AzureAlertResource[];
  topCostlyAlerts: AzureAlertResource[];
  remediationActions: AzureMonitorRemediationAction[];
  dailyTrend: AzureMonitorDailyTrendPoint[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

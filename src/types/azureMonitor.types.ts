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

/**
 * Lista en tiempo de ejecucion, no solo un tipo: el texto de cada recomendacion
 * se resuelve con `rem_<category>_title` / `_desc`, asi que el test de claves
 * necesita poder recorrer las categorias. El tipo se deriva de la lista para
 * que no puedan separarse.
 */
export const AZURE_MONITOR_REMEDIATION_CATEGORIES = [
  "KQL_OPTIMIZE",
  "MIGRATE_TO_METRIC",
  "ORPHAN_PURGE",
  "FREQUENCY_ADJUST",
] as const;

export type AzureMonitorRemediationCategory = (typeof AZURE_MONITOR_REMEDIATION_CATEGORIES)[number];

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
    params?: Record<string, string | number>;
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
  params?: Record<string, string | number>;
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

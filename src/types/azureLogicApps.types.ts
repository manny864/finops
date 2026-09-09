export type LogicAppPlanType =
  | "Consumption"
  | "Standard_WS1"
  | "Standard_WS2"
  | "Standard_WS3";

export type LogicAppState = "Enabled" | "Disabled";

export type LogicAppHealthStatus = "Available" | "Degraded" | "Unavailable";

export interface LogicAppResourceItem {
  id: string;
  name: string;
  planType: LogicAppPlanType;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  state: LogicAppState;
  provisioningState: string;
  healthStatus: LogicAppHealthStatus;
  totalBillableExecutions: number;
  enterpriseExecutions: number;
  enterpriseCostUSD: number;
  costMtdUSD: number;
  costPreviousMonthUSD: number;
  forecastEomUSD: number;
  runsStartedCount: number;
  runsFailedCount: number;
  isOrphanOrIdle: boolean;
  connectors?: string[];
}

export interface LogicAppsSummaryMetrics {
  costMtdUSD: number;
  costPreviousPeriodUSD: number;
  forecastEomUSD: number;
  totalResourcesCount: number;
  totalEnterpriseCalls: number;
  totalEnterpriseCostUSD: number;
  enterpriseCostPercentage: number;
  potentialSavingsUSD: number;
}

export const LOGIC_APP_REMEDIATION_CATEGORIES = [
  "MIGRATE_TO_STANDARD",
  "DOWNGRADE_TO_CONSUMPTION",
  "FIX_RETRY_LOOP",
  "DISABLE_IDLE",
] as const;

export type LogicAppRemediationCategory =
  (typeof LOGIC_APP_REMEDIATION_CATEGORIES)[number];

export interface LogicAppRemediationAction {
  id: string;
  resourceId: string;
  params?: Record<string, string | number>;
  category: LogicAppRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface LogicAppDailyPoint {
  date: string;
  runsStarted: number;
  runsFailed: number;
  costUSD: number;
}

export interface LogicAppsPayload {
  summary: LogicAppsSummaryMetrics;
  items: LogicAppResourceItem[];
  dailyTrend: LogicAppDailyPoint[];
  remediationActions: LogicAppRemediationAction[];
  lastUpdated: string;
  source: "live" | "snapshot" | "mock";
}

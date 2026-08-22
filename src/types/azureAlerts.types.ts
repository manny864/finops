/**
 * TypeScript Contracts for Azure Alerts Management & FinOps Governance
 */

export type AlertRuleType =
  | "metric"
  | "scheduledQuery"
  | "activityLog"
  | "smartDetector"
  | "webTest";

export type AlertSeverity =
  | "Sev0"
  | "Sev1"
  | "Sev2"
  | "Sev3"
  | "Sev4";

export type AlertRemediationCategory =
  | "PURGE_ORPHAN"
  | "ADJUST_FREQUENCY"
  | "ASSIGN_ACTION_GROUP"
  | "TOGGLE_STATE";

export interface AlertFiringEvent {
  timestamp: string;
  status: "Firing" | "Resolved";
  description: string;
}

export interface AlertRuleResource {
  id: string;
  name: string;
  alertType: AlertRuleType;
  alertTypeDisplayName: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  isEnabled: boolean;
  severity: AlertSeverity;
  targetResourceId: string;
  targetResourceName: string;
  targetResourceType: string;
  evaluationFrequency: string;
  windowSize: string;
  conditionSummary: string;
  queryKql?: string;
  actionGroupIds: string[];
  actionGroupNames?: string[];
  lastFiredTimestamp?: string;
  isFiring?: boolean;
  monthlyCostUSD: number;
  isOrphan: boolean;
  isInefficient: boolean;
  firingHistory?: AlertFiringEvent[];
  tags?: Record<string, string>;
}

export interface AlertTypeBreakdownItem {
  typeName: AlertRuleType | string;
  typeLabel: string;
  count: number;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface AlertsSummaryMetrics {
  totalMonthlyCostUSD: number;
  totalAlertsCount: number;
  enabledCount: number;
  disabledCount: number;
  firingLast24hCount: number;
  orphanCount: number;
  inefficientCount: number;
  potentialSavingsUSD: number;
  breakdownByType: AlertTypeBreakdownItem[];
}

export interface AlertRemediationAction {
  id: string;
  ruleId: string;
  ruleName?: string;
  title: string;
  description: string;
  category: AlertRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
  currentFrequency?: string;
  recommendedFrequency?: string;
}

export interface AlertsPayload {
  summary: AlertsSummaryMetrics;
  alerts: AlertRuleResource[];
  remediations: AlertRemediationAction[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

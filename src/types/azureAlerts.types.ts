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

export const ALERT_REMEDIATION_CATEGORIES = [
  "PURGE_ORPHAN",
  "ADJUST_FREQUENCY",
  "ASSIGN_ACTION_GROUP",
  "TOGGLE_STATE",
] as const;

export type AlertRemediationCategory = (typeof ALERT_REMEDIATION_CATEGORIES)[number];

export interface AlertFiringEvent {
  timestamp: string;
  status: "Firing" | "Resolved";
  /** Azure Monitor manda la razon en texto; el dataset demo manda una clave. */
  description?: string;
  descriptionKey?: string;
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
  /** Valores a interpolar en `rem_<category>_title` / `_desc`. */
  params?: Record<string, string | number>;
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

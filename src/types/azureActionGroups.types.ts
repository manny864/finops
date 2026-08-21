/**
 * TypeScript Contracts for Azure Monitor Action Groups & Notification Governance
 */

export type ActionGroupHealthStatus =
  | "Valid"
  | "Orphan"
  | "Invalid_Bounces"
  | "Invalid_Endpoint_Error";

export type ActionGroupRemediationCategory =
  | "ORPHAN_PURGE"
  | "FIX_NOTIFICATION"
  | "ENDPOINT_DEBUG"
  | "EMAIL_CONSOLIDATE";

export interface ActionGroupReceiverSummary {
  emails: string[];
  webhooks: Array<{ name: string; serviceUri: string; useAadAuth?: boolean }>;
  logicApps: Array<{ name: string; resourceId: string; callbackUrl?: string }>;
  azureFunctions: Array<{ name: string; functionAppResourceId: string; functionName: string }>;
  sms: Array<{ name: string; countryCode: string; phoneNumber: string }>;
  voice?: Array<{ name: string; countryCode: string; phoneNumber: string }>;
  armRoles?: Array<{ name: string; roleId: string }>;
  eventHubs?: Array<{ name: string; eventHubId: string }>;
  itsm?: Array<{ name: string; workspaceId: string; connectionId: string }>;
}

export interface ActionGroupResource {
  id: string;
  name: string;
  shortName?: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  state: "Enabled" | "Disabled";
  emailReceiversCount: number;
  webhookReceiversCount: number;
  logicAppReceiversCount: number;
  functionReceiversCount: number;
  smsReceiversCount?: number;
  specializedActionType: string;
  healthStatus: ActionGroupHealthStatus;
  specializedCostUSD: number;
  totalRealCostUSD: number;
  potentialSavingsUSD: number;
  iswasteful: boolean;
  bouncedEmailCount: number;
  failedWebhookCount: number;
  totalNotificationsMTD: number;
  associatedAlertsCount: number;
  associatedAlertRuleNames?: string[];
  receivers?: ActionGroupReceiverSummary;
  tags?: Record<string, string>;
}

export interface ActionTypeBreakdownItem {
  typeName: string;
  typeLabel?: string;
  count: number;
  costUSD: number;
  percentage: number;
  color: string;
}

export interface ActionGroupsSummaryMetrics {
  specializedCostUSD: number;
  totalResourcesCount: number;
  enabledCount: number;
  disabledCount: number;
  orphanCount: number;
  totalNotificationsMTD: number;
  failedNotificationsMTD: number;
  bouncedEmailsTotal: number;
  potentialSavingsUSD: number;
  breakdownByActionType: ActionTypeBreakdownItem[];
}

export interface ActionGroupDailyTrendPoint {
  date: string;
  notificationsCount: number;
  failedCount: number;
  bouncesCount: number;
}

export interface ActionGroupRemediationAction {
  id: string;
  resourceId: string;
  resourceName?: string;
  title: string;
  description: string;
  category: ActionGroupRemediationCategory;
  estimatedSavingsUSD: number;
  confidence: "HIGH" | "MEDIUM";
  actionType: string;
  commandPayload?: string;
}

export interface ActionGroupsPayload {
  summary: ActionGroupsSummaryMetrics;
  actionGroups: ActionGroupResource[];
  remediations: ActionGroupRemediationAction[];
  dailyTrend?: ActionGroupDailyTrendPoint[];
  source: "live" | "mock";
  lastUpdated: string;
  availableSubscriptions?: string[];
}

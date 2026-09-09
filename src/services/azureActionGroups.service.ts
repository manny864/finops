/**
 * Azure Monitor Action Groups & Notification Governance Service
 *
 * Implements ARG discovery of all Action Groups (microsoft.insights/actiongroups),
 * correlates associations with metric, scheduled query, and activity log alerts,
 * calculates computed invocation costs (Logic Apps, Webhooks, Functions),
 * detects bounced emails & failed endpoints, and generates FinOps recommendations.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import type {
  ActionGroupResource,
  ActionGroupsSummaryMetrics,
  ActionTypeBreakdownItem,
  ActionGroupRemediationAction,
  ActionGroupsPayload,
  ActionGroupDailyTrendPoint,
  ActionGroupHealthStatus,
  ActionGroupChannel,
} from "@/types/azureActionGroups.types";

export const ACTION_TYPE_COLORS: Record<string, string> = {
  Email: "#0078D4", // Deep Corporate Blue
  Webhook: "#2563EB", // Cobalt Blue
  LogicApp: "#0284C7", // Cyan Blue
  AzureFunction: "#38BDF8", // Sky Blue
  SMS: "#0EA5E9", // Vibrant Blue
  MultiChannel: "#1B2A41", // Midnight Blue
  None: "#94A3B8", // Slate
};

/**
 * Derives the primary human-readable specialized action type
 */
/**
 * Redacta el material secreto de la URI de un webhook receiver antes de
 * exponerla al cliente. Los webhooks de Action Groups suelen llevar la
 * credencial en el query string o en el userinfo (tokens de Teams/Slack,
 * routing keys de PagerDuty, `?code=` de Azure Functions), y la consola de
 * gobernanza solo necesita identificar el endpoint, no poder invocarlo.
 * Devuelve origen + path; ante una URI no parseable devuelve cadena vacia.
 */
export function redactReceiverUri(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "";
  }
}

export function deriveActionType(
  emails: number,
  webhooks: number,
  logicApps: number,
  functions: number,
  sms: number = 0
): ActionGroupChannel {
  const totalTypes = (emails > 0 ? 1 : 0) + (webhooks > 0 ? 1 : 0) + (logicApps > 0 ? 1 : 0) + (functions > 0 ? 1 : 0) + (sms > 0 ? 1 : 0);
  if (totalTypes === 0) return "NO_RECIPIENTS";
  if (totalTypes > 1) return "MULTI";
  if (emails > 0) return "EMAIL";
  if (webhooks > 0) return "WEBHOOK";
  if (logicApps > 0) return "LOGIC_APP";
  if (functions > 0) return "AZURE_FUNCTION";
  if (sms > 0) return "SMS_VOICE";
  return "EMAIL";
}

/**
 * Calculates summary metrics and action type distribution
 */
export function calculateActionGroupsSummary(
  actionGroups: ActionGroupResource[],
  customRemediations?: ActionGroupRemediationAction[]
): ActionGroupsSummaryMetrics {
  const totalResourcesCount = actionGroups.length;
  const enabledCount = actionGroups.filter((ag) => ag.state === "Enabled").length;
  const disabledCount = actionGroups.filter((ag) => ag.state === "Disabled").length;
  const orphanCount = actionGroups.filter((ag) => ag.healthStatus === "Orphan").length;

  const totalNotificationsMTD = actionGroups.reduce((sum, ag) => sum + ag.totalNotificationsMTD, 0);
  const failedNotificationsMTD = actionGroups.reduce((sum, ag) => sum + ag.failedWebhookCount, 0);
  const bouncedEmailsTotal = actionGroups.reduce((sum, ag) => sum + ag.bouncedEmailCount, 0);

  const specializedCostUSD = Number(
    actionGroups.reduce((sum, ag) => sum + (ag.state === "Enabled" ? ag.specializedCostUSD : 0), 0).toFixed(2)
  );

  // Group by specializedActionType
  const typeMap = new Map<string, { count: number; cost: number }>();
  for (const ag of actionGroups) {
    const typeKey = ag.specializedActionType || "Email";
    const current = typeMap.get(typeKey) || { count: 0, cost: 0 };
    typeMap.set(typeKey, {
      count: current.count + 1,
      cost: current.cost + (ag.state === "Enabled" ? ag.specializedCostUSD : 0),
    });
  }

  const breakdownByActionType: ActionTypeBreakdownItem[] = Array.from(typeMap.entries()).map(([typeName, data]) => ({
    typeName,
    typeLabel: typeName,
    count: data.count,
    costUSD: Number(data.cost.toFixed(2)),
    percentage:
      totalResourcesCount > 0
        ? Number(((data.count / totalResourcesCount) * 100).toFixed(1))
        : 0,
    color: ACTION_TYPE_COLORS[typeName] || "#0078D4",
  }));

  const remediations = customRemediations || generateActionGroupsRecommendations(actionGroups);
  const potentialSavingsUSD = Number(
    remediations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    specializedCostUSD,
    totalResourcesCount,
    enabledCount,
    disabledCount,
    orphanCount,
    totalNotificationsMTD,
    failedNotificationsMTD,
    bouncedEmailsTotal,
    potentialSavingsUSD,
    breakdownByActionType,
  };
}

/**
 * Generates prioritized FinOps and governance recommendations
 */
export function generateActionGroupsRecommendations(
  actionGroups: ActionGroupResource[]
): ActionGroupRemediationAction[] {
  const actions: ActionGroupRemediationAction[] = [];

  for (const ag of actionGroups) {
    // Regla 1: Purga de Action Groups Huérfanos (0 alertas asociadas)
    if (ag.healthStatus === "Orphan" && ag.state === "Enabled") {
      actions.push({
        id: `rem-ag-orphan-${ag.id.split("/").pop()}`,
        resourceId: ag.id,
        resourceName: ag.name,
        params: { name: ag.name },
        category: "ORPHAN_PURGE",
        estimatedSavingsUSD: ag.specializedCostUSD || 0.00,
        confidence: "HIGH",
        actionType: "DELETE_ORPHAN_ACTION_GROUP",
        commandPayload: `az monitor action-group delete --name "${ag.name}" --resource-group "${ag.resourceGroup}"`,
      });
    }

    // Regla 2: Action Group sin destinatarios vinculado a alertas (Riesgo Crítico / Fuga Operativa)
    if (
      ag.emailReceiversCount === 0 &&
      ag.webhookReceiversCount === 0 &&
      ag.logicAppReceiversCount === 0 &&
      ag.functionReceiversCount === 0 &&
      ag.associatedAlertsCount > 0
    ) {
      actions.push({
        id: `rem-ag-empty-${ag.id.split("/").pop()}`,
        resourceId: ag.id,
        resourceName: ag.name,
        params: { name: ag.name, alerts: ag.associatedAlertsCount },
        category: "ADD_RECEIVERS",
        estimatedSavingsUSD: Number((ag.associatedAlertsCount * 0.10).toFixed(2)),
        confidence: "HIGH",
        actionType: "ADD_RECEIVERS_TO_ACTION_GROUP",
        commandPayload: `az monitor action-group update --name "${ag.name}" --resource-group "${ag.resourceGroup}" --add-action email ops-lead ops-team@company.com`,
      });
    }

    // Regla 3: Corrección de rebotes de email
    if (ag.bouncedEmailCount > 0) {
      actions.push({
        id: `rem-ag-bounce-${ag.id.split("/").pop()}`,
        resourceId: ag.id,
        resourceName: ag.name,
        params: { name: ag.name, bounces: ag.bouncedEmailCount },
        category: "FIX_BOUNCED_EMAILS",
        estimatedSavingsUSD: 0,
        confidence: "HIGH",
        actionType: "CLEAN_BOUNCED_EMAILS",
        commandPayload: `az monitor action-group show --name "${ag.name}" --resource-group "${ag.resourceGroup}"`,
      });
    }

    // Regla 4: Depuración de Webhooks / Logic Apps con fallas
    if (ag.failedWebhookCount > 0) {
      actions.push({
        id: `rem-ag-failed-webhook-${ag.id.split("/").pop()}`,
        resourceId: ag.id,
        resourceName: ag.name,
        params: { name: ag.name, failures: ag.failedWebhookCount },
        category: "ENDPOINT_DEBUG",
        estimatedSavingsUSD: Number((ag.failedWebhookCount * 0.001).toFixed(2)),
        confidence: "MEDIUM",
        actionType: "VALIDATE_WEBHOOK_ENDPOINT",
        commandPayload: `az monitor action-group test-notifications --action-group "${ag.name}" --resource-group "${ag.resourceGroup}" --alert-type "microsoft.insights/metricalerts"`,
      });
    }

    // Regla 5: Consolidación de múltiples emails individuales
    if (ag.emailReceiversCount >= 4) {
      actions.push({
        id: `rem-ag-consolidate-${ag.id.split("/").pop()}`,
        resourceId: ag.id,
        resourceName: ag.name,
        params: { receivers: ag.emailReceiversCount },
        category: "EMAIL_CONSOLIDATE",
        estimatedSavingsUSD: 0,
        confidence: "MEDIUM",
        actionType: "CONSOLIDATE_EMAILS",
      });
    }
  }

  return actions;
}

/**
 * Builds realistic synthetic dataset for Demo tenants
 */
export function getMockActionGroupsPayload(tenantId: string): ActionGroupsPayload {
  const isEnterprise = tenantId.includes("4444") || tenantId.includes("enterprise");
  const isBusiness = tenantId.includes("2222") || tenantId.includes("business");

  const sub1 = "00000000-0000-0000-0000-000000000001";
  const sub1Name = "Production Workloads";
  const sub2 = "00000000-0000-0000-0000-000000000002";
  const sub2Name = "Development & Testing";
  const sub3 = "00000000-0000-0000-0000-000000000003";
  const sub3Name = "Shared Core Services";

  const actionGroups: ActionGroupResource[] = [
    // 1. Prod Infra On-Call (Healthy Multi-Channel)
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/actionGroups/ag-infra-oncall`,
      name: "ag-infra-oncall",
      shortName: "InfraOnCall",
      location: "global",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      state: "Enabled",
      emailReceiversCount: 2,
      webhookReceiversCount: 1,
      logicAppReceiversCount: 0,
      functionReceiversCount: 0,
      smsReceiversCount: 1,
      specializedActionType: "MULTI",
      healthStatus: "Valid",
      specializedCostUSD: 1.20,
      totalRealCostUSD: 1.20,
      potentialSavingsUSD: 0,
      iswasteful: false,
      bouncedEmailCount: 0,
      failedWebhookCount: 0,
      totalNotificationsMTD: 142,
      associatedAlertsCount: 6,
      associatedAlertRuleNames: ["alert-vm-cpu-high", "smart-detector-failure-anomalies", "webtest-checkout-api-ping"],
      receivers: {
        emails: ["ops-lead@company.com", "infra-duty@company.com"],
        webhooks: [{ name: "PagerDuty Integration", serviceUri: "https://events.pagerduty.com/v2/enqueue", useAadAuth: false }],
        logicApps: [],
        azureFunctions: [],
        sms: [{ name: "SMS On-Call Lead", countryCode: "1", phoneNumber: "5550192834" }],
      },
    },
    // 2. Urgent Sev0 Escalation (Logic App Orchestration)
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/actionGroups/ag-urgent-sev0`,
      name: "ag-urgent-sev0",
      shortName: "UrgentSev0",
      location: "global",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      state: "Enabled",
      emailReceiversCount: 1,
      webhookReceiversCount: 1,
      logicAppReceiversCount: 1,
      functionReceiversCount: 0,
      smsReceiversCount: 2,
      specializedActionType: "LOGIC_APP",
      healthStatus: "Valid",
      specializedCostUSD: 4.80,
      totalRealCostUSD: 4.80,
      potentialSavingsUSD: 0,
      iswasteful: false,
      bouncedEmailCount: 0,
      failedWebhookCount: 0,
      totalNotificationsMTD: 28,
      associatedAlertsCount: 3,
      associatedAlertRuleNames: ["alert-kql-5xx-errors", "alert-firewall-snat-port-exhaustion"],
      receivers: {
        emails: ["c-level-alerts@company.com"],
        webhooks: [{ name: "Teams Urgent Channel", serviceUri: "https://outlook.office.com/webhook/teams-sev0", useAadAuth: true }],
        logicApps: [{ name: "AutoRemediation-ScaleOut", resourceId: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/Microsoft.Logic/workflows/la-autoscale-remediation` }],
        azureFunctions: [],
        sms: [{ name: "CTO Escalation", countryCode: "1", phoneNumber: "5550199999" }],
      },
    },
    // 3. Security CISO Escalation
    {
      id: `/subscriptions/${sub3}/resourceGroups/rg-security-core/providers/microsoft.insights/actionGroups/ag-secops-ciso`,
      name: "ag-secops-ciso",
      shortName: "SecOpsCISO",
      location: "global",
      resourceGroup: "rg-security-core",
      subscriptionId: sub3,
      subscriptionName: sub3Name,
      state: "Enabled",
      emailReceiversCount: 2,
      webhookReceiversCount: 1,
      logicAppReceiversCount: 0,
      functionReceiversCount: 1,
      smsReceiversCount: 0,
      specializedActionType: "AZURE_FUNCTION",
      healthStatus: "Valid",
      specializedCostUSD: 0.85,
      totalRealCostUSD: 0.85,
      potentialSavingsUSD: 0,
      iswasteful: false,
      bouncedEmailCount: 0,
      failedWebhookCount: 0,
      totalNotificationsMTD: 84,
      associatedAlertsCount: 2,
      associatedAlertRuleNames: ["alert-act-keyvault-delete"],
      receivers: {
        emails: ["ciso@company.com", "soc-level2@company.com"],
        webhooks: [{ name: "Sentinel SIEM Ingestion", serviceUri: "https://secops.sentinel.azure.com/alerts" }],
        logicApps: [],
        azureFunctions: [{ name: "fn-revoke-compromised-token", functionAppResourceId: `/subscriptions/${sub3}/resourceGroups/rg-security-core/providers/Microsoft.Web/sites/func-secops-tools`, functionName: "RevokeToken" }],
        sms: [],
      },
    },
    // 4. Orphan Action Group (0 Alert Associations)
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-legacy-apps/providers/microsoft.insights/actionGroups/ag-orphan-legacy-alerts`,
      name: "ag-orphan-legacy-alerts",
      shortName: "LegacyOrphan",
      location: "global",
      resourceGroup: "rg-legacy-apps",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      state: "Enabled",
      emailReceiversCount: 3,
      webhookReceiversCount: 0,
      logicAppReceiversCount: 0,
      functionReceiversCount: 0,
      smsReceiversCount: 0,
      specializedActionType: "EMAIL",
      healthStatus: "Orphan",
      specializedCostUSD: 0.00,
      totalRealCostUSD: 0.00,
      potentialSavingsUSD: 0.00,
      iswasteful: true,
      bouncedEmailCount: 0,
      failedWebhookCount: 0,
      totalNotificationsMTD: 0,
      associatedAlertsCount: 0,
      associatedAlertRuleNames: [],
      receivers: {
        emails: ["ex-employee1@company.com", "ex-employee2@company.com", "old-dev@company.com"],
        webhooks: [],
        logicApps: [],
        azureFunctions: [],
        sms: [],
      },
    },
    // 5. Action Group with Bounced Emails
    {
      id: `/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.insights/actionGroups/ag-dev-slack`,
      name: "ag-dev-slack",
      shortName: "DevSlack",
      location: "global",
      resourceGroup: "rg-dev-backend",
      subscriptionId: sub2,
      subscriptionName: sub2Name,
      state: "Enabled",
      emailReceiversCount: 4,
      webhookReceiversCount: 1,
      logicAppReceiversCount: 0,
      functionReceiversCount: 0,
      smsReceiversCount: 0,
      specializedActionType: "WEBHOOK",
      healthStatus: "Invalid_Bounces",
      specializedCostUSD: 0.40,
      totalRealCostUSD: 0.40,
      potentialSavingsUSD: 0,
      iswasteful: false,
      bouncedEmailCount: 2,
      failedWebhookCount: 0,
      totalNotificationsMTD: 310,
      associatedAlertsCount: 2,
      associatedAlertRuleNames: ["alert-kql-dev-exceptions-1m"],
      receivers: {
        emails: ["dev1@company.com", "bounced-contractor@external.com", "inactive-intern@company.com", "team-lead@company.com"],
        webhooks: [{ name: "Slack #dev-alerts", serviceUri: "https://hooks.slack.com/services/T00/B00/dev-alerts" }],
        logicApps: [],
        azureFunctions: [],
        sms: [],
      },
    },
    // 6. Action Group with Failing Webhook Endpoint
    {
      id: `/subscriptions/${sub3}/resourceGroups/rg-shared-storage/providers/microsoft.insights/actionGroups/ag-finops-leads`,
      name: "ag-finops-leads",
      shortName: "FinOpsLeads",
      location: "global",
      resourceGroup: "rg-shared-storage",
      subscriptionId: sub3,
      subscriptionName: sub3Name,
      state: "Enabled",
      emailReceiversCount: 1,
      webhookReceiversCount: 1,
      logicAppReceiversCount: 0,
      functionReceiversCount: 0,
      smsReceiversCount: 0,
      specializedActionType: "WEBHOOK",
      healthStatus: "Invalid_Endpoint_Error",
      specializedCostUSD: 0.35,
      totalRealCostUSD: 0.35,
      potentialSavingsUSD: 0.02,
      iswasteful: false,
      bouncedEmailCount: 0,
      failedWebhookCount: 18,
      totalNotificationsMTD: 52,
      associatedAlertsCount: 1,
      associatedAlertRuleNames: ["alert-kql-storage-egress-spike"],
      receivers: {
        emails: ["finops-lead@company.com"],
        webhooks: [{ name: "CostOps Automation Webhook", serviceUri: "https://api.costops.internal/v1/webhook-expired" }],
        logicApps: [],
        azureFunctions: [],
        sms: [],
      },
    },
    // 7. Empty Action Group (Silent Alarms)
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/actionGroups/ag-unconfigured-silent`,
      name: "ag-unconfigured-silent",
      shortName: "SilentAG",
      location: "global",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      state: "Enabled",
      emailReceiversCount: 0,
      webhookReceiversCount: 0,
      logicAppReceiversCount: 0,
      functionReceiversCount: 0,
      smsReceiversCount: 0,
      specializedActionType: "NO_RECIPIENTS",
      healthStatus: "Orphan",
      specializedCostUSD: 0.00,
      totalRealCostUSD: 0.00,
      potentialSavingsUSD: 0.20,
      iswasteful: true,
      bouncedEmailCount: 0,
      failedWebhookCount: 0,
      totalNotificationsMTD: 0,
      associatedAlertsCount: 2,
      associatedAlertRuleNames: ["alert-redis-memory-silent", "alert-orphan-sql-dtu-legacy"],
      receivers: {
        emails: [],
        webhooks: [],
        logicApps: [],
        azureFunctions: [],
        sms: [],
      },
    },
    // 8. Disabled Action Group
    {
      id: `/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.insights/actionGroups/ag-dev-maintenance-disabled`,
      name: "ag-dev-maintenance-disabled",
      shortName: "DevMaint",
      location: "global",
      resourceGroup: "rg-dev-backend",
      subscriptionId: sub2,
      subscriptionName: sub2Name,
      state: "Disabled",
      emailReceiversCount: 1,
      webhookReceiversCount: 0,
      logicAppReceiversCount: 0,
      functionReceiversCount: 0,
      smsReceiversCount: 0,
      specializedActionType: "EMAIL",
      healthStatus: "Orphan",
      specializedCostUSD: 0.00,
      totalRealCostUSD: 0.00,
      potentialSavingsUSD: 0,
      iswasteful: false,
      bouncedEmailCount: 0,
      failedWebhookCount: 0,
      totalNotificationsMTD: 0,
      associatedAlertsCount: 0,
      associatedAlertRuleNames: [],
      receivers: {
        emails: ["dev-oncall@company.com"],
        webhooks: [],
        logicApps: [],
        azureFunctions: [],
        sms: [],
      },
    },
  ];

  if (isEnterprise || isBusiness) {
    actionGroups.push({
      id: `/subscriptions/${sub3}/resourceGroups/rg-shared-networking/providers/microsoft.insights/actionGroups/ag-netops-247`,
      name: "ag-netops-247",
      shortName: "NetOps247",
      location: "global",
      resourceGroup: "rg-shared-networking",
      subscriptionId: sub3,
      subscriptionName: sub3Name,
      state: "Enabled",
      emailReceiversCount: 2,
      webhookReceiversCount: 1,
      logicAppReceiversCount: 1,
      functionReceiversCount: 0,
      smsReceiversCount: 2,
      specializedActionType: "MULTI",
      healthStatus: "Valid",
      specializedCostUSD: 2.40,
      totalRealCostUSD: 2.40,
      potentialSavingsUSD: 0,
      iswasteful: false,
      bouncedEmailCount: 0,
      failedWebhookCount: 0,
      totalNotificationsMTD: 96,
      associatedAlertsCount: 1,
      associatedAlertRuleNames: ["alert-firewall-snat-port-exhaustion"],
      receivers: {
        emails: ["netops-escalations@company.com", "telecom@company.com"],
        webhooks: [{ name: "ServiceNow Incident Creation", serviceUri: "https://company.service-now.com/api/v1/incidents" }],
        logicApps: [{ name: "la-notify-noc-teams", resourceId: `/subscriptions/${sub3}/resourceGroups/rg-shared-networking/providers/Microsoft.Logic/workflows/la-notify-noc-teams` }],
        azureFunctions: [],
        sms: [{ name: "NOC Senior OnCall", countryCode: "1", phoneNumber: "5550183920" }],
      },
    });
  }

  const remediations = generateActionGroupsRecommendations(actionGroups);
  const summary = calculateActionGroupsSummary(actionGroups, remediations);

  // Daily trend
  const dailyTrend: ActionGroupDailyTrendPoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split("T")[0];
    const notif = Math.floor(22 + Math.sin(i / 3) * 8 + (i % 7 === 0 ? 12 : 0));
    const failed = i % 4 === 0 ? Math.floor(1 + (i % 3)) : 0;
    const bounces = i % 6 === 0 ? 1 : 0;

    dailyTrend.push({
      date: dateStr,
      notificationsCount: notif,
      failedCount: failed,
      bouncesCount: bounces,
    });
  }

  return {
    summary,
    actionGroups,
    remediations,
    dailyTrend,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: [sub1, sub2, sub3],
  };
}

/**
 * Fetches real Azure Action Groups via Azure Resource Graph
 */
export async function fetchLiveActionGroupsData(tenantId: string): Promise<ActionGroupsPayload> {
  try {
    const credentials = await getAzureCredential(tenantId);
    if (!credentials) {
      return {
        summary: {
          specializedCostUSD: 0,
          totalResourcesCount: 0,
          enabledCount: 0,
          disabledCount: 0,
          orphanCount: 0,
          totalNotificationsMTD: 0,
          failedNotificationsMTD: 0,
          bouncedEmailsTotal: 0,
          potentialSavingsUSD: 0,
          breakdownByActionType: [],
        },
        actionGroups: [],
        remediations: [],
        dailyTrend: [],
        source: "live",
        lastUpdated: new Date().toISOString(),
      };
    }

    const subMap = await getSubscriptionNameMap(tenantId, credentials).catch(() => new Map<string, string>());
    const client = await getResourceGraphClient(tenantId);

    // 1. Fetch Action Groups
    const agQuery = `
      resources
      | where type =~ 'microsoft.insights/actiongroups'
      | project id, name, location, resourceGroup, subscriptionId, tags, properties
    `;

    // 2. Fetch Alert Rules for correlation
    const alertsQuery = `
      resources
      | where type in~ (
          'microsoft.insights/metricalerts',
          'microsoft.insights/scheduledqueryrules',
          'microsoft.insights/activitylogalerts'
        )
      | project id, name, properties
    `;

    const [agResponse, alertsResponse] = await withArgLimit(async () => {
      return await Promise.all([
        client.resources({ query: agQuery }),
        client.resources({ query: alertsQuery }),
      ]);
    });

    const agRows: any[] = agResponse.data || [];
    const alertRows: any[] = alertsResponse.data || [];

    if (agRows.length === 0) {
      return {
        summary: {
          specializedCostUSD: 0,
          totalResourcesCount: 0,
          enabledCount: 0,
          disabledCount: 0,
          orphanCount: 0,
          totalNotificationsMTD: 0,
          failedNotificationsMTD: 0,
          bouncedEmailsTotal: 0,
          potentialSavingsUSD: 0,
          breakdownByActionType: [],
        },
        actionGroups: [],
        remediations: [],
        dailyTrend: [],
        source: "live",
        lastUpdated: new Date().toISOString(),
        availableSubscriptions: Object.keys(subMap),
      };
    }

    // Build association index: map normalized actionGroupId -> Array of Alert Names
    const alertAssociationMap = new Map<string, string[]>();
    for (const alt of alertRows) {
      const altProps = alt.properties || {};
      const actions = altProps.actions || [];
      const agIds: string[] = Array.isArray(actions.actionGroups)
        ? actions.actionGroups.map((ag: any) => (typeof ag === "string" ? ag : ag.actionGroupId || ""))
        : Array.isArray(actions)
        ? actions.map((ag: any) => (typeof ag === "string" ? ag : ag.actionGroupId || ""))
        : [];

      for (const agId of agIds) {
        if (!agId) continue;
        const normalized = agId.toLowerCase();
        const existing = alertAssociationMap.get(normalized) || [];
        existing.push(alt.name);
        alertAssociationMap.set(normalized, existing);
      }
    }

    const actionGroups: ActionGroupResource[] = agRows.map((r: any) => {
      const props = r.properties || {};
      const isEnabled = props.enabled !== false && props.state !== "Disabled";

      const emails: string[] = (props.emailReceivers || []).map((e: any) => e.emailAddress || e.name || "");
      const webhooks: any[] = (props.webhookReceivers || []).map((w: any) => ({
        name: w.name || "Webhook",
        serviceUri: redactReceiverUri(w.serviceUri),
        useAadAuth: !!w.useAadAuth,
      }));
      // callbackUrl se descarta deliberadamente: lleva la firma SAS del trigger
      // del Logic App y la UI solo necesita name + resourceId.
      const logicApps: any[] = (props.logicAppReceivers || []).map((l: any) => ({
        name: l.name || "Logic App",
        resourceId: l.resourceId || "",
      }));
      const functions: any[] = (props.azureFunctionReceivers || []).map((f: any) => ({
        name: f.name || "Azure Function",
        functionAppResourceId: f.functionAppResourceId || "",
        functionName: f.functionName || "",
      }));
      const sms: any[] = (props.smsReceivers || []).map((s: any) => ({
        name: s.name || "SMS",
        countryCode: s.countryCode || "",
        phoneNumber: s.phoneNumber || "",
      }));

      const specializedActionType = deriveActionType(
        emails.length,
        webhooks.length,
        logicApps.length,
        functions.length,
        sms.length
      );

      const associatedAlerts = alertAssociationMap.get(r.id.toLowerCase()) || [];
      const associatedAlertsCount = associatedAlerts.length;

      let healthStatus: ActionGroupHealthStatus = "Valid";
      if (associatedAlertsCount === 0) {
        healthStatus = "Orphan";
      }

      // Compute estimated specialized cost (Logic Apps/Functions invocations)
      const logicAppsCost = logicApps.length * 0.50;
      const functionsCost = functions.length * 0.25;
      const webhooksCost = webhooks.length * 0.15;
      const specializedCostUSD = Number((logicAppsCost + functionsCost + webhooksCost).toFixed(2));

      return {
        id: r.id,
        name: r.name,
        shortName: props.groupShortName || r.name,
        location: r.location || "global",
        resourceGroup: r.resourceGroup || "default",
        subscriptionId: r.subscriptionId,
        subscriptionName: resolveSubscriptionName(r.subscriptionId, subMap),
        state: isEnabled ? "Enabled" : "Disabled",
        emailReceiversCount: emails.length,
        webhookReceiversCount: webhooks.length,
        logicAppReceiversCount: logicApps.length,
        functionReceiversCount: functions.length,
        smsReceiversCount: sms.length,
        specializedActionType,
        healthStatus,
        specializedCostUSD,
        totalRealCostUSD: specializedCostUSD,
        potentialSavingsUSD: healthStatus === "Orphan" ? specializedCostUSD : 0,
        iswasteful: healthStatus === "Orphan",
        bouncedEmailCount: 0,
        failedWebhookCount: 0,
        totalNotificationsMTD: 0,
        associatedAlertsCount,
        associatedAlertRuleNames: associatedAlerts,
        receivers: {
          emails,
          webhooks,
          logicApps,
          azureFunctions: functions,
          sms,
        },
        tags: r.tags || {},
      };
    });

    const remediations = generateActionGroupsRecommendations(actionGroups);
    const summary = calculateActionGroupsSummary(actionGroups, remediations);

    return {
      summary,
      actionGroups,
      remediations,
      dailyTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions: Object.keys(subMap),
    };
  } catch (error) {
    console.error("[azureActionGroupsService] Error fetching live Action Groups:", error);
    return {
      summary: {
        specializedCostUSD: 0,
        totalResourcesCount: 0,
        enabledCount: 0,
        disabledCount: 0,
        orphanCount: 0,
        totalNotificationsMTD: 0,
        failedNotificationsMTD: 0,
        bouncedEmailsTotal: 0,
        potentialSavingsUSD: 0,
        breakdownByActionType: [],
      },
      actionGroups: [],
      remediations: [],
      dailyTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  }
}

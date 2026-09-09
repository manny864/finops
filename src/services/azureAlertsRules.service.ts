/**
 * Azure Alert Rules Management & FinOps Governance Service
 *
 * Implements ARG discovery of all Azure alert types:
 * - Metric Alerts (microsoft.insights/metricalerts)
 * - Scheduled Query Rules / Log Search KQL (microsoft.insights/scheduledqueryrules)
 * - Activity Log Alerts (microsoft.insights/activitylogalerts)
 * - Smart Detector Alert Rules (microsoft.alertsmanagement/smartdetectoralertrules)
 * - Web Tests (microsoft.insights/webtests)
 *
 * Evaluates cost attribution, orphan scopes, evaluation frequency efficiency,
 * action group bindings, and generates prioritized FinOps remediation actions.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import type {
  AlertRuleResource,
  AlertRuleType,
  AlertSeverity,
  AlertsSummaryMetrics,
  AlertTypeBreakdownItem,
  AlertRemediationAction,
  AlertsPayload,
} from "@/types/azureAlerts.types";

export const METRIC_ALERT_BASE_RATE = 0.10; // $0.10/metric evaluated/month
export const SCHEDULED_QUERY_RATE_1M = 1.50; // $1.50/rule/month for 1m frequency
export const SCHEDULED_QUERY_RATE_5M = 0.50; // $0.50/rule/month for 5m+ frequency
export const SCHEDULED_QUERY_RATE_1H = 0.10; // $0.10/rule/month for 1h+ frequency
export const WEB_TEST_BASE_RATE = 1.00; // $1.00/test/month
export const ACTIVITY_LOG_BASE_RATE = 0.00; // Free
export const SMART_DETECTOR_BASE_RATE = 0.00; // Included in Application Insights

export const ALERT_TYPE_COLORS: Record<AlertRuleType, string> = {
  metric: "#0078D4", // Corporate Deep Blue
  scheduledQuery: "#2563EB", // Cobalt Blue
  activityLog: "#0284C7", // Cyan Blue
  smartDetector: "#38BDF8", // Sky Blue
  webTest: "#0EA5E9", // Vibrant Blue
};

export const ALERT_TYPE_DISPLAY_NAMES: Record<AlertRuleType, string> = {
  metric: "Alerta de Métrica",
  scheduledQuery: "Búsqueda en Logs (KQL)",
  activityLog: "Registro de Actividad",
  smartDetector: "Smart Detector (IA)",
  webTest: "Prueba Web (App Insights)",
};

/**
 * Maps raw Azure resource type to normalized AlertRuleType
 */
export function mapAzureTypeToAlertType(rawType: string): AlertRuleType {
  const lower = (rawType || "").toLowerCase();
  if (lower.includes("metricalert")) return "metric";
  if (lower.includes("scheduledqueryrule")) return "scheduledQuery";
  if (lower.includes("activitylogalert")) return "activityLog";
  if (lower.includes("smartdetector")) return "smartDetector";
  if (lower.includes("webtest")) return "webTest";
  return "metric";
}

/**
 * Calculates rule monthly cost based on type and frequency
 */
export function calculateAlertMonthlyCost(
  type: AlertRuleType,
  frequency: string,
  isEnabled: boolean
): number {
  if (!isEnabled) return 0.00;
  if (type === "metric") return METRIC_ALERT_BASE_RATE;
  if (type === "webTest") return WEB_TEST_BASE_RATE;
  if (type === "activityLog" || type === "smartDetector") return 0.00;

  if (type === "scheduledQuery") {
    const fLower = (frequency || "").toLowerCase();
    if (fLower.includes("1m") || fLower === "pt1m" || fLower.includes("1 min")) {
      return SCHEDULED_QUERY_RATE_1M;
    }
    if (fLower.includes("1h") || fLower === "pt1h" || fLower.includes("1 hour") || fLower.includes("1d")) {
      return SCHEDULED_QUERY_RATE_1H;
    }
    return SCHEDULED_QUERY_RATE_5M;
  }

  return 0.10;
}

/**
 * Summarizes alerts metrics and builds breakdown by type
 */
export function calculateAlertsSummary(
  alerts: AlertRuleResource[],
  customRemediations?: AlertRemediationAction[]
): AlertsSummaryMetrics {
  const totalAlertsCount = alerts.length;
  const enabledCount = alerts.filter((a) => a.isEnabled).length;
  const disabledCount = alerts.filter((a) => !a.isEnabled).length;
  const firingLast24hCount = alerts.filter((a) => a.isFiring).length;
  const orphanCount = alerts.filter((a) => a.isOrphan).length;
  const inefficientCount = alerts.filter((a) => a.isInefficient).length;

  const totalMonthlyCostUSD = Number(
    alerts.reduce((sum, a) => sum + (a.isEnabled ? a.monthlyCostUSD : 0), 0).toFixed(2)
  );

  const typeMap = new Map<AlertRuleType, { count: number; cost: number }>();
  for (const alert of alerts) {
    const current = typeMap.get(alert.alertType) || { count: 0, cost: 0 };
    typeMap.set(alert.alertType, {
      count: current.count + 1,
      cost: current.cost + (alert.isEnabled ? alert.monthlyCostUSD : 0),
    });
  }

  const allTypes: AlertRuleType[] = ["metric", "scheduledQuery", "activityLog", "smartDetector", "webTest"];
  const breakdownByType: AlertTypeBreakdownItem[] = allTypes.map((t) => {
    const data = typeMap.get(t) || { count: 0, cost: 0 };
    return {
      typeName: t,
      typeLabel: ALERT_TYPE_DISPLAY_NAMES[t],
      count: data.count,
      costUSD: Number(data.cost.toFixed(2)),
      percentage:
        totalMonthlyCostUSD > 0
          ? Number(((data.cost / totalMonthlyCostUSD) * 100).toFixed(1))
          : 0,
      color: ALERT_TYPE_COLORS[t],
    };
  });

  const remediations = customRemediations || generateAlertsRecommendations(alerts);
  const potentialSavingsUSD = Number(
    remediations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    totalMonthlyCostUSD,
    totalAlertsCount,
    enabledCount,
    disabledCount,
    firingLast24hCount,
    orphanCount,
    inefficientCount,
    potentialSavingsUSD,
    breakdownByType,
  };
}

/**
 * Generates prioritized FinOps and governance remediation actions
 */
export function generateAlertsRecommendations(
  alerts: AlertRuleResource[]
): AlertRemediationAction[] {
  const actions: AlertRemediationAction[] = [];

  for (const alert of alerts) {
    // Regla 1: Alertas Huérfanas (Apuntando a recursos eliminados o scopes vacíos)
    if (alert.isOrphan && alert.isEnabled) {
      actions.push({
        id: `rem-alert-orphan-${alert.id.split("/").pop()}`,
        ruleId: alert.id,
        ruleName: alert.name,
        params: {
          name: alert.name,
          cost: alert.monthlyCostUSD.toFixed(2),
          target: alert.targetResourceName || alert.targetResourceId,
        },
        category: "PURGE_ORPHAN",
        estimatedSavingsUSD: alert.monthlyCostUSD,
        confidence: "HIGH",
        actionType: "DELETE_ORPHAN_RULE",
        commandPayload: `az monitor ${alert.alertType === "scheduledQuery" ? "scheduled-query" : "metrics alert"} delete --name "${alert.name}" --resource-group "${alert.resourceGroup}" --yes`,
      });
    }

    // Regla 2: Frecuencia excesiva en ambientes Dev/Test o no productivos (1m -> 5m/15m)
    if (
      alert.alertType === "scheduledQuery" &&
      alert.isEnabled &&
      !alert.isOrphan &&
      (alert.resourceGroup.toLowerCase().includes("dev") ||
        alert.resourceGroup.toLowerCase().includes("test") ||
        alert.subscriptionName.toLowerCase().includes("dev") ||
        alert.subscriptionName.toLowerCase().includes("test")) &&
      (alert.evaluationFrequency === "1m" || alert.evaluationFrequency === "PT1M")
    ) {
      const currentCost = SCHEDULED_QUERY_RATE_1M;
      const targetCost = SCHEDULED_QUERY_RATE_5M;
      const savings = Number((currentCost - targetCost).toFixed(2));

      actions.push({
        id: `rem-alert-freq-${alert.id.split("/").pop()}`,
        ruleId: alert.id,
        ruleName: alert.name,
        params: { name: alert.name, rg: alert.resourceGroup },
        category: "ADJUST_FREQUENCY",
        estimatedSavingsUSD: savings,
        confidence: "HIGH",
        actionType: "UPDATE_EVALUATION_FREQUENCY",
        currentFrequency: "1m",
        recommendedFrequency: "5m",
        commandPayload: `az monitor scheduled-query update --name "${alert.name}" --resource-group "${alert.resourceGroup}" --evaluation-frequency 5m --window-size 15m`,
      });
    }

    // Regla 3: Alertas activas sin ningún Action Group asignado (Silenciosas)
    if (
      alert.isEnabled &&
      !alert.isOrphan &&
      alert.actionGroupIds.length === 0 &&
      alert.severity !== "Sev4"
    ) {
      actions.push({
        id: `rem-alert-silent-${alert.id.split("/").pop()}`,
        ruleId: alert.id,
        ruleName: alert.name,
        params: { name: alert.name, severity: alert.severity },
        category: "ASSIGN_ACTION_GROUP",
        estimatedSavingsUSD: 0,
        confidence: "MEDIUM",
        actionType: "ATTACH_ACTION_GROUP",
        commandPayload: `az monitor metrics alert update --name "${alert.name}" --resource-group "${alert.resourceGroup}" --add-action-group "/subscriptions/${alert.subscriptionId}/resourceGroups/${alert.resourceGroup}/providers/microsoft.insights/actionGroups/ag-default-finops"`,
      });
    }
  }

  return actions;
}

/**
 * Builds synthetic / mock dataset for Demo tenants
 */
export function getMockAlertsPayload(tenantId: string): AlertsPayload {
  const isEnterprise = tenantId.includes("4444") || tenantId.includes("enterprise");
  const isBusiness = tenantId.includes("2222") || tenantId.includes("business");

  const sub1 = "00000000-0000-0000-0000-000000000001";
  const sub1Name = "Production Workloads";
  const sub2 = "00000000-0000-0000-0000-000000000002";
  const sub2Name = "Development & Testing";
  const sub3 = "00000000-0000-0000-0000-000000000003";
  const sub3Name = "Shared Core Services";

  const alerts: AlertRuleResource[] = [
    // 1. High CPU Metric Alert
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/metricalerts/alert-vm-cpu-high`,
      name: "alert-vm-cpu-high",
      alertType: "metric",
      alertTypeDisplayName: "Alerta de Métrica",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      isEnabled: true,
      severity: "Sev1",
      targetResourceId: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.compute/virtualmachines/vm-app-prod-01`,
      targetResourceName: "vm-app-prod-01",
      targetResourceType: "Microsoft.Compute/virtualMachines",
      evaluationFrequency: "1m",
      windowSize: "5m",
      conditionSummary: "Average Percentage CPU > 85% durante 5 min",
      actionGroupIds: [`/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/actionGroups/ag-infra-oncall`],
      actionGroupNames: ["ag-infra-oncall (Email, PagerDuty, Webhook)"],
      lastFiredTimestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      isFiring: true,
      monthlyCostUSD: 0.10,
      isOrphan: false,
      isInefficient: false,
      firingHistory: [
        { timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), status: "Firing", descriptionKey: "hist_cpuHigh" },
        { timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), status: "Resolved", descriptionKey: "hist_cpuNormalized" },
        { timestamp: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(), status: "Firing", descriptionKey: "hist_cyberMondayPeak" },
      ],
    },
    // 2. Scheduled Query Rule - High Error Rate KQL
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/scheduledqueryrules/alert-kql-5xx-errors`,
      name: "alert-kql-5xx-errors",
      alertType: "scheduledQuery",
      alertTypeDisplayName: "Búsqueda en Logs (KQL)",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      isEnabled: true,
      severity: "Sev0",
      targetResourceId: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.operationalinsights/workspaces/law-ecommerce-prod`,
      targetResourceName: "law-ecommerce-prod",
      targetResourceType: "Microsoft.OperationalInsights/workspaces",
      evaluationFrequency: "5m",
      windowSize: "15m",
      conditionSummary: "Conteo de errores HTTP 5xx > 25 eventos en 15m",
      queryKql: `AppRequests\n| where TimeGenerated > ago(15m)\n| where toint(ResultCode) >= 500\n| summarize ErrorCount = count() by bin(TimeGenerated, 5m), OperationName\n| where ErrorCount > 25`,
      actionGroupIds: [`/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/actionGroups/ag-urgent-sev0`],
      actionGroupNames: ["ag-urgent-sev0 (Voice Call, SMS, Teams Webhook)"],
      lastFiredTimestamp: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
      isFiring: false,
      monthlyCostUSD: 0.50,
      isOrphan: false,
      isInefficient: false,
      firingHistory: [
        { timestamp: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(), status: "Resolved", descriptionKey: "hist_errorRateStable" },
        { timestamp: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(), status: "Firing", descriptionKey: "hist_badGateway" },
      ],
    },
    // 3. Activity Log Alert - Unauthorized Key Vault Access
    {
      id: `/subscriptions/${sub3}/resourceGroups/rg-security-core/providers/microsoft.insights/activitylogalerts/alert-act-keyvault-delete`,
      name: "alert-act-keyvault-delete",
      alertType: "activityLog",
      alertTypeDisplayName: "Registro de Actividad",
      location: "global",
      resourceGroup: "rg-security-core",
      subscriptionId: sub3,
      subscriptionName: sub3Name,
      isEnabled: true,
      severity: "Sev0",
      targetResourceId: `/subscriptions/${sub3}`,
      targetResourceName: "Subscription Security Scope",
      targetResourceType: "Microsoft.Resources/subscriptions",
      evaluationFrequency: "Real-time",
      windowSize: "Instant",
      conditionSummary: "Administrative Operation: Microsoft.KeyVault/vaults/delete",
      actionGroupIds: [`/subscriptions/${sub3}/resourceGroups/rg-security-core/providers/microsoft.insights/actionGroups/ag-secops-ciso`],
      actionGroupNames: ["ag-secops-ciso (Email CISO, Sentinel Incident Trigger)"],
      isFiring: false,
      monthlyCostUSD: 0.00,
      isOrphan: false,
      isInefficient: false,
    },
    // 4. Orphan Metric Alert (Pointing to deleted database)
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-legacy-apps/providers/microsoft.insights/metricalerts/alert-orphan-sql-dtu-legacy`,
      name: "alert-orphan-sql-dtu-legacy",
      alertType: "metric",
      alertTypeDisplayName: "Alerta de Métrica",
      location: "centralus",
      resourceGroup: "rg-legacy-apps",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      isEnabled: true,
      severity: "Sev2",
      targetResourceId: `/subscriptions/${sub1}/resourceGroups/rg-legacy-apps/providers/microsoft.sql/servers/sql-legacy-crm/databases/db-crm-archive-deleted`,
      targetResourceName: "db-crm-archive-deleted (Eliminado)",
      targetResourceType: "Microsoft.Sql/servers/databases",
      evaluationFrequency: "1m",
      windowSize: "5m",
      conditionSummary: "Average DTU consumption percentage > 90%",
      actionGroupIds: [],
      actionGroupNames: [],
      monthlyCostUSD: 0.10,
      isOrphan: true,
      isInefficient: true,
    },
    // 5. Scheduled Query Alert in Dev with 1m frequency (Inefficient)
    {
      id: `/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.insights/scheduledqueryrules/alert-kql-dev-exceptions-1m`,
      name: "alert-kql-dev-exceptions-1m",
      alertType: "scheduledQuery",
      alertTypeDisplayName: "Búsqueda en Logs (KQL)",
      location: "westus2",
      resourceGroup: "rg-dev-backend",
      subscriptionId: sub2,
      subscriptionName: sub2Name,
      isEnabled: true,
      severity: "Sev3",
      targetResourceId: `/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.insights/components/appi-dev-backend`,
      targetResourceName: "appi-dev-backend",
      targetResourceType: "Microsoft.Insights/components",
      evaluationFrequency: "1m",
      windowSize: "5m",
      conditionSummary: "Excepciones en App Insights > 10 por minuto",
      queryKql: `AppExceptions\n| where TimeGenerated > ago(5m)\n| summarize Count = count() by ProblemId\n| where Count > 10`,
      actionGroupIds: [`/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.insights/actionGroups/ag-dev-slack`],
      actionGroupNames: ["ag-dev-slack (Slack Channel #dev-alerts)"],
      monthlyCostUSD: 1.50,
      isOrphan: false,
      isInefficient: true,
    },
    // 6. Smart Detector Alert Rule
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.alertsmanagement/smartdetectoralertrules/smart-detector-failure-anomalies`,
      name: "smart-detector-failure-anomalies",
      alertType: "smartDetector",
      alertTypeDisplayName: "Smart Detector (IA)",
      location: "global",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      isEnabled: true,
      severity: "Sev1",
      targetResourceId: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/components/appi-ecommerce-prod`,
      targetResourceName: "appi-ecommerce-prod",
      targetResourceType: "Microsoft.Insights/components",
      evaluationFrequency: "Dynamic ML",
      windowSize: "Auto (Rolling 24h)",
      conditionSummary: "Anomalía de tasa de fallo detectada por Machine Learning (Failure Anomalies)",
      actionGroupIds: [`/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/actionGroups/ag-infra-oncall`],
      actionGroupNames: ["ag-infra-oncall (Email, PagerDuty, Webhook)"],
      monthlyCostUSD: 0.00,
      isOrphan: false,
      isInefficient: false,
    },
    // 7. Web Test Availability Alert
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/webtests/webtest-checkout-api-ping`,
      name: "webtest-checkout-api-ping",
      alertType: "webTest",
      alertTypeDisplayName: "Prueba Web (App Insights)",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      isEnabled: true,
      severity: "Sev1",
      targetResourceId: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/components/appi-ecommerce-prod`,
      targetResourceName: "appi-ecommerce-prod",
      targetResourceType: "Microsoft.Insights/components",
      evaluationFrequency: "5m",
      windowSize: "5m",
      conditionSummary: "Fallo en > 2 ubicaciones geográficas de ping test",
      actionGroupIds: [`/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/actionGroups/ag-infra-oncall`],
      actionGroupNames: ["ag-infra-oncall (Email, PagerDuty, Webhook)"],
      monthlyCostUSD: 1.00,
      isOrphan: false,
      isInefficient: false,
    },
    // 8. Silent Metric Alert (No Action Group assigned)
    {
      id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/metricalerts/alert-redis-memory-silent`,
      name: "alert-redis-memory-silent",
      alertType: "metric",
      alertTypeDisplayName: "Alerta de Métrica",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: sub1,
      subscriptionName: sub1Name,
      isEnabled: true,
      severity: "Sev2",
      targetResourceId: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.cache/redis/redis-cache-catalog`,
      targetResourceName: "redis-cache-catalog",
      targetResourceType: "Microsoft.Cache/Redis",
      evaluationFrequency: "5m",
      windowSize: "15m",
      conditionSummary: "usedmemorypercentage > 80% durante 15m",
      actionGroupIds: [],
      actionGroupNames: [],
      monthlyCostUSD: 0.10,
      isOrphan: false,
      isInefficient: true,
    },
    // 9. Disabled Metric Alert (Testing)
    {
      id: `/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.insights/metricalerts/alert-appservice-http-dev`,
      name: "alert-appservice-http-dev",
      alertType: "metric",
      alertTypeDisplayName: "Alerta de Métrica",
      location: "westus2",
      resourceGroup: "rg-dev-backend",
      subscriptionId: sub2,
      subscriptionName: sub2Name,
      isEnabled: false,
      severity: "Sev3",
      targetResourceId: `/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.web/sites/app-dev-api`,
      targetResourceName: "app-dev-api",
      targetResourceType: "Microsoft.Web/sites",
      evaluationFrequency: "15m",
      windowSize: "15m",
      conditionSummary: "Http5xx > 10 eventos",
      actionGroupIds: [],
      actionGroupNames: [],
      monthlyCostUSD: 0.00,
      isOrphan: false,
      isInefficient: false,
    },
    // 10. Storage Egress Scheduled Query Rule
    {
      id: `/subscriptions/${sub3}/resourceGroups/rg-shared-storage/providers/microsoft.insights/scheduledqueryrules/alert-kql-storage-egress-spike`,
      name: "alert-kql-storage-egress-spike",
      alertType: "scheduledQuery",
      alertTypeDisplayName: "Búsqueda en Logs (KQL)",
      location: "eastus2",
      resourceGroup: "rg-shared-storage",
      subscriptionId: sub3,
      subscriptionName: sub3Name,
      isEnabled: true,
      severity: "Sev2",
      targetResourceId: `/subscriptions/${sub3}/resourceGroups/rg-shared-storage/providers/microsoft.operationalinsights/workspaces/law-shared-core`,
      targetResourceName: "law-shared-core",
      targetResourceType: "Microsoft.OperationalInsights/workspaces",
      evaluationFrequency: "15m",
      windowSize: "1h",
      conditionSummary: "Egress acumulado en Azure Blob Storage > 500 GB en 1 hora",
      queryKql: `StorageBlobLogs\n| where TimeGenerated > ago(1h)\n| where Category == 'StorageRead'\n| summarize TotalEgressBytes = sum(ResponseBodySize) by bin(TimeGenerated, 15m), AccountName\n| where TotalEgressBytes > 536870912000`,
      actionGroupIds: [`/subscriptions/${sub3}/resourceGroups/rg-shared-storage/providers/microsoft.insights/actionGroups/ag-finops-leads`],
      actionGroupNames: ["ag-finops-leads (Email FinOps Lead, Webhook CostOps)"],
      monthlyCostUSD: 0.50,
      isOrphan: false,
      isInefficient: false,
    },
  ];

  // If Enterprise tier, add more realistic alerts across diverse workloads
  if (isEnterprise || isBusiness) {
    alerts.push(
      {
        id: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/metricalerts/alert-aks-node-cpu`,
        name: "alert-aks-node-cpu",
        alertType: "metric",
        alertTypeDisplayName: "Alerta de Métrica",
        location: "eastus2",
        resourceGroup: "rg-ecommerce-prod",
        subscriptionId: sub1,
        subscriptionName: sub1Name,
        isEnabled: true,
        severity: "Sev1",
        targetResourceId: `/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.containerservice/managedclusters/aks-prod-cluster`,
        targetResourceName: "aks-prod-cluster",
        targetResourceType: "Microsoft.ContainerService/managedClusters",
        evaluationFrequency: "1m",
        windowSize: "5m",
        conditionSummary: "Node CPU utilization > 80% en cualquier nodo del cluster",
        actionGroupIds: [`/subscriptions/${sub1}/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/actionGroups/ag-infra-oncall`],
        actionGroupNames: ["ag-infra-oncall"],
        monthlyCostUSD: 0.10,
        isOrphan: false,
        isInefficient: false,
      },
      {
        id: `/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.insights/scheduledqueryrules/alert-orphan-kql-old-container`,
        name: "alert-orphan-kql-old-container",
        alertType: "scheduledQuery",
        alertTypeDisplayName: "Búsqueda en Logs (KQL)",
        location: "westus2",
        resourceGroup: "rg-dev-backend",
        subscriptionId: sub2,
        subscriptionName: sub2Name,
        isEnabled: true,
        severity: "Sev3",
        targetResourceId: `/subscriptions/${sub2}/resourceGroups/rg-dev-backend/providers/microsoft.app/containerapps/ca-deprecated-service`,
        targetResourceName: "ca-deprecated-service (Eliminado)",
        targetResourceType: "Microsoft.App/containerApps",
        evaluationFrequency: "5m",
        windowSize: "15m",
        conditionSummary: "Logs de Container App huérfano",
        queryKql: `ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-deprecated-service'`,
        actionGroupIds: [],
        actionGroupNames: [],
        monthlyCostUSD: 0.50,
        isOrphan: true,
        isInefficient: true,
      },
      {
        id: `/subscriptions/${sub3}/resourceGroups/rg-shared-networking/providers/microsoft.insights/metricalerts/alert-firewall-snat-port-exhaustion`,
        name: "alert-firewall-snat-port-exhaustion",
        alertType: "metric",
        alertTypeDisplayName: "Alerta de Métrica",
        location: "eastus2",
        resourceGroup: "rg-shared-networking",
        subscriptionId: sub3,
        subscriptionName: sub3Name,
        isEnabled: true,
        severity: "Sev0",
        targetResourceId: `/subscriptions/${sub3}/resourceGroups/rg-shared-networking/providers/microsoft.network/azurefirewalls/fw-core-hub`,
        targetResourceName: "fw-core-hub",
        targetResourceType: "Microsoft.Network/azureFirewalls",
        evaluationFrequency: "1m",
        windowSize: "5m",
        conditionSummary: "SNAT Port Utilization > 95%",
        actionGroupIds: [`/subscriptions/${sub3}/resourceGroups/rg-shared-networking/providers/microsoft.insights/actionGroups/ag-netops-247`],
        actionGroupNames: ["ag-netops-247 (SMS, PagerDuty, NetOps Call)"],
        monthlyCostUSD: 0.10,
        isOrphan: false,
        isInefficient: false,
      }
    );
  }

  const remediations = generateAlertsRecommendations(alerts);
  const summary = calculateAlertsSummary(alerts, remediations);

  return {
    summary,
    alerts,
    remediations,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: [sub1, sub2, sub3],
  };
}

/**
 * Fetches real Azure alert resources via Azure Resource Graph and live REST APIs
 */
export async function fetchLiveAlertsData(tenantId: string): Promise<AlertsPayload> {
  try {
    const credentials = await getAzureCredential(tenantId);
    if (!credentials) {
      return {
        summary: {
          totalMonthlyCostUSD: 0,
          totalAlertsCount: 0,
          enabledCount: 0,
          disabledCount: 0,
          firingLast24hCount: 0,
          orphanCount: 0,
          inefficientCount: 0,
          potentialSavingsUSD: 0,
          breakdownByType: [],
        },
        alerts: [],
        remediations: [],
        source: "live",
        lastUpdated: new Date().toISOString(),
      };
    }

    const subMap = await getSubscriptionNameMap(tenantId, credentials).catch(() => new Map<string, string>());
    const client = await getResourceGraphClient(tenantId);

    const query = `
      resources
      | where type in~ (
          'microsoft.insights/metricalerts',
          'microsoft.insights/scheduledqueryrules',
          'microsoft.insights/activitylogalerts',
          'microsoft.alertsmanagement/smartdetectoralertrules',
          'microsoft.insights/webtests'
        )
      | project id, name, type, location, resourceGroup, subscriptionId, tags, properties
    `;

    const response = await withArgLimit(async () => {
      return await client.resources({ query });
    });

    const rows: any[] = response.data || [];
    if (rows.length === 0) {
      return {
        summary: {
          totalMonthlyCostUSD: 0,
          totalAlertsCount: 0,
          enabledCount: 0,
          disabledCount: 0,
          firingLast24hCount: 0,
          orphanCount: 0,
          inefficientCount: 0,
          potentialSavingsUSD: 0,
          breakdownByType: [],
        },
        alerts: [],
        remediations: [],
        source: "live",
        lastUpdated: new Date().toISOString(),
        availableSubscriptions: Object.keys(subMap),
      };
    }

    const alerts: AlertRuleResource[] = rows.map((r: any) => {
      const rawType = r.type || "";
      const alertType = mapAzureTypeToAlertType(rawType);
      const props = r.properties || {};

      const isEnabled = props.enabled !== false && props.state !== "Disabled";
      let severity: AlertSeverity = "Sev3";
      const rawSev = String(props.severity ?? "").toLowerCase();
      if (rawSev === "0" || rawSev === "sev0" || rawSev === "critical") severity = "Sev0";
      else if (rawSev === "1" || rawSev === "sev1" || rawSev === "error") severity = "Sev1";
      else if (rawSev === "2" || rawSev === "sev2" || rawSev === "warning") severity = "Sev2";
      else if (rawSev === "3" || rawSev === "sev3" || rawSev === "informational" || rawSev === "info") severity = "Sev3";
      else if (rawSev === "4" || rawSev === "sev4" || rawSev === "verbose") severity = "Sev4";

      // Resolve target scopes
      const scopes: string[] = Array.isArray(props.scopes)
        ? props.scopes
        : props.targetResourceId
        ? [props.targetResourceId]
        : [];
      const targetResourceId = scopes[0] || `/subscriptions/${r.subscriptionId}/resourceGroups/${r.resourceGroup}`;
      const targetParts = targetResourceId.split("/");
      const targetResourceName = targetParts[targetParts.length - 1] || r.name;
      const targetResourceType = targetParts.length >= 8 ? `${targetParts[6]}/${targetParts[7]}` : "Resource";

      const evalFreq = props.evaluationFrequency || props.frequency || "5m";
      const windowSize = props.windowSize || props.timeWindow || "15m";

      // Condition summary & KQL
      let conditionSummary = "";
      let queryKql: string | undefined = undefined;

      if (alertType === "scheduledQuery") {
        queryKql = props.criteria?.query || props.source?.query || props.query;
        conditionSummary = queryKql ? `Consulta KQL con frecuencia ${evalFreq}` : "Regla de búsqueda en logs";
      } else if (alertType === "metric") {
        const criteriaList = props.criteria?.allOf || [];
        if (criteriaList.length > 0) {
          const firstCrit = criteriaList[0];
          conditionSummary = `${firstCrit.timeAggregation || "Avg"} ${firstCrit.metricName || "Métrica"} ${firstCrit.operator || ">"} ${firstCrit.threshold || "umbral"}`;
        } else {
          conditionSummary = "Condición de métrica personalizada";
        }
      } else if (alertType === "activityLog") {
        conditionSummary = "Evento de auditoría en Azure Activity Log";
      } else if (alertType === "smartDetector") {
        conditionSummary = props.description || "Detección inteligente de anomalías mediante IA";
      } else if (alertType === "webTest") {
        conditionSummary = "Prueba de disponibilidad y latencia web";
      }

      // Action Groups
      const actions = props.actions || [];
      const actionGroupIds: string[] = Array.isArray(actions.actionGroups)
        ? actions.actionGroups.map((ag: any) => (typeof ag === "string" ? ag : ag.actionGroupId || ""))
        : Array.isArray(actions)
        ? actions.map((ag: any) => (typeof ag === "string" ? ag : ag.actionGroupId || ""))
        : [];

      const actionGroupNames = actionGroupIds.map((id) => id.split("/").pop() || id);

      const monthlyCostUSD = calculateAlertMonthlyCost(alertType, evalFreq, isEnabled);

      return {
        id: r.id,
        name: r.name,
        alertType,
        alertTypeDisplayName: ALERT_TYPE_DISPLAY_NAMES[alertType] || "Alerta",
        location: r.location || "global",
        resourceGroup: r.resourceGroup || "default",
        subscriptionId: r.subscriptionId,
        subscriptionName: resolveSubscriptionName(r.subscriptionId, subMap),
        isEnabled,
        severity,
        targetResourceId,
        targetResourceName,
        targetResourceType,
        evaluationFrequency: evalFreq,
        windowSize,
        conditionSummary,
        queryKql,
        actionGroupIds,
        actionGroupNames,
        monthlyCostUSD,
        isOrphan: false,
        isInefficient: false,
        tags: r.tags || {},
      };
    });

    const remediations = generateAlertsRecommendations(alerts);
    const summary = calculateAlertsSummary(alerts, remediations);

    return {
      summary,
      alerts,
      remediations,
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions: Object.keys(subMap),
    };
  } catch (error) {
    console.error("[azureAlertsRulesService] Error fetching live alerts:", error);
    // In live mode with error, return empty valid live payload without fake mock data
    return {
      summary: {
        totalMonthlyCostUSD: 0,
        totalAlertsCount: 0,
        enabledCount: 0,
        disabledCount: 0,
        firingLast24hCount: 0,
        orphanCount: 0,
        inefficientCount: 0,
        potentialSavingsUSD: 0,
        breakdownByType: [],
      },
      alerts: [],
      remediations: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  }
}

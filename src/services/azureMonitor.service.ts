/**
 * Azure Monitor & Alerting FinOps & Observability Service
 *
 * Implements ARG discovery of all alert types (Metric, Log Search KQL, Activity Log, Smart Detector, Web Tests),
 * calculates Log Search data processing consumption ($2.30/GB scanned), evaluates KQL query efficiency,
 * and generates actionable FinOps recommendations.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { getResourceCostsById } from "@/modules/collectors/azure/resourceInventoryService";
import pool from "@/modules/storage/db";
import type {
  AzureAlertResource,
  AzureAlertType,
  AzureMonitorSummaryMetrics,
  AzureAlertsByTypeBreakdown,
  AzureMonitorRemediationAction,
  AzureMonitorDailyTrendPoint,
  AzureMonitorPayload,
} from "@/types/azureMonitor.types";

export const LOG_SEARCH_DATA_RATE_PER_GB = 2.30;
export const METRIC_ALERT_BASE_RATE = 0.10;
export const LOG_SEARCH_EVAL_RATE_1M = 1.50;
export const LOG_SEARCH_EVAL_RATE_5M = 0.50;
export const WEB_TEST_BASE_RATE = 1.00;

export const ALERT_TYPE_COLORS: Record<AzureAlertType, string> = {
  logSearch: "#0078D4", // Corporate Deep Blue
  metric: "#2563EB", // Cobalt Blue
  webTest: "#0284C7", // Cyan Blue
  smartDetector: "#38BDF8", // Sky Blue
  activityLog: "#94A3B8", // Slate
};

export const ALERT_TYPE_LABELS: Record<AzureAlertType, string> = {
  logSearch: "Log Search (KQL)",
  metric: "Metric Alert",
  webTest: "App Insights Web Test",
  smartDetector: "Smart Detector",
  activityLog: "Activity Log",
};

/**
 * Calculates summary metrics, type breakdown, and top costly alerts
 */
export function calculateAzureMonitorSummary(
  alerts: AzureAlertResource[],
  customRecommendations?: AzureMonitorRemediationAction[]
): AzureMonitorSummaryMetrics {
  const totalAlertsCount = alerts.length;
  const enabledCount = alerts.filter((a) => a.isEnabled).length;
  const disabledCount = alerts.filter((a) => !a.isEnabled).length;
  const firingCount = alerts.filter((a) => a.isFiring).length;

  const totalMonthlyCostUSD = Number(
    alerts.reduce((sum, a) => sum + a.totalRealCostUSD, 0).toFixed(2)
  );
  const logSearchDataProcessedGB = Number(
    alerts.reduce((sum, a) => sum + a.dataProcessedGB_MTD, 0).toFixed(2)
  );

  // Group by alert type
  const typeMap = new Map<AzureAlertType, { count: number; cost: number; dataGB: number }>();
  for (const a of alerts) {
    const current = typeMap.get(a.alertType) || { count: 0, cost: 0, dataGB: 0 };
    typeMap.set(a.alertType, {
      count: current.count + 1,
      cost: current.cost + a.totalRealCostUSD,
      dataGB: current.dataGB + a.dataProcessedGB_MTD,
    });
  }

  const allTypes: AzureAlertType[] = ["logSearch", "metric", "webTest", "smartDetector", "activityLog"];
  const breakdownByAlertType: AzureAlertsByTypeBreakdown[] = allTypes.map((t) => {
    const d = typeMap.get(t) || { count: 0, cost: 0, dataGB: 0 };
    return {
      typeName: t,
      typeLabel: ALERT_TYPE_LABELS[t],
      alertsCount: d.count,
      costUSD: Number(d.cost.toFixed(2)),
      dataProcessedGB: Number(d.dataGB.toFixed(1)),
      percentage:
        totalMonthlyCostUSD > 0
          ? Number(((d.cost / totalMonthlyCostUSD) * 100).toFixed(1))
          : 0,
      color: ALERT_TYPE_COLORS[t],
    };
  });

  const recommendations = customRecommendations || generateAzureMonitorRecommendations(alerts);
  const potentialSavingsUSD = Number(
    recommendations.reduce((sum, r) => sum + r.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    totalMonthlyCostUSD,
    totalAlertsCount,
    enabledCount,
    disabledCount,
    firingCount,
    logSearchDataProcessedGB,
    potentialSavingsUSD,
    breakdownByAlertType,
  };
}

/**
 * Generates actionable FinOps recommendations for Azure Monitor Alerting
 */
export function generateAzureMonitorRecommendations(
  alerts: AzureAlertResource[]
): AzureMonitorRemediationAction[] {
  const actions: AzureMonitorRemediationAction[] = [];

  for (const alert of alerts) {
    // Regla 1: Optimización de Consultas KQL de Log Search con escaneo excesivo (> 50 GB MTD)
    if (alert.alertType === "logSearch" && alert.dataProcessedGB_MTD >= 50 && alert.isEnabled && !alert.isOrphan) {
      const currentDataCost = alert.dataProcessedGB_MTD * LOG_SEARCH_DATA_RATE_PER_GB;
      const potentialSavings = Number((currentDataCost * 0.70).toFixed(2));

      if (potentialSavings > 30) {
        actions.push({
          id: `rem-mon-kql-${alert.id}`,
          resourceId: alert.id,
          resourceName: alert.name,
          title: `Optimizar Consulta KQL de Log Search en '${alert.name}'`,
          description: `La regla ejecuta consultas KQL no acotadas que procesan ${alert.dataProcessedGB_MTD.toFixed(1)} GB MTD ($${currentDataCost.toFixed(2)} USD). Agregar filtros tempranos por _ResourceId y reducir la ventana de búsqueda (lookback) ahorra ~$${potentialSavings.toFixed(2)} USD/mes (~70%).`,
          category: "KQL_OPTIMIZE",
          estimatedSavingsUSD: potentialSavings,
          confidence: "HIGH",
          actionType: "OPTIMIZE_KQL_QUERY",
          currentQuery: alert.queryPayload || "traces | where message contains 'Error'",
          recommendedQuery: `${alert.queryPayload || "traces"} | where _ResourceId =~ "${alert.targetResourceId}" | where TimeGenerated > ago(5m)`,
          commandPayload: `az monitor scheduled-query update --name "${alert.name}" --resource-group "${alert.resourceGroup}" --query "${alert.queryPayload || "traces"} | where TimeGenerated > ago(5m)"`,
        });
      }
    }

    // Regla 2: Migración de Log Search básica a Metric Alert (cuando monitorea métricas estándar)
    if (
      alert.alertType === "logSearch" &&
      alert.queryPayload &&
      (alert.queryPayload.toLowerCase().includes("perf") || alert.queryPayload.toLowerCase().includes("heartbeat")) &&
      alert.isEnabled &&
      !alert.isOrphan
    ) {
      const metricSavings = Number((alert.totalRealCostUSD * 0.85).toFixed(2));
      if (metricSavings > 15) {
        actions.push({
          id: `rem-mon-metric-${alert.id}`,
          resourceId: alert.id,
          resourceName: alert.name,
          title: `Migrar Alerta '${alert.name}' de Log Search a Metric Alert`,
          description: `La alerta consulta métricas del sistema (Perf / CPU / Memoria) vía Log Analytics KQL ($2.30/GB). Migrar a una Metric Alert nativa de Azure Monitor cuesta solo $0.10/mes, ahorrando ~$${metricSavings.toFixed(2)} USD/mes (~85%).`,
          category: "MIGRATE_TO_METRIC",
          estimatedSavingsUSD: metricSavings,
          confidence: "HIGH",
          actionType: "MIGRATE_TO_METRIC_ALERT",
          commandPayload: `az monitor metrics alert create --name "${alert.name}-metric" --resource-group "${alert.resourceGroup}" --scopes "${alert.targetResourceId}" --condition "avg Percentage CPU > 85" --window-size 5m --evaluation-frequency 1m`,
        });
      }
    }

    // Regla 3: Frecuencia excesiva en ambientes Dev / Test (ejecución cada 1 minuto)
    if (alert.isDevOrTest && alert.runFrequency === "1m" && alert.isEnabled && !alert.isOrphan) {
      const freqSavings = Number((alert.totalRealCostUSD * 0.60).toFixed(2));
      actions.push({
        id: `rem-mon-freq-${alert.id}`,
        resourceId: alert.id,
        resourceName: alert.name,
        title: `Ajustar Frecuencia a 5m en '${alert.name}' (Entorno Dev/Test)`,
        description: `La alerta se evalúa cada 1 minuto en un entorno no productivo (${alert.resourceGroup}). Cambiar el intervalo de evaluación a 5 minutos reduce el número de ejecuciones y escaneos en un 80%, ahorrando ~$${freqSavings.toFixed(2)} USD/mes.`,
        category: "FREQUENCY_ADJUST",
        estimatedSavingsUSD: freqSavings,
        confidence: "HIGH",
        actionType: "ADJUST_FREQUENCY",
        currentFrequency: "1m",
        recommendedFrequency: "5m",
        commandPayload: `az monitor scheduled-query update --name "${alert.name}" --resource-group "${alert.resourceGroup}" --evaluation-frequency 5m`,
      });
    }

    // Regla 4: Alerta huérfana apuntando a recursos inexistentes o deshabilitada hace > 90 días
    if (alert.isOrphan) {
      actions.push({
        id: `rem-mon-orphan-${alert.id}`,
        resourceId: alert.id,
        resourceName: alert.name,
        title: `Eliminar Regla de Alerta Huérfana '${alert.name}'`,
        description: `El recurso destino de la alerta ('${alert.targetResourceName}') ya no existe o la alerta ha permanecido inactiva por más de 90 días. Se recomienda su desmantelamiento para evitar ejecuciones residuales.`,
        category: "ORPHAN_PURGE",
        estimatedSavingsUSD: alert.totalRealCostUSD,
        confidence: "HIGH",
        actionType: "PURGE_ORPHAN",
        commandPayload: `az monitor scheduled-query delete --name "${alert.name}" --resource-group "${alert.resourceGroup}" --yes`,
      });
    }
  }

  return actions;
}

/**
 * Generates realistic synthetic mock data for demo tenants and testing
 */
export function generateMockAzureMonitorData(): AzureMonitorPayload {
  const alerts: AzureAlertResource[] = [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/scheduledqueryrules/alert-log-heavy-5xx",
      name: "alert-log-heavy-5xx",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      alertType: "logSearch",
      targetResourceId: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-monitoring-prod/providers/microsoft.operationalinsights/workspaces/law-prod-core",
      targetResourceName: "law-prod-core",
      isEnabled: true,
      currentSeverity: "Sev1",
      isFiring: false,
      runFrequency: "1m",
      timeWindow: "15m",
      dataProcessedGB_MTD: 420.0,
      avgDailyDataGB: 14.0,
      isDevOrTest: false,
      isOrphan: false,
      isWasteful: true,
      costMtdUSD: 1.50, // Eval base
      specializedCostUSD: Number((420.0 * LOG_SEARCH_DATA_RATE_PER_GB).toFixed(2)), // $966.00
      totalRealCostUSD: 967.50,
      potentialSavingsUSD: 676.20,
      queryPayload: "AppRequests | where ResultCode startswith '5' | summarize count() by bin(TimeGenerated, 5m)",
      primaryRecommendation: {
        category: "KQL_OPTIMIZE",
        title: "Optimizar Consulta KQL de Log Search",
        description: "Agregar partición temprana por _ResourceId y acotar ventana",
        savingsUSD: 676.20,
      },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/scheduledqueryrules/alert-cpu-perf-kql",
      name: "alert-cpu-perf-kql",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      alertType: "logSearch",
      targetResourceId: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/microsoft.compute/virtualmachines/vm-app-frontend-01",
      targetResourceName: "vm-app-frontend-01",
      isEnabled: true,
      currentSeverity: "Sev2",
      isFiring: true,
      runFrequency: "5m",
      timeWindow: "5m",
      dataProcessedGB_MTD: 85.0,
      avgDailyDataGB: 2.8,
      isDevOrTest: false,
      isOrphan: false,
      isWasteful: true,
      costMtdUSD: 0.50,
      specializedCostUSD: Number((85.0 * LOG_SEARCH_DATA_RATE_PER_GB).toFixed(2)), // $195.50
      totalRealCostUSD: 196.00,
      potentialSavingsUSD: 166.60,
      queryPayload: "Perf | where ObjectName == 'Processor' and CounterName == '% Processor Time' | summarize avg(CounterValue) by bin(TimeGenerated, 5m)",
      primaryRecommendation: {
        category: "MIGRATE_TO_METRIC",
        title: "Migrar de Log Search a Metric Alert",
        description: "Monitoreo nativo de CPU por $0.10/mes en lugar de $196/mes",
        savingsUSD: 166.60,
      },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-dev-backend/providers/microsoft.insights/scheduledqueryrules/alert-dev-frequent-exceptions",
      name: "alert-dev-frequent-exceptions",
      location: "westeurope",
      resourceGroup: "rg-dev-backend",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Dev & Test Lab",
      alertType: "logSearch",
      targetResourceId: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-dev-backend/providers/microsoft.insights/components/appi-dev-core",
      targetResourceName: "appi-dev-core",
      isEnabled: true,
      currentSeverity: "Sev3",
      isFiring: false,
      runFrequency: "1m",
      timeWindow: "5m",
      dataProcessedGB_MTD: 45.0,
      avgDailyDataGB: 1.5,
      isDevOrTest: true,
      isOrphan: false,
      isWasteful: true,
      costMtdUSD: 1.50,
      specializedCostUSD: Number((45.0 * LOG_SEARCH_DATA_RATE_PER_GB).toFixed(2)), // $103.50
      totalRealCostUSD: 105.00,
      potentialSavingsUSD: 63.00,
      queryPayload: "AppExceptions | summarize count() by bin(TimeGenerated, 1m)",
      primaryRecommendation: {
        category: "FREQUENCY_ADJUST",
        title: "Ajustar frecuencia de 1m a 5m en Dev",
        description: "Reducir ejecuciones en ambiente de desarrollo",
        savingsUSD: 63.00,
      },
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/metricalerts/alert-metric-disk-space",
      name: "alert-metric-disk-space",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      alertType: "metric",
      targetResourceId: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/microsoft.compute/virtualmachines/vm-db-primary",
      targetResourceName: "vm-db-primary",
      isEnabled: true,
      currentSeverity: "Sev2",
      isFiring: false,
      runFrequency: "1m",
      timeWindow: "5m",
      dataProcessedGB_MTD: 0,
      avgDailyDataGB: 0,
      isDevOrTest: false,
      isOrphan: false,
      isWasteful: false,
      costMtdUSD: 0.10,
      specializedCostUSD: 0,
      totalRealCostUSD: 0.10,
      potentialSavingsUSD: 0,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/webtests/webtest-checkout-flow",
      name: "webtest-checkout-flow",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      alertType: "webTest",
      targetResourceId: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/components/appi-web-prod",
      targetResourceName: "appi-web-prod",
      isEnabled: true,
      currentSeverity: "Sev1",
      isFiring: false,
      runFrequency: "5m",
      timeWindow: "5m",
      dataProcessedGB_MTD: 0,
      avgDailyDataGB: 0,
      isDevOrTest: false,
      isOrphan: false,
      isWasteful: false,
      costMtdUSD: 1.00,
      specializedCostUSD: 0,
      totalRealCostUSD: 1.00,
      potentialSavingsUSD: 0,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-legacy-migration/providers/microsoft.insights/scheduledqueryrules/alert-orphan-legacy-vm",
      name: "alert-orphan-legacy-vm",
      location: "centralus",
      resourceGroup: "rg-legacy-migration",
      subscriptionId: "00000000-0000-0000-0000-000000000003",
      subscriptionName: "Legacy Systems",
      alertType: "logSearch",
      targetResourceId: "/subscriptions/00000000-0000-0000-0000-000000000003/resourceGroups/rg-legacy-migration/providers/microsoft.compute/virtualmachines/vm-deleted-legacy",
      targetResourceName: "vm-deleted-legacy",
      isEnabled: true,
      currentSeverity: "Sev3",
      isFiring: false,
      runFrequency: "5m",
      timeWindow: "15m",
      dataProcessedGB_MTD: 12.0,
      avgDailyDataGB: 0.4,
      isDevOrTest: false,
      isOrphan: true,
      isWasteful: true,
      costMtdUSD: 0.50,
      specializedCostUSD: Number((12.0 * LOG_SEARCH_DATA_RATE_PER_GB).toFixed(2)), // $27.60
      totalRealCostUSD: 28.10,
      potentialSavingsUSD: 28.10,
      queryPayload: "Heartbeat | where Computer == 'vm-deleted-legacy'",
      primaryRecommendation: {
        category: "ORPHAN_PURGE",
        title: "Eliminar alerta de VM desmantelada",
        description: "El recurso target ya fue eliminado de Azure",
        savingsUSD: 28.10,
      },
    },
  ];

  const recommendations = generateAzureMonitorRecommendations(alerts);
  const summary = calculateAzureMonitorSummary(alerts, recommendations);
  const topCostlyAlerts = [...alerts].sort((a, b) => b.totalRealCostUSD - a.totalRealCostUSD).slice(0, 5);

  const dailyTrend: AzureMonitorDailyTrendPoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split("T")[0];
    const dataGB = Number((16.5 + Math.sin(i / 2) * 3.2 + (i % 6 === 0 ? 5.0 : 0)).toFixed(1));
    const costUSD = Number((dataGB * LOG_SEARCH_DATA_RATE_PER_GB + 0.15).toFixed(2));
    const firing = i % 8 === 0 ? 1 : 0;

    dailyTrend.push({
      date: dateStr,
      dataProcessedGB: dataGB,
      costUSD,
      alertsFiringCount: firing,
    });
  }

  return {
    summary,
    alerts,
    topCostlyAlerts,
    remediationActions: recommendations,
    dailyTrend,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: [
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "00000000-0000-0000-0000-000000000003",
    ],
  };
}

/**
 * Fetches real Azure Monitor alert resources from Azure Resource Graph and CostSnapshots
 */
export async function fetchAzureMonitorData(tenantId: string): Promise<AzureMonitorPayload> {
  const credentials = await getAzureCredential(tenantId);
  if (!credentials) {
    return {
      summary: {
        totalMonthlyCostUSD: 0,
        totalAlertsCount: 0,
        enabledCount: 0,
        disabledCount: 0,
        firingCount: 0,
        logSearchDataProcessedGB: 0,
        potentialSavingsUSD: 0,
        breakdownByAlertType: [],
      },
      alerts: [],
      topCostlyAlerts: [],
      remediationActions: [],
      dailyTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions: [],
    };
  }

  const client = await getResourceGraphClient(tenantId);
  const subMap = await getSubscriptionNameMap(tenantId, credentials).catch(() => new Map<string, string>());

  const query = `
    resources
    | where type in~ (
        'microsoft.insights/metricalerts',
        'microsoft.insights/scheduledqueryrules',
        'microsoft.insights/activitylogalerts',
        'microsoft.alertsmanagement/smartdetectoralertrules',
        'microsoft.insights/webtests'
      )
    | project
        id,
        name,
        type,
        location,
        resourceGroup,
        subscriptionId,
        enabled = coalesce(properties.enabled, properties.Enabled, true),
        severity = tostring(coalesce(properties.severity, properties.Severity, 'Sev3')),
        frequency = tostring(coalesce(properties.evaluationFrequency, properties.frequency, properties.Frequency, '5m')),
        timeWindow = tostring(coalesce(properties.windowSize, properties.timeWindow, '5m')),
        targetScopes = properties.scopes,
        queryPayload = tostring(coalesce(properties.criteria.allOf[0].query, properties.query, '')),
        tags
    | limit 1000
  `;

  const resARG: any = await withArgLimit(() =>
    client.resources({
      query,
      options: { resultFormat: "objectArray" },
    })
  );

  const rawRows: any[] = resARG.data || [];
  if (rawRows.length === 0) {
    return {
      summary: {
        totalMonthlyCostUSD: 0,
        totalAlertsCount: 0,
        enabledCount: 0,
        disabledCount: 0,
        firingCount: 0,
        logSearchDataProcessedGB: 0,
        potentialSavingsUSD: 0,
        breakdownByAlertType: [],
      },
      alerts: [],
      topCostlyAlerts: [],
      remediationActions: [],
      dailyTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions: [],
    };
  }

  const availableSubs = Array.from(new Set(rawRows.map((r) => String(r.subscriptionId)).filter(Boolean)));

  // 1. Obtener costos reales MTD vía Azure Cost Management
  const costByResourceId = new Map<string, number>();
  const resourceRefs = rawRows
    .map((r) => ({
      id: String(r.id || "").toLowerCase(),
      subscriptionId: String(r.subscriptionId || ""),
    }))
    .filter((r) => r.id && r.subscriptionId);

  if (resourceRefs.length > 0) {
    try {
      const byId = await getResourceCostsById(tenantId, resourceRefs);
      byId.forEach((val, k) => costByResourceId.set(k.toLowerCase(), val));
    } catch (e) {
      console.warn(`[Azure Monitor] Error en getResourceCostsById para ${tenantId}:`, e instanceof Error ? e.message : e);
    }
  }

  // 2. Fallback / Enriquecimiento vía CostSnapshots
  const dbCostMap = new Map<string, number>();
  const dbDailyTrend: AzureMonitorDailyTrendPoint[] = [];
  try {
    const [costRows]: any = await pool.query(
      `SELECT resource_id, SUM(cost_usd) as totalCost
       FROM CostSnapshots
       WHERE tenant_id = ?
         AND (LOWER(service_name) LIKE '%azure monitor%' OR LOWER(service_name) LIKE '%monitor%' OR LOWER(service_name) LIKE '%alerts%')
         AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       GROUP BY resource_id`,
      [tenantId]
    );
    if (Array.isArray(costRows)) {
      for (const r of costRows) {
        if (r.resource_id) {
          dbCostMap.set(String(r.resource_id).toLowerCase(), Number(r.totalCost || 0));
        }
      }
    }

    const [trendRows]: any = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') as dayDate, SUM(cost_usd) as dailyCost
       FROM CostSnapshots
       WHERE tenant_id = ?
         AND (LOWER(service_name) LIKE '%azure monitor%' OR LOWER(service_name) LIKE '%monitor%' OR LOWER(service_name) LIKE '%alerts%')
         AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY dayDate
       ORDER BY dayDate ASC`,
      [tenantId]
    );
    if (Array.isArray(trendRows)) {
      for (const t of trendRows) {
        const cost = Number(t.dailyCost || 0);
        const gb = Number((cost / LOG_SEARCH_DATA_RATE_PER_GB).toFixed(1));
        dbDailyTrend.push({
          date: String(t.dayDate),
          dataProcessedGB: gb,
          costUSD: Number(cost.toFixed(2)),
          alertsFiringCount: 0,
        });
      }
    }
  } catch (err) {
    console.warn(`[Azure Monitor] Error en CostSnapshots para ${tenantId}:`, err instanceof Error ? err.message : err);
  }

  const currentDayOfMonth = Math.max(1, new Date().getDate());

  const alerts: AzureAlertResource[] = rawRows.map((r) => {
    const subName = resolveSubscriptionName(r.subscriptionId, subMap);
    const typeLower = String(r.type || "").toLowerCase();

    let alertType: AzureAlertType = "metric";
    if (typeLower.includes("scheduledqueryrules")) alertType = "logSearch";
    else if (typeLower.includes("activitylogalerts")) alertType = "activityLog";
    else if (typeLower.includes("smartdetector")) alertType = "smartDetector";
    else if (typeLower.includes("webtests")) alertType = "webTest";

    const isEnabled = r.enabled !== false && r.enabled !== "false";
    const rawSev = String(r.severity || "3");
    const currentSeverity = rawSev.startsWith("Sev") ? rawSev : `Sev${rawSev.replace(/\D/g, "") || "3"}`;

    const rgLower = String(r.resourceGroup || "").toLowerCase();
    const isDevOrTest =
      rgLower.includes("dev") ||
      rgLower.includes("test") ||
      rgLower.includes("stg") ||
      rgLower.includes("staging") ||
      rgLower.includes("lab");

    const rId = String(r.id || "").toLowerCase();
    const liveCost = costByResourceId.get(rId);
    const dbCost = dbCostMap.get(rId);
    let costMtdUSD = liveCost !== undefined ? liveCost : (dbCost !== undefined ? dbCost : 0);

    // Si es logSearch y costMtdUSD es 0 pero está habilitada, aplicar costo base
    if (costMtdUSD === 0 && isEnabled) {
      if (alertType === "metric") costMtdUSD = METRIC_ALERT_BASE_RATE;
      else if (alertType === "webTest") costMtdUSD = WEB_TEST_BASE_RATE;
      else if (alertType === "logSearch") costMtdUSD = r.frequency === "1m" ? LOG_SEARCH_EVAL_RATE_1M : LOG_SEARCH_EVAL_RATE_5M;
    }

    let dataProcessedGB_MTD = 0;
    let specializedCostUSD = 0;
    if (alertType === "logSearch" && isEnabled) {
      specializedCostUSD = costMtdUSD > 1.5 ? Number((costMtdUSD - 1.5).toFixed(2)) : 0;
      dataProcessedGB_MTD = Number((specializedCostUSD / LOG_SEARCH_DATA_RATE_PER_GB).toFixed(1));
    }

    const avgDailyDataGB = Number((dataProcessedGB_MTD / currentDayOfMonth).toFixed(1));
    const totalRealCostUSD = Number((costMtdUSD + specializedCostUSD).toFixed(2));
    const isOrphan = !isEnabled && totalRealCostUSD === 0;
    const isWasteful = (alertType === "logSearch" && dataProcessedGB_MTD >= 50) || (isDevOrTest && r.frequency === "1m");

    const targetScope = Array.isArray(r.targetScopes) && r.targetScopes.length > 0 ? r.targetScopes[0] : "";
    const targetResourceName = targetScope ? targetScope.split("/").pop() : r.name;

    return {
      id: r.id,
      name: r.name,
      location: r.location || "unknown",
      resourceGroup: r.resourceGroup || "unknown",
      subscriptionId: r.subscriptionId,
      subscriptionName: subName,
      alertType,
      targetResourceId: targetScope || r.id,
      targetResourceName: targetResourceName || r.name,
      isEnabled,
      currentSeverity,
      isFiring: false,
      runFrequency: r.frequency || "5m",
      timeWindow: r.timeWindow || "5m",
      dataProcessedGB_MTD,
      avgDailyDataGB,
      isDevOrTest,
      isOrphan,
      isWasteful,
      costMtdUSD: Number(costMtdUSD.toFixed(2)),
      specializedCostUSD,
      totalRealCostUSD,
      potentialSavingsUSD: 0,
      queryPayload: r.queryPayload,
    };
  });

  const recommendations = generateAzureMonitorRecommendations(alerts);
  for (const a of alerts) {
    const rec = recommendations.find((r) => r.resourceId === a.id);
    if (rec) {
      a.potentialSavingsUSD = rec.estimatedSavingsUSD;
      a.primaryRecommendation = {
        category: rec.category,
        title: rec.title,
        description: rec.description,
        savingsUSD: rec.estimatedSavingsUSD,
      };
    }
  }

  const summary = calculateAzureMonitorSummary(alerts, recommendations);
  const topCostlyAlerts = [...alerts].sort((a, b) => b.totalRealCostUSD - a.totalRealCostUSD).slice(0, 5);

  let dailyTrend: AzureMonitorDailyTrendPoint[] = [];
  if (dbDailyTrend.length > 0) {
    dailyTrend = dbDailyTrend;
  } else {
    const now = new Date();
    const totalDailyAvg = alerts.reduce((sum, a) => sum + a.avgDailyDataGB, 0);

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split("T")[0];
      const dayFactor = totalDailyAvg > 0 ? 0.9 + (i % 5) * 0.05 : 0;
      const dataGB = Number((totalDailyAvg * dayFactor).toFixed(1));
      const costUSD = Number((dataGB * LOG_SEARCH_DATA_RATE_PER_GB + 0.10).toFixed(2));

      dailyTrend.push({
        date: dateStr,
        dataProcessedGB: dataGB,
        costUSD,
        alertsFiringCount: 0,
      });
    }
  }

  return {
    summary,
    alerts,
    topCostlyAlerts,
    remediationActions: recommendations,
    dailyTrend,
    source: "live",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: availableSubs,
  };
}

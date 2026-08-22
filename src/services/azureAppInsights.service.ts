/**
 * Service: Azure Application Insights FinOps & Telemetry Attribution
 * Focus: Real data ingestion cost via Log Analytics workspace attribution ($2.30/GB),
 * Adaptive sampling rightsizing, Daily Cap safeguards, and orphan component purge.
 */

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";
import type {
  AppInsightsResourceItem,
  AppInsightsSummaryMetrics,
  AppInsightsRemediationAction,
  TelemetryTypeBreakdown,
  AppInsightsDailyIngestionPoint,
  AppInsightsPayload,
} from "@/types/azureAppInsights.types";

export const APP_INSIGHTS_RATE_PER_GB = 2.30; // Standard Log Analytics Pay-As-You-Go Ingestion ($2.30 USD/GB)

export const TELEMETRY_TYPE_COLORS: Record<string, string> = {
  AppTraces: "#0078D4",
  AppDependencies: "#2563EB",
  AppRequests: "#0284C7",
  AppExceptions: "#38BDF8",
  Otros: "#94A3B8",
};

/**
 * Calculates aggregate summary metrics for Application Insights components
 */
export function calculateAppInsightsSummary(
  items: AppInsightsResourceItem[],
  customRecommendations?: AppInsightsRemediationAction[]
): AppInsightsSummaryMetrics {
  const totalCostMtdUSD = Number(items.reduce((sum, item) => sum + item.estimatedCostMtdUSD, 0).toFixed(2));
  const totalIngestedGB = Number(items.reduce((sum, item) => sum + item.ingestedTotalGB, 0).toFixed(2));
  const instancesCount = items.length;
  const unlimitedCapCount = items.filter((i) => i.isDailyCapUnlimited).length;

  const totalTracesGB = items.reduce((sum, item) => sum + item.tracesGB, 0);
  const totalDepsGB = items.reduce((sum, item) => sum + item.dependenciesGB, 0);
  const totalRequestsGB = items.reduce((sum, item) => sum + item.requestsGB, 0);
  const totalExceptionsGB = items.reduce((sum, item) => sum + item.exceptionsGB, 0);

  const breakdownByTelemetryType: TelemetryTypeBreakdown[] = [
    {
      typeName: "AppTraces",
      gbCount: Number(totalTracesGB.toFixed(2)),
      costUSD: Number((totalTracesGB * APP_INSIGHTS_RATE_PER_GB).toFixed(2)),
      percentage: totalIngestedGB > 0 ? Number(((totalTracesGB / totalIngestedGB) * 100).toFixed(1)) : 0,
      color: TELEMETRY_TYPE_COLORS.AppTraces,
    },
    {
      typeName: "AppDependencies",
      gbCount: Number(totalDepsGB.toFixed(2)),
      costUSD: Number((totalDepsGB * APP_INSIGHTS_RATE_PER_GB).toFixed(2)),
      percentage: totalIngestedGB > 0 ? Number(((totalDepsGB / totalIngestedGB) * 100).toFixed(1)) : 0,
      color: TELEMETRY_TYPE_COLORS.AppDependencies,
    },
    {
      typeName: "AppRequests",
      gbCount: Number(totalRequestsGB.toFixed(2)),
      costUSD: Number((totalRequestsGB * APP_INSIGHTS_RATE_PER_GB).toFixed(2)),
      percentage: totalIngestedGB > 0 ? Number(((totalRequestsGB / totalIngestedGB) * 100).toFixed(1)) : 0,
      color: TELEMETRY_TYPE_COLORS.AppRequests,
    },
    {
      typeName: "AppExceptions",
      gbCount: Number(totalExceptionsGB.toFixed(2)),
      costUSD: Number((totalExceptionsGB * APP_INSIGHTS_RATE_PER_GB).toFixed(2)),
      percentage: totalIngestedGB > 0 ? Number(((totalExceptionsGB / totalIngestedGB) * 100).toFixed(1)) : 0,
      color: TELEMETRY_TYPE_COLORS.AppExceptions,
    },
  ];

  const recommendations = customRecommendations || generateAppInsightsRecommendations(items);
  const potentialSavingsUSD = Number(
    recommendations.reduce((sum, a) => sum + a.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    totalCostMtdUSD,
    totalIngestedGB,
    instancesCount,
    unlimitedCapCount,
    potentialSavingsUSD,
    breakdownByTelemetryType,
  };
}

/**
 * Generates FinOps remediation recommendations for Application Insights
 */
export function generateAppInsightsRecommendations(
  items: AppInsightsResourceItem[]
): AppInsightsRemediationAction[] {
  const actions: AppInsightsRemediationAction[] = [];

  for (const item of items) {
    // Regla 1: Falta de Daily Cap en entornos no productivos
    if (item.isDevOrTest && item.isDailyCapUnlimited && !item.isOrphan) {
      actions.push({
        id: `rem-appi-dailycap-${item.id}`,
        resourceId: item.id,
        resourceName: item.name,
        title: `Fijar Límite Diario (Daily Cap) en '${item.name}'`,
        description: `El componente corre en entorno Dev/Test (${item.resourceGroup}) sin tope diario de ingesta. Fijar un límite de 5 GB/día previene facturas inesperadas ante bucles de logging descontrolados.`,
        category: "SET_DAILY_CAP",
        estimatedSavingsUSD: Number((item.estimatedCostMtdUSD * 0.35).toFixed(2)),
        confidence: "HIGH",
        actionType: "SET_DAILY_CAP",
        recommendedDailyCap: 5,
        commandPayload: `az monitor app-insights component update --app "${item.name}" --resource-group "${item.resourceGroup}" --daily-cap 5`,
      });
    }

    // Regla 2: Sampling al 100% en componentes de alta ingesta (> 5 GB/mes y alta concentración de traces)
    if (item.samplingPercentage === 100 && item.ingestedTotalGB > 5.0 && !item.isOrphan) {
      const traceRatio = item.ingestedTotalGB > 0 ? item.tracesGB / item.ingestedTotalGB : 0;
      const targetSampling = 50;
      const estimatedSavings = Number(((item.estimatedCostMtdUSD * (1 - targetSampling / 100)) * (traceRatio > 0.5 ? 0.8 : 0.5)).toFixed(2));

      actions.push({
        id: `rem-appi-sampling-${item.id}`,
        resourceId: item.id,
        resourceName: item.name,
        title: `Optimizar Adaptive Sampling en '${item.name}' (100% -> 50%)`,
        description: `El componente procesa ${item.ingestedTotalGB.toFixed(1)} GB MTD al 100% de muestreo (${(traceRatio * 100).toFixed(0)}% en AppTraces). Reducir el muestreo al 50% preserva precisión estadística y ahorra ~$${estimatedSavings.toFixed(2)} USD/mes en Log Analytics.`,
        category: "REDUCE_SAMPLING",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "HIGH",
        actionType: "REDUCE_SAMPLING",
        currentSampling: 100,
        recommendedSampling: 50,
        commandPayload: `az monitor app-insights component update --app "${item.name}" --resource-group "${item.resourceGroup}" --sampling-percentage 50`,
      });
    }

    // Regla 3: Filtrado de Logs Verbose en SDK (Traces > 70% del volumen)
    if (item.tracesGB > 10.0 && (item.tracesGB / (item.ingestedTotalGB || 1)) > 0.65 && !item.isOrphan) {
      const logSavings = Number((item.tracesGB * 0.40 * APP_INSIGHTS_RATE_PER_GB).toFixed(2));
      actions.push({
        id: `rem-appi-filter-${item.id}`,
        resourceId: item.id,
        resourceName: item.name,
        title: `Filtrado de Telemetría Verbose en SDK para '${item.name}'`,
        description: `Más del 65% de la telemetría corresponde a trazas de log (${item.tracesGB.toFixed(1)} GB). Subir el umbral de severidad a Warning/Error en la configuración del SDK reduce el volumen en ~40%, ahorrando ~$${logSavings.toFixed(2)} USD/mes.`,
        category: "FILTER_LOGS",
        estimatedSavingsUSD: logSavings,
        confidence: "MEDIUM",
        actionType: "FILTER_LOGS",
        commandPayload: `# Configurar MinimumLogLevel = Warning en appsettings.json o ApplicationInsights.config\n# "Logging": { "LogLevel": { "Default": "Warning" } }`,
      });
    }

    // Regla 4: Instancia Huérfana sin ingesta en 30 días
    if (item.isOrphan) {
      actions.push({
        id: `rem-appi-orphan-${item.id}`,
        resourceId: item.id,
        resourceName: item.name,
        title: `Purga de Componente Huérfano '${item.name}'`,
        description: `El recurso '${item.name}' no ha registrado ninguna ingesta de telemetría en los últimos 30 días. Se recomienda su desmantelamiento para mantener limpio el inventario.`,
        category: "PURGE_ORPHAN",
        estimatedSavingsUSD: 0,
        confidence: "HIGH",
        actionType: "PURGE_ORPHAN",
        commandPayload: `az monitor app-insights component delete --app "${item.name}" --resource-group "${item.resourceGroup}" --yes`,
      });
    }
  }

  return actions;
}

/**
 * Generates mock data for demo tenants and offline testing
 */
export function generateMockAppInsightsData(): AppInsightsPayload {
  const items: AppInsightsResourceItem[] = [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-ecommerce-prod/providers/microsoft.insights/components/appi-web-prod",
      name: "appi-web-prod",
      location: "eastus2",
      resourceGroup: "rg-ecommerce-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      linkedWorkspaceId: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-monitoring-prod/providers/microsoft.operationalinsights/workspaces/law-central-prod",
      linkedWorkspaceName: "law-central-prod",
      samplingPercentage: 100,
      dailyCapGB: undefined,
      isDailyCapUnlimited: true,
      ingestedTotalGB: 42.5,
      tracesGB: 25.8,
      dependenciesGB: 9.4,
      requestsGB: 6.1,
      exceptionsGB: 1.2,
      estimatedCostMtdUSD: Number((42.5 * APP_INSIGHTS_RATE_PER_GB).toFixed(2)),
      forecastCostUSD: Number((42.5 * APP_INSIGHTS_RATE_PER_GB * 1.05).toFixed(2)),
      isDevOrTest: false,
      isOrphan: false,
      applicationType: "web",
      retentionInDays: 90,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-microservices-prod/providers/microsoft.insights/components/appi-api-gateway-prod",
      name: "appi-api-gateway-prod",
      location: "westeurope",
      resourceGroup: "rg-microservices-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      linkedWorkspaceId: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-monitoring-prod/providers/microsoft.operationalinsights/workspaces/law-central-prod",
      linkedWorkspaceName: "law-central-prod",
      samplingPercentage: 50,
      dailyCapGB: 10,
      isDailyCapUnlimited: false,
      ingestedTotalGB: 18.2,
      tracesGB: 7.2,
      dependenciesGB: 6.5,
      requestsGB: 4.1,
      exceptionsGB: 0.4,
      estimatedCostMtdUSD: Number((18.2 * APP_INSIGHTS_RATE_PER_GB).toFixed(2)),
      forecastCostUSD: Number((18.2 * APP_INSIGHTS_RATE_PER_GB * 1.04).toFixed(2)),
      isDevOrTest: false,
      isOrphan: false,
      applicationType: "web",
      retentionInDays: 90,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-checkout-dev/providers/microsoft.insights/components/appi-checkout-dev",
      name: "appi-checkout-dev",
      location: "eastus",
      resourceGroup: "rg-checkout-dev",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Dev/Test Sandbox",
      linkedWorkspaceId: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-monitoring-dev/providers/microsoft.operationalinsights/workspaces/law-dev",
      linkedWorkspaceName: "law-dev",
      samplingPercentage: 100,
      dailyCapGB: undefined,
      isDailyCapUnlimited: true,
      ingestedTotalGB: 12.0,
      tracesGB: 8.5,
      dependenciesGB: 2.1,
      requestsGB: 1.1,
      exceptionsGB: 0.3,
      estimatedCostMtdUSD: Number((12.0 * APP_INSIGHTS_RATE_PER_GB).toFixed(2)),
      forecastCostUSD: Number((12.0 * APP_INSIGHTS_RATE_PER_GB * 1.02).toFixed(2)),
      isDevOrTest: true,
      isOrphan: false,
      applicationType: "web",
      retentionInDays: 30,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-legacy-apps/providers/microsoft.insights/components/appi-legacy-abandoned",
      name: "appi-legacy-abandoned",
      location: "centralus",
      resourceGroup: "rg-legacy-apps",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Dev/Test Sandbox",
      linkedWorkspaceId: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-monitoring-dev/providers/microsoft.operationalinsights/workspaces/law-dev",
      linkedWorkspaceName: "law-dev",
      samplingPercentage: 100,
      dailyCapGB: undefined,
      isDailyCapUnlimited: true,
      ingestedTotalGB: 0.0,
      tracesGB: 0.0,
      dependenciesGB: 0.0,
      requestsGB: 0.0,
      exceptionsGB: 0.0,
      estimatedCostMtdUSD: 0.0,
      forecastCostUSD: 0.0,
      isDevOrTest: true,
      isOrphan: true,
      applicationType: "other",
      retentionInDays: 30,
    },
  ];

  const recommendations = generateAppInsightsRecommendations(items);
  const summary = calculateAppInsightsSummary(items, recommendations);

  const dailyIngestionTrend: AppInsightsDailyIngestionPoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split("T")[0];
    const totalGB = Number((2.4 + Math.sin(i / 3) * 0.6 + Math.random() * 0.3).toFixed(2));
    const tracesGB = Number((totalGB * 0.58).toFixed(2));
    const dependenciesGB = Number((totalGB * 0.23).toFixed(2));
    const requestsGB = Number((totalGB * 0.15).toFixed(2));
    const exceptionsGB = Number((totalGB * 0.04).toFixed(2));
    const costUSD = Number((totalGB * APP_INSIGHTS_RATE_PER_GB).toFixed(2));

    dailyIngestionTrend.push({
      date: dateStr,
      totalGB,
      tracesGB,
      dependenciesGB,
      requestsGB,
      exceptionsGB,
      costUSD,
    });
  }

  return {
    summary,
    items,
    remediationActions: recommendations,
    dailyIngestionTrend,
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Fetches real Application Insights instances from Azure Resource Graph and calculates ingestion costs
 */
export async function fetchAppInsightsData(tenantId: string): Promise<AppInsightsPayload> {
  const credentials = await getAzureCredential(tenantId);
  const subscriptionIds = await getSubscriptionsForTenant(tenantId, credentials);

  if (!subscriptionIds || subscriptionIds.length === 0) {
    return {
      summary: {
        totalCostMtdUSD: 0,
        totalIngestedGB: 0,
        instancesCount: 0,
        unlimitedCapCount: 0,
        potentialSavingsUSD: 0,
        breakdownByTelemetryType: [],
      },
      items: [],
      remediationActions: [],
      dailyIngestionTrend: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  }

  const client = new ResourceGraphClient(credentials);

  const query = `
    resources
    | where type =~ 'microsoft.insights/components'
    | project id, name, location, resourceGroup, subscriptionId, properties
  `;

  let rawRows: any[] = [];
  try {
    const response = await client.resources({
      query,
      subscriptions: subscriptionIds,
    });
    rawRows = response.data || [];
  } catch (err) {
    console.warn("[azure-app-insights] ARG query failed:", err instanceof Error ? err.message : err);
  }

  const items: AppInsightsResourceItem[] = [];

  // Query DB cost snapshots for real costs if available
  const costMap = new Map<string, number>();
  try {
    const [costRows] = await pool.query<any[]>(
      `SELECT resource_id, SUM(cost) as cost_mtd
       FROM CostSnapshots 
       WHERE tenant_id = ? AND (service_name LIKE '%Application Insights%' OR service_name LIKE '%Log Analytics%')
       GROUP BY resource_id`,
      [tenantId]
    );

    if (Array.isArray(costRows)) {
      for (const r of costRows) {
        costMap.set(String(r.resource_id).toLowerCase(), Number(r.cost_mtd) || 0);
      }
    }
  } catch {
    // Non-fatal if CostSnapshots table is querying or empty
  }

  for (const row of rawRows) {
    const subId = String(row.subscriptionId || "").toLowerCase();
    const subName = subId ? `Sub (${subId.slice(0, 8)}...)` : "Subscription";
    const props = row.properties || {};

    const resourceIdLower = String(row.id || "").toLowerCase();
    const dbCost = costMap.get(resourceIdLower);
    
    const samplingPercentage = Number(props.SamplingPercentage) || 100;
    const dailyCapRaw = Number(props.DailyCap);
    const dailyCapGB = !Number.isNaN(dailyCapRaw) && dailyCapRaw > 0 ? dailyCapRaw : undefined;
    const isDailyCapUnlimited = dailyCapGB === undefined;

    const linkedWorkspaceId = String(props.WorkspaceResourceId || "");
    const linkedWorkspaceName = linkedWorkspaceId ? linkedWorkspaceId.split("/").pop() || "Workspace" : "Clásico (Sin Workspace)";

    const rgName = String(row.resourceGroup || "").toLowerCase();
    const isDevOrTest = rgName.includes("dev") || rgName.includes("test") || rgName.includes("sandbox") || rgName.includes("qa") || rgName.includes("stage");

    // Ingested GB estimate from DB cost or baseline
    const estimatedCostMtdUSD = dbCost !== undefined && dbCost > 0 ? Number(dbCost.toFixed(2)) : 0.0;
    const ingestedTotalGB = Number((estimatedCostMtdUSD / APP_INSIGHTS_RATE_PER_GB).toFixed(2));
    const tracesGB = Number((ingestedTotalGB * 0.6).toFixed(2));
    const dependenciesGB = Number((ingestedTotalGB * 0.25).toFixed(2));
    const requestsGB = Number((ingestedTotalGB * 0.12).toFixed(2));
    const exceptionsGB = Number((ingestedTotalGB * 0.03).toFixed(2));
    const forecastCostUSD = Number((estimatedCostMtdUSD * 1.05).toFixed(2));
    const isOrphan = ingestedTotalGB === 0 && estimatedCostMtdUSD === 0;

    items.push({
      id: String(row.id || ""),
      name: String(row.name || "appi-component"),
      location: String(row.location || "unknown"),
      resourceGroup: String(row.resourceGroup || "unknown"),
      subscriptionId: String(row.subscriptionId || ""),
      subscriptionName: subName,
      linkedWorkspaceId,
      linkedWorkspaceName,
      samplingPercentage,
      dailyCapGB,
      isDailyCapUnlimited,
      ingestedTotalGB,
      tracesGB,
      dependenciesGB,
      requestsGB,
      exceptionsGB,
      estimatedCostMtdUSD,
      forecastCostUSD,
      isDevOrTest,
      isOrphan,
      applicationType: String(props.Application_Type || "web"),
      retentionInDays: Number(props.RetentionInDays) || 90,
    });
  }

  const recommendations = generateAppInsightsRecommendations(items);
  const summary = calculateAppInsightsSummary(items, recommendations);

  return {
    summary,
    items,
    remediationActions: recommendations,
    dailyIngestionTrend: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Builds Azure CLI and PowerShell remediation scripts for Application Insights
 */
export function buildAppInsightsRemediationCommand(action: AppInsightsRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "appi-resource";
  const rg = action.resourceId.split("/")[4] || "rg-monitoring";

  if (action.category === "SET_DAILY_CAP") {
    const cap = action.recommendedDailyCap || 5;
    return {
      cli:
        action.commandPayload ||
        `az monitor app-insights component update --app "${resourceName}" --resource-group "${rg}" --daily-cap ${cap}`,
      powershell: `# PowerShell Azure CLI - Fijar Daily Cap de Ingesta\nSet-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}" -DailyCap ${cap}`,
    };
  }

  if (action.category === "REDUCE_SAMPLING") {
    const sampling = action.recommendedSampling || 50;
    return {
      cli:
        action.commandPayload ||
        `az monitor app-insights component update --app "${resourceName}" --resource-group "${rg}" --sampling-percentage ${sampling}`,
      powershell: `# PowerShell Azure CLI - Optimizar Tasa de Muestreo (Sampling Rate)\nSet-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}" -SamplingPercentage ${sampling}`,
    };
  }

  if (action.category === "PURGE_ORPHAN") {
    return {
      cli:
        action.commandPayload ||
        `az monitor app-insights component delete --app "${resourceName}" --resource-group "${rg}" --yes`,
      powershell: `# PowerShell - Eliminar componente Application Insights huérfano\nRemove-AzApplicationInsights -ResourceGroupName "${rg}" -Name "${resourceName}"`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `# Revisar configuración del SDK en el backend para filtrar trazas Debug/Verbose`,
    powershell: `# Configurar MinimumLogLevel = Warning en appsettings.json`,
  };
}

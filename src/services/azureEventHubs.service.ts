/**
 * Service: Azure Event Hubs FinOps
 * Focus: SKU arbitrage (Premium PU / Dedicated CU rightsizing -> Standard tier),
 * Auto-inflate optimization, and orphan Event Hubs purge.
 */

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";
import type {
  EventHubsResourceItem,
  EventHubsSummaryMetrics,
  EventHubsRemediationAction,
  EventHubsSkuDistributionItem,
  EventHubsTrendDataPoint,
  EventHubsPayload,
  EventHubsSkuName,
} from "@/types/azureEventHubs.types";

export const EVENTHUBS_SKU_BASE_COST: Record<EventHubsSkuName, number> = {
  Basic: 11.0, // ~$11/month per Throughput Unit (TU)
  Standard: 22.0, // ~$22/month per TU
  Premium: 350.0, // ~$350/month per Processing Unit (PU)
  Dedicated: 5500.0, // ~$5,500/month per Dedicated Cluster (CU)
};

export const EVENTHUBS_SKU_COLORS: Record<EventHubsSkuName, string> = {
  Dedicated: "#1B2A41",
  Premium: "#0078D4",
  Standard: "#2563EB",
  Basic: "#0284C7",
};

/**
 * Calculates aggregate summary metrics for Event Hubs namespaces
 */
export function calculateEventHubsSummary(
  items: EventHubsResourceItem[],
  customRecommendations?: EventHubsRemediationAction[]
): EventHubsSummaryMetrics {
  const costMtdUSD = Number(items.reduce((sum, item) => sum + item.costMtdUSD, 0).toFixed(2));
  const totalNamespaces = items.length;
  const totalIngressMTD = items.reduce((sum, item) => sum + item.totalIngressBytes, 0);
  const totalEventHubs = items.reduce((sum, item) => sum + item.eventHubsCount, 0);

  const recommendations = customRecommendations || generateEventHubsRecommendations(items);
  const potentialSavingsUSD = Number(
    recommendations.reduce((sum, a) => sum + a.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    costMtdUSD,
    totalNamespaces,
    totalIngressMTD,
    totalEventHubs,
    potentialSavingsUSD,
  };
}

/**
 * Generates FinOps remediation recommendations for Event Hubs namespaces
 */
export function generateEventHubsRecommendations(
  items: EventHubsResourceItem[]
): EventHubsRemediationAction[] {
  const actions: EventHubsRemediationAction[] = [];

  for (const item of items) {
    // Regla 1: Arbitraje de SKUs Premium / Dedicated (Capacidad subutilizada < 30%)
    if (item.skuName === "Dedicated" && item.avgCapacityPercentage < 25) {
      const estimatedSavings = 5500.0 - (item.eventHubsCount * 22.0 * 2);
      actions.push({
        id: `rem-eh-dedicated-${item.id}`,
        resourceId: item.id,
        resourceName: item.name,
        title: `Migración de Cluster Dedicated a Tier Premium/Standard en '${item.name}'`,
        description: `El cluster Dedicated genera un costo fijo de ~$5,500.00 USD/mes pero su capacidad promedio es de ${item.avgCapacityPercentage.toFixed(
          1
        )}%. Migrar las cargas a Standard/Premium multi-inquilino genera ahorros estimados de $${estimatedSavings.toFixed(
          2
        )} USD/mes con SLAs idénticos.`,
        category: "SKU_DOWNGRADE",
        estimatedSavingsUSD: Number(estimatedSavings.toFixed(2)),
        confidence: "HIGH",
        actionType: "DOWNGRADE_DEDICATED",
        currentSku: "Dedicated",
        recommendedSku: "Premium",
        commandPayload: `# Planificación de drenado y migración a nivel Premium\naz eventhubs namespace create --name "${item.name}-premium" --resource-group "${item.resourceGroup}" --sku Premium --capacity 1`,
      });
    } else if (item.skuName === "Premium") {
      if (item.skuCapacity > 1 && item.avgCapacityPercentage < 30) {
        const reducedPUs = Math.max(1, Math.floor(item.skuCapacity / 2));
        const unitSavings = (item.skuCapacity - reducedPUs) * 350.0;
        actions.push({
          id: `rem-eh-pu-${item.id}`,
          resourceId: item.id,
          resourceName: item.name,
          title: `Rightsizing de PUs Premium en '${item.name}' (${item.skuCapacity} -> ${reducedPUs} PUs)`,
          description: `El namespace cuenta con ${item.skuCapacity} Processing Units ($${item.costMtdUSD.toFixed(
            2
          )}/mes) pero su capacidad promedio es de solo ${item.avgCapacityPercentage.toFixed(
            1
          )}%. Reducir a ${reducedPUs} PU optimiza la reserva ahorrando $${unitSavings.toFixed(
            2
          )} USD/mes.`,
          category: "SKU_DOWNGRADE",
          estimatedSavingsUSD: unitSavings,
          confidence: "HIGH",
          actionType: "REDUCE_UNITS",
          currentCapacity: item.skuCapacity,
          recommendedCapacity: reducedPUs,
          commandPayload: `az eventhubs namespace update --name "${item.name}" --resource-group "${item.resourceGroup}" --capacity ${reducedPUs}`,
        });
      } else if (item.avgCapacityPercentage < 20 && item.totalIngressBytes < 50 * 1024 * 1024 * 1024) {
        // Tráfico menor a 50GB/mes y uso < 20% -> Standard
        const standardCost = 22.0 * 2; // 2 TUs
        const savings = Math.max(0, item.costMtdUSD - standardCost);
        actions.push({
          id: `rem-eh-std-${item.id}`,
          resourceId: item.id,
          resourceName: item.name,
          title: `Arbitraje de SKU Premium -> Standard en '${item.name}'`,
          description: `El namespace Premium procesa bajo volumen (${(
            item.totalIngressBytes /
            (1024 * 1024 * 1024)
          ).toFixed(1)} GB/mes) con ${item.avgCapacityPercentage.toFixed(
            1
          )}% de capacidad. Migrar a Standard con 2 TUs reduce el costo mensual a ~$44 USD/mes ahorrando $${savings.toFixed(
            2
          )} USD/mes.`,
          category: "SKU_DOWNGRADE",
          estimatedSavingsUSD: Number(savings.toFixed(2)),
          confidence: "HIGH",
          actionType: "DOWNGRADE_TO_STANDARD",
          currentSku: "Premium",
          recommendedSku: "Standard",
          commandPayload: `az eventhubs namespace update --name "${item.name}" --resource-group "${item.resourceGroup}" --sku Standard --capacity 2`,
        });
      }
    }

    // Regla 2: Optimización de Auto-inflate en Standard (Auto-inflate habilitado pero utilización < 50%)
    if (
      item.skuName === "Standard" &&
      item.autoInflateEnabled &&
      item.avgCapacityPercentage < 40 &&
      item.skuCapacity > 2
    ) {
      const reducedTUs = 1;
      const savings = (item.skuCapacity - reducedTUs) * 22.0;
      actions.push({
        id: `rem-eh-autoinflate-${item.id}`,
        resourceId: item.id,
        resourceName: item.name,
        title: `Optimización de Auto-inflate y Capacidad Base en '${item.name}'`,
        description: `El namespace tiene Auto-inflate activado con ${item.skuCapacity} TUs fijas y utilización media de ${item.avgCapacityPercentage.toFixed(
          1
        )}%. Reducir la capacidad base a ${reducedTUs} TU con auto-escalado hasta 5 TUs previene el pago por capacidad ociosa ($${savings.toFixed(
          2
        )} USD/mes de ahorro).`,
        category: "AUTO_INFLATE_OPTIMIZE",
        estimatedSavingsUSD: Number(savings.toFixed(2)),
        confidence: "MEDIUM",
        actionType: "OPTIMIZE_AUTO_INFLATE",
        currentCapacity: item.skuCapacity,
        recommendedCapacity: reducedTUs,
        commandPayload: `az eventhubs namespace update --name "${item.name}" --resource-group "${item.resourceGroup}" --capacity 1 --enable-auto-inflate true --maximum-throughput-units 5`,
      });
    }

    // Regla 3: Rightsizing de Event Hubs Huérfanos
    if (item.isOrphan) {
      actions.push({
        id: `rem-eh-orphan-${item.id}`,
        resourceId: item.id,
        resourceName: item.name,
        title: `Purga de Namespace/Instancia Huérfana '${item.name}'`,
        description: `El namespace '${item.name}' no ha registrado eventos de Ingress ni Egress en los últimos 30 días (${item.eventHubsCount} Event Hubs inactivos). Se recomienda su eliminación para eliminar costos fijos ($${item.costMtdUSD.toFixed(
          2
        )} USD/mes).`,
        category: "ORPHAN_PURGE",
        estimatedSavingsUSD: item.costMtdUSD > 0 ? item.costMtdUSD : 22.0,
        confidence: "HIGH",
        actionType: "PURGE_ORPHAN",
        commandPayload: `az eventhubs namespace delete --name "${item.name}" --resource-group "${item.resourceGroup}"`,
      });
    }
  }

  return actions;
}

/**
 * Generates mock data for demo tenants and offline development
 */
export function generateMockEventHubsData(): EventHubsPayload {
  const items: EventHubsResourceItem[] = [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-streaming-prod/providers/Microsoft.EventHub/namespaces/eh-telemetry-prod",
      name: "eh-telemetry-prod",
      location: "eastus2",
      resourceGroup: "rg-streaming-prod",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      skuName: "Premium",
      skuCapacity: 4,
      avgCapacityPercentage: 24.5,
      totalIngressBytes: 4.8 * 1024 * 1024 * 1024 * 1024, // 4.8 TB
      totalEgressBytes: 12.2 * 1024 * 1024 * 1024 * 1024, // 12.2 TB
      costMtdUSD: 1400.0,
      costPreviousPeriodUSD: 1400.0,
      forecastEomUSD: 1400.0,
      eventHubsCount: 16,
      autoInflateEnabled: false,
      zoneRedundant: true,
      throttledRequests: 0,
      avgLatencyMs: 14.2,
      isOrphan: false,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-iot-hub/providers/Microsoft.EventHub/namespaces/eh-iot-ingestion",
      name: "eh-iot-ingestion",
      location: "westeurope",
      resourceGroup: "rg-iot-hub",
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      subscriptionName: "Production Core",
      skuName: "Standard",
      skuCapacity: 6,
      avgCapacityPercentage: 32.0,
      totalIngressBytes: 850 * 1024 * 1024 * 1024, // 850 GB
      totalEgressBytes: 1.8 * 1024 * 1024 * 1024 * 1024, // 1.8 TB
      costMtdUSD: 132.0,
      costPreviousPeriodUSD: 132.0,
      forecastEomUSD: 132.0,
      eventHubsCount: 8,
      autoInflateEnabled: true,
      maximumThroughputUnits: 10,
      zoneRedundant: false,
      throttledRequests: 12,
      avgLatencyMs: 18.5,
      isOrphan: false,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-analytics-dev/providers/Microsoft.EventHub/namespaces/eh-analytics-dev",
      name: "eh-analytics-dev",
      location: "eastus",
      resourceGroup: "rg-analytics-dev",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Dev/Test Sandbox",
      skuName: "Premium",
      skuCapacity: 1,
      avgCapacityPercentage: 8.2,
      totalIngressBytes: 15 * 1024 * 1024 * 1024, // 15 GB
      totalEgressBytes: 22 * 1024 * 1024 * 1024, // 22 GB
      costMtdUSD: 350.0,
      costPreviousPeriodUSD: 350.0,
      forecastEomUSD: 350.0,
      eventHubsCount: 3,
      autoInflateEnabled: false,
      zoneRedundant: false,
      throttledRequests: 0,
      avgLatencyMs: 9.8,
      isOrphan: false,
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-legacy-pipeline/providers/Microsoft.EventHub/namespaces/eh-legacy-logs",
      name: "eh-legacy-logs",
      location: "centralus",
      resourceGroup: "rg-legacy-pipeline",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Dev/Test Sandbox",
      skuName: "Basic",
      skuCapacity: 1,
      avgCapacityPercentage: 0.0,
      totalIngressBytes: 0,
      totalEgressBytes: 0,
      costMtdUSD: 11.0,
      costPreviousPeriodUSD: 11.0,
      forecastEomUSD: 11.0,
      eventHubsCount: 1,
      autoInflateEnabled: false,
      zoneRedundant: false,
      throttledRequests: 0,
      avgLatencyMs: 0,
      isOrphan: true,
    },
  ];

  const recommendations = generateEventHubsRecommendations(items);
  const summary = calculateEventHubsSummary(items, recommendations);

  const skuMap: Record<string, { count: number; costUSD: number; color: string }> = {
    Dedicated: { count: 0, costUSD: 0, color: EVENTHUBS_SKU_COLORS.Dedicated },
    Premium: { count: 0, costUSD: 0, color: EVENTHUBS_SKU_COLORS.Premium },
    Standard: { count: 0, costUSD: 0, color: EVENTHUBS_SKU_COLORS.Standard },
    Basic: { count: 0, costUSD: 0, color: EVENTHUBS_SKU_COLORS.Basic },
  };

  for (const item of items) {
    if (skuMap[item.skuName]) {
      skuMap[item.skuName].count += 1;
      skuMap[item.skuName].costUSD += item.costMtdUSD;
    }
  }

  const skuDistribution: EventHubsSkuDistributionItem[] = Object.entries(skuMap)
    .filter(([_, data]) => data.count > 0)
    .map(([sku, data]) => ({
      sku,
      count: data.count,
      costUSD: Number(data.costUSD.toFixed(2)),
      color: data.color,
    }));

  const trendHistory: EventHubsTrendDataPoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().split("T")[0];
    const ingressMB = Math.round(180000 + Math.sin(i / 3) * 35000 + (30 - i) * 1500);
    const egressMB = Math.round(ingressMB * 2.5 + Math.cos(i / 2) * 20000);
    const costUSD = Number((summary.costMtdUSD / 30 + (Math.random() * 5 - 2.5)).toFixed(2));
    trendHistory.push({
      date: dateStr,
      ingressMB,
      egressMB,
      costUSD,
    });
  }

  return {
    summary,
    items,
    remediationActions: recommendations,
    skuDistribution,
    trendHistory,
    source: "mock",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Fetches real Azure Event Hubs namespaces using Azure Resource Graph and CostSnapshots
 */
export async function fetchEventHubsData(tenantId: string): Promise<EventHubsPayload> {
  const credentials = await getAzureCredential(tenantId);
  const subscriptionIds = await getSubscriptionsForTenant(tenantId, credentials);

  if (!subscriptionIds || subscriptionIds.length === 0) {
    return {
      summary: {
        costMtdUSD: 0,
        totalNamespaces: 0,
        totalIngressMTD: 0,
        totalEventHubs: 0,
        potentialSavingsUSD: 0,
      },
      items: [],
      remediationActions: [],
      skuDistribution: [],
      trendHistory: [],
      source: "live",
      lastUpdated: new Date().toISOString(),
    };
  }

  const client = new ResourceGraphClient(credentials);

  const query = `
    resources
    | where type =~ 'microsoft.eventhub/namespaces'
    | project id, name, location, resourceGroup, subscriptionId, sku, properties
  `;

  let rawRows: any[] = [];
  try {
    const response = await client.resources({
      query,
      subscriptions: subscriptionIds,
    });
    rawRows = response.data || [];
  } catch (err) {
    console.warn("[azure-eventhubs] ARG query failed:", err instanceof Error ? err.message : err);
  }

  const items: EventHubsResourceItem[] = [];

  // Query DB cost snapshots for real costs
  const costMap = new Map<string, { costMtd: number; costPrev: number }>();
  try {
    const [costRows] = await pool.query<any[]>(
      `SELECT resource_id, 
              SUM(CASE WHEN usage_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN cost ELSE 0 END) as cost_mtd,
              SUM(CASE WHEN usage_date < DATE_FORMAT(NOW(), '%Y-%m-01') AND usage_date >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 MONTH) THEN cost ELSE 0 END) as cost_prev
       FROM CostSnapshots 
       WHERE tenant_id = ? AND service_name LIKE '%Event Hub%'
       GROUP BY resource_id`,
      [tenantId]
    );

    if (Array.isArray(costRows)) {
      for (const r of costRows) {
        costMap.set(String(r.resource_id).toLowerCase(), {
          costMtd: Number(r.cost_mtd) || 0,
          costPrev: Number(r.cost_prev) || 0,
        });
      }
    }
  } catch {
    // Non-fatal if CostSnapshots table is querying or empty
  }

  for (const row of rawRows) {
    const subId = String(row.subscriptionId || "").toLowerCase();
    const subName = subId ? `Sub (${subId.slice(0, 8)}...)` : "Subscription";
    const skuObj = row.sku || {};
    const props = row.properties || {};

    let skuName: EventHubsSkuName = "Standard";
    const rawSku = String(skuObj.name || "").toLowerCase();
    if (rawSku.includes("dedicated") || rawSku.includes("cluster")) {
      skuName = "Dedicated";
    } else if (rawSku.includes("premium")) {
      skuName = "Premium";
    } else if (rawSku.includes("basic")) {
      skuName = "Basic";
    }

    const skuCapacity = Number(skuObj.capacity) || 1;
    const baseRate = EVENTHUBS_SKU_BASE_COST[skuName] || 22.0;

    const resourceIdLower = String(row.id || "").toLowerCase();
    const dbCost = costMap.get(resourceIdLower);
    const costMtdUSD = dbCost ? dbCost.costMtd : Number((baseRate * skuCapacity).toFixed(2));
    const costPreviousPeriodUSD = dbCost ? dbCost.costPrev : costMtdUSD;
    const forecastEomUSD = Number((costMtdUSD * 1.05).toFixed(2));

    const autoInflateEnabled = Boolean(props.isAutoInflateEnabled || props.autoInflateEnabled);
    const maximumThroughputUnits = Number(props.maximumThroughputUnits) || undefined;
    const zoneRedundant = Boolean(props.zoneRedundant);

    items.push({
      id: String(row.id || ""),
      name: String(row.name || "eh-namespace"),
      location: String(row.location || "unknown"),
      resourceGroup: String(row.resourceGroup || "unknown"),
      subscriptionId: String(row.subscriptionId || ""),
      subscriptionName: subName,
      skuName,
      skuCapacity,
      avgCapacityPercentage: 35.0, // Default live placeholder
      totalIngressBytes: 0,
      totalEgressBytes: 0,
      costMtdUSD,
      costPreviousPeriodUSD,
      forecastEomUSD,
      eventHubsCount: 1,
      autoInflateEnabled,
      maximumThroughputUnits,
      zoneRedundant,
      isOrphan: false,
    });
  }

  const recommendations = generateEventHubsRecommendations(items);
  const summary = calculateEventHubsSummary(items, recommendations);

  const skuMap: Record<string, { count: number; costUSD: number; color: string }> = {
    Dedicated: { count: 0, costUSD: 0, color: EVENTHUBS_SKU_COLORS.Dedicated },
    Premium: { count: 0, costUSD: 0, color: EVENTHUBS_SKU_COLORS.Premium },
    Standard: { count: 0, costUSD: 0, color: EVENTHUBS_SKU_COLORS.Standard },
    Basic: { count: 0, costUSD: 0, color: EVENTHUBS_SKU_COLORS.Basic },
  };

  for (const item of items) {
    if (skuMap[item.skuName]) {
      skuMap[item.skuName].count += 1;
      skuMap[item.skuName].costUSD += item.costMtdUSD;
    }
  }

  const skuDistribution: EventHubsSkuDistributionItem[] = Object.entries(skuMap)
    .filter(([_, data]) => data.count > 0)
    .map(([sku, data]) => ({
      sku,
      count: data.count,
      costUSD: Number(data.costUSD.toFixed(2)),
      color: data.color,
    }));

  return {
    summary,
    items,
    remediationActions: recommendations,
    skuDistribution,
    trendHistory: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Builds Azure CLI and PowerShell remediation scripts for Event Hubs optimization
 */
export function buildEventHubsRemediationCommand(action: EventHubsRemediationAction): {
  cli: string;
  powershell: string;
} {
  const resourceName = action.resourceName || action.resourceId.split("/").pop() || "eh-namespace";
  const rg = action.resourceId.split("/")[4] || "rg-eventhubs";

  if (action.category === "SKU_DOWNGRADE") {
    if (action.actionType === "REDUCE_UNITS" && action.recommendedCapacity) {
      const cap = action.recommendedCapacity;
      return {
        cli:
          action.commandPayload ||
          `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --capacity ${cap}`,
        powershell: `# PowerShell Azure CLI - Rightsizing de PUs/TUs\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuCapacity ${cap}`,
      };
    }
    return {
      cli:
        action.commandPayload ||
        `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --sku Standard --capacity 2`,
      powershell: `# PowerShell Azure CLI - Arbitraje a SKU Standard\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuName Standard -SkuCapacity 2`,
    };
  }

  if (action.category === "AUTO_INFLATE_OPTIMIZE") {
    return {
      cli:
        action.commandPayload ||
        `az eventhubs namespace update --name "${resourceName}" --resource-group "${rg}" --capacity 1 --enable-auto-inflate true --maximum-throughput-units 5`,
      powershell: `# PowerShell Azure CLI - Ajustar Auto-inflate y Capacidad Base\nSet-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}" -SkuCapacity 1 -EnableAutoInflate $true -MaximumThroughputUnits 5`,
    };
  }

  return {
    cli:
      action.commandPayload ||
      `az eventhubs namespace delete --name "${resourceName}" --resource-group "${rg}" --yes`,
    powershell: `# PowerShell - Eliminar namespace huérfano\nRemove-AzEventHubNamespace -ResourceGroupName "${rg}" -Name "${resourceName}"`,
  };
}

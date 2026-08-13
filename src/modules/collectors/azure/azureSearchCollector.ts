import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { Decimal } from "decimal.js";

interface SearchResource {
  id: string;
  name: string;
  resourceGroup: string;
  region: string;
  skuName: string;
  replicaCount: number;
  partitionCount: number;
}

interface SearchMetrics {
  qps: number;
  latencyMs: number;
  throttledPercent: number;
  cpuPercent: number;
}

const SKU_PRICING: Record<string, number> = {
  free: 0,
  basic: 75,
  standard: 250,
  s1: 250,
  s2: 1000,
  s3: 4000,
  l1: 1000,
  l2: 4000,
};

const STORAGE_COST_PER_GB = 0.25;

export async function getAzureSearchResources(tenantId: string): Promise<SearchResource[]> {
  const query = `
    resources
    | where type == "microsoft.search/searchservices"
    | extend replicaCount = toint(properties.replicaCount)
    | extend partitionCount = toint(properties.partitionCount)
    | extend skuName = tolower(sku.name)
    | project 
        id,
        name,
        resourceGroup,
        location,
        skuName,
        replicaCount,
        partitionCount
  `;

  const results: SearchResource[] = [];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return results;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    const rows = (response.data as any[]) || [];

    for (const row of rows) {
      results.push({
        id: row.id,
        name: row.name,
        resourceGroup: row.resourceGroup,
        region: row.location || "Unknown",
        skuName: row.skuName || "standard",
        replicaCount: row.replicaCount || 1,
        partitionCount: row.partitionCount || 1,
      });
    }
  } catch (err) {
    console.error("[azureSearchCollector] Error fetching resources:", err);
  }

  return results;
}

export async function getAzureSearchMetrics(
  tenantId: string,
  resourceId: string,
  subscriptionId: string
): Promise<SearchMetrics> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
  const timespan = `${startTime.toISOString()}/${endTime.toISOString()}`;

  const metrics: SearchMetrics = {
    qps: 0,
    latencyMs: 0,
    throttledPercent: 0,
    cpuPercent: 0,
  };

  try {
    const credential = await getAzureCredential(tenantId);
    const monitorClient = new MonitorClient(credential, subscriptionId);

    const metricNames = ["SearchQueriesPerSecond", "SearchLatency", "ThrottledSearchQueriesPercentage"];

    for (const metricName of metricNames) {
      try {
        const data = await monitorClient.metrics.list(resourceId, {
          timespan,
          interval: "P1D",
          metricnames: metricName,
          aggregation: "Average",
        });

        if (data.value && data.value.length > 0) {
          const latestMetric = data.value[0];
          if (latestMetric.timeseries && latestMetric.timeseries.length > 0) {
            const dataPoints = latestMetric.timeseries[0].data || [];
            if (dataPoints.length > 0) {
              const latest = dataPoints[dataPoints.length - 1];
              if (metricName === "SearchQueriesPerSecond") metrics.qps = latest.average || 0;
              else if (metricName === "SearchLatency") metrics.latencyMs = latest.average || 0;
              else if (metricName === "ThrottledSearchQueriesPercentage")
                metrics.throttledPercent = latest.average || 0;
            }
          }
        }
      } catch (err: any) {
        if (!err.message?.includes("Metric definition not found")) {
          console.warn(`[azureSearchCollector] Metric ${metricName} not found for ${resourceId}`);
        }
      }
    }

    metrics.cpuPercent = Math.min(100, (metrics.qps / 1000) * 80);
  } catch (err) {
    console.error(`[azureSearchCollector] Error fetching metrics for ${resourceId}:`, err);
  }

  return metrics;
}

export async function syncAzureSearchSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const resources = await getAzureSearchResources(tenantId);
    console.log(`[azureSearchCollector] Found ${resources.length} resources for tenant ${tenantId}`);

    if (resources.length === 0) return;

    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    const subId = subs[0] || "unknown";

    for (const resource of resources) {
      try {
        const metrics = await getAzureSearchMetrics(tenantId, resource.id, subId);

        const computeCost = new Decimal(resource.replicaCount)
          .times(resource.partitionCount)
          .times(SKU_PRICING[resource.skuName] || SKU_PRICING.standard);

        const totalCost = computeCost.toNumber();
        const utilizationPercent = Math.min(100, Math.floor(metrics.cpuPercent));

        await pool.query(
          `
          INSERT INTO AzureSearchSnapshots (
            tenantId, snapshotDate, resourceId, resourceName, resourceGroup, region, 
            skuName, replicaCount, partitionCount, monthlyCostUSD, costBreakdown_compute,
            usage_qps, usage_latencyMs, usage_throttledPercent, utilizationPercent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            monthlyCostUSD = VALUES(monthlyCostUSD),
            costBreakdown_compute = VALUES(costBreakdown_compute),
            usage_qps = VALUES(usage_qps),
            usage_latencyMs = VALUES(usage_latencyMs),
            usage_throttledPercent = VALUES(usage_throttledPercent),
            utilizationPercent = VALUES(utilizationPercent),
            updatedAt = CURRENT_TIMESTAMP
          `,
          [
            tenantId,
            snapshotDate,
            resource.id,
            resource.name,
            resource.resourceGroup,
            resource.region,
            resource.skuName,
            resource.replicaCount,
            resource.partitionCount,
            totalCost,
            totalCost,
            metrics.qps,
            metrics.latencyMs,
            metrics.throttledPercent,
            utilizationPercent,
          ]
        );

        console.log(
          `[azureSearchCollector] Synced ${resource.name} (${totalCost.toFixed(2)} USD, ${utilizationPercent}% util)`
        );
      } catch (err) {
        console.error(`[azureSearchCollector] Error syncing ${resource.name}:`, err);
      }
    }
  } catch (err) {
    console.error(`[azureSearchCollector] Error for tenant ${tenantId}:`, err);
  }
}

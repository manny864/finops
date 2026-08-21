import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';

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

export async function getAzureSearchResources(tenantId: string): Promise<SearchResource[]> {
  const query = `
    resources
    | where type =~ "microsoft.search/searchservices"
    | extend replicaCount = coalesce(toint(properties.replicaCount), 1)
    | extend partitionCount = coalesce(toint(properties.partitionCount), 1)
    | extend skuName = tolower(coalesce(tostring(sku.name), tostring(properties.sku.name), 'standard'))
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
    const subs = await getSubscriptionsForTenant(tenantId, credential).catch(() => []);

    const argClient = new ResourceGraphClient(credential);
    const requestOptions = subs.length > 0 ? { query, subscriptions: subs } : { query };
    const response = await argClient.resources(requestOptions);
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

export async function getAzureSearchRealCost(
  tenantId: string,
  credential: any,
  resourceId: string,
  subscriptionId: string
): Promise<number> {
  // 1. Consultar Azure Cost Management MTD
  try {
    const sub = subscriptionId && subscriptionId !== "unknown" ? subscriptionId : (resourceId.split("/")[2] || "");
    if (sub && credential) {
      const costMgmtClient = new CostManagementClient(credential);
      const scope = `/subscriptions/${sub}`;

      const idVariants = [
        resourceId,
        resourceId.toLowerCase(),
        resourceId.toUpperCase(),
      ];

      const query = {
        type: "Usage",
        timeframe: "MonthToDate",
        dataset: {
          granularity: "None",
          aggregation: {
            totalCost: {
              name: "PreTaxCost",
              function: "Sum",
            },
          },
          filter: {
            dimensions: {
              name: "ResourceId",
              operator: "In",
              values: idVariants,
            },
          },
        },
      };

      const result = await costMgmtClient.query.usage(scope, query as any);
      const rows = (result.rows || []) as any[];

      if (rows.length > 0 && rows[0]?.[0] !== undefined) {
        const val = parseFloat(rows[0][0]);
        if (!isNaN(val)) return val;
      }
      return 0;
    }
  } catch (err) {
    console.warn(`[azureSearchCollector] Cost Management query failed for ${resourceId}:`, err);
  }

  // 2. Fallback a CostMeterSnapshots en DB
  try {
    const [meterRows]: any = await pool.query(
      `
      SELECT COALESCE(SUM(cost_usd), 0) as totalCost
      FROM CostMeterSnapshots
      WHERE tenant_id = ?
        AND LOWER(resource_id) = LOWER(?)
        AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      `,
      [tenantId, resourceId]
    );

    if (meterRows && meterRows.length > 0) {
      const val = parseFloat(meterRows[0].totalCost || 0);
      if (val > 0) return val;
    }
  } catch (meterErr) {
    console.warn(`[azureSearchCollector] CostMeterSnapshots query error:`, meterErr);
  }

  // 3. Fallback a CostSnapshots en DB
  try {
    const [costSnapRows]: any = await pool.query(
      `
      SELECT COALESCE(SUM(cost_usd), 0) as totalCost
      FROM CostSnapshots
      WHERE tenant_id = ?
        AND LOWER(ResourceId) = LOWER(?)
        AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      `,
      [tenantId, resourceId]
    );

    if (costSnapRows && costSnapRows.length > 0) {
      const val = parseFloat(costSnapRows[0].totalCost || 0);
      if (val > 0) return val;
    }
  } catch (snapErr) {
    console.warn(`[azureSearchCollector] CostSnapshots query error:`, snapErr);
  }

  return 0;
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
    const sub = subscriptionId && subscriptionId !== "unknown" ? subscriptionId : (resourceId.split("/")[2] || "");
    if (!sub) return metrics;
    const monitorClient = new MonitorClient(credential, sub);

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
      } catch (err) {
        if (!errorMessage(err)?.includes("Metric definition not found")) {
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

    for (const resource of resources) {
      try {
        const resourceSubId = resource.id.split("/")[2] || "unknown";
        const metrics = await getAzureSearchMetrics(tenantId, resource.id, resourceSubId);
        const realCost = await getAzureSearchRealCost(tenantId, credential, resource.id, resourceSubId);

        const totalCost = realCost;
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

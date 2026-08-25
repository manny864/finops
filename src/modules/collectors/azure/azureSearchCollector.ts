import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { getSubscriptionMeterUsage } from "@/modules/collectors/azure/foundryCollector";
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
  /** Set when the resource was recovered from billing (cost already known). */
  billedCostUSD?: number;
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
  const resourceName = (resourceId.split("/").pop() || resourceId).toLowerCase();
  const sub = subscriptionId && subscriptionId !== "unknown" ? subscriptionId : (resourceId.split("/")[2] || "");

  // 1. Consultar Azure Cost Management MTD
  try {
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
        if (!isNaN(val) && val > 0) return val;
      }
    }
  } catch (err) {
    console.warn(`[azureSearchCollector] Cost Management query failed for ${resourceId}:`, err);
  }

  // 2. Fallback a CostMeterSnapshots en DB con coincidencia flexible por ID, nombre, servicio y medidor standard-s1
  try {
    const [meterRows]: any = await pool.query(
      `
      SELECT COALESCE(SUM(cost_usd), 0) as totalCost
      FROM CostMeterSnapshots
      WHERE tenant_id = ?
        AND (
          LOWER(resource_id) = LOWER(?)
          OR LOWER(resource_id) LIKE CONCAT('%', ?, '%')
          OR LOWER(MeterName) LIKE '%standard-s1%'
          OR LOWER(MeterSubCategory) LIKE '%standard-s1%'
          OR (
            (
              LOWER(service_name) LIKE '%search%' 
              OR LOWER(MeterCategory) LIKE '%search%' 
              OR LOWER(MeterName) LIKE '%search%'
              OR LOWER(MeterSubCategory) LIKE '%search%'
              OR ((LOWER(service_name) LIKE '%cognitive%' OR LOWER(MeterCategory) LIKE '%cognitive%') AND (LOWER(MeterName) LIKE '%standard-s1%' OR LOWER(MeterSubCategory) LIKE '%standard-s1%'))
            )
            AND (LOWER(subscription_id) = LOWER(?) OR ? = '')
          )
        )
        AND date >= DATE_SUB(CURDATE(), INTERVAL 35 DAY)
      `,
      [tenantId, resourceId, resourceName, sub, sub]
    );

    if (meterRows && meterRows.length > 0) {
      const val = parseFloat(meterRows[0].totalCost || 0);
      if (val > 0) return val;
    }
  } catch (meterErr) {
    console.warn(`[azureSearchCollector] CostMeterSnapshots query error:`, meterErr);
  }

  // 3. Fallback a CostSnapshots en DB con coincidencia flexible
  try {
    const [costSnapRows]: any = await pool.query(
      `
      SELECT COALESCE(SUM(cost_usd), 0) as totalCost
      FROM CostSnapshots
      WHERE tenant_id = ?
        AND (
          LOWER(ResourceId) = LOWER(?)
          OR LOWER(ResourceId) LIKE CONCAT('%', ?, '%')
          OR LOWER(MeterName) LIKE '%standard-s1%'
          OR LOWER(MeterSubCategory) LIKE '%standard-s1%'
          OR (
            (
              LOWER(service_name) LIKE '%search%' 
              OR LOWER(MeterCategory) LIKE '%search%' 
              OR LOWER(MeterName) LIKE '%search%'
              OR LOWER(MeterSubCategory) LIKE '%search%'
              OR ((LOWER(service_name) LIKE '%cognitive%' OR LOWER(MeterCategory) LIKE '%cognitive%') AND (LOWER(MeterName) LIKE '%standard-s1%' OR LOWER(MeterSubCategory) LIKE '%standard-s1%'))
            )
            AND (LOWER(subscription_id) = LOWER(?) OR ? = '')
          )
        )
        AND date >= DATE_SUB(CURDATE(), INTERVAL 35 DAY)
      `,
      [tenantId, resourceId, resourceName, sub, sub]
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

/**
 * Recover Search services from Cost Management when Resource Graph cannot see
 * them. Resource Graph only returns resources the Service Principal holds a
 * Reader role on, but billing is scoped to the subscription and still reports
 * the charge — so a service with a real bill would otherwise vanish from the
 * UI as "no telemetry".
 */
async function getBilledSearchResources(
  credential: any,
  subs: string[]
): Promise<SearchResource[] | null> {
  const byResource = new Map<string, { cost: number; meter: string }>();
  let anyQuerySucceeded = false;

  for (const sub of subs) {
    const meters = await getSubscriptionMeterUsage(credential, sub);
    if (meters === null) continue; // throttled/failed — not proof of absence
    anyQuerySucceeded = true;
    for (const m of meters) {
      const rid = m.resourceId.toLowerCase();
      if (!rid.includes("/providers/microsoft.search/searchservices/")) continue;
      const entry = byResource.get(rid) || { cost: 0, meter: m.meterName };
      entry.cost += m.costUSD;
      byResource.set(rid, entry);
    }
  }

  if (!anyQuerySucceeded) return null;

  return Array.from(byResource.entries(), ([rid, { cost, meter }]) => ({
    id: rid,
    name: rid.split("/").pop() || "unknown",
    resourceGroup: rid.split("/resourcegroups/")[1]?.split("/")[0] || "unknown",
    region: "unknown",
    // Meters read like "Standard S1 Unit" — the tier is the usable part.
    skuName: (meter.match(/\b(basic|free|standard\s*s?\d*|s\d)\b/i)?.[0] || "standard")
      .toLowerCase()
      .replace(/\s+/g, ""),
    replicaCount: 1,
    partitionCount: 1,
    billedCostUSD: cost,
  }));
}

export async function syncAzureSearchSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    let resources = await getAzureSearchResources(tenantId);
    console.log(`[azureSearchCollector] Found ${resources.length} resources for tenant ${tenantId}`);

    if (resources.length === 0) {
      // Not necessarily gone — Resource Graph hides what the SP can't read.
      // Ask billing before assuming the service was deleted.
      const subs = await getSubscriptionsForTenant(tenantId, credential).catch(() => []);
      const billed = await getBilledSearchResources(credential, subs);

      if (billed === null) {
        console.warn(
          `[azureSearchCollector] Billing lookup failed for ${tenantId}; keeping previous snapshots`
        );
        return;
      }

      resources = billed;
      console.log(`[azureSearchCollector] Recovered ${resources.length} resources from billing`);
    }

    if (resources.length === 0) {
      // Confirmed absent by both Resource Graph and billing: drop stale rows.
      await pool.query(
        `DELETE FROM AzureSearchSnapshots WHERE tenantId = ?`,
        [tenantId]
      );
      return;
    }

    for (const resource of resources) {
      try {
        const resourceSubId = resource.id.split("/")[2] || "unknown";
        // Metrics need Reader on the resource; a billing-only resource has none.
        const metrics = await getAzureSearchMetrics(tenantId, resource.id, resourceSubId).catch(
          () => ({ qps: 0, latencyMs: 0, throttledPercent: 0, cpuPercent: 0 })
        );
        const realCost =
          resource.billedCostUSD ??
          (await getAzureSearchRealCost(tenantId, credential, resource.id, resourceSubId));

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

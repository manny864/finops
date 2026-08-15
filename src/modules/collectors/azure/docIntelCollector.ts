import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { Decimal } from "decimal.js";

export interface DocIntelResource {
  id: string;
  name: string;
  resourceGroup: string;
  region: string;
  tier: string;
}

const COST_PER_PAGE = {
  f0: 0,
  s0_prebuilt: 0.0198,
  s0_custom: 0.03,
};

export async function getDocIntelResources(tenantId: string): Promise<DocIntelResource[]> {
  const query = `
    resources
    | where type =~ "microsoft.cognitiveservices/accounts" and kind =~ "FormRecognizer|DocumentIntelligence"
    | project id, name, resourceGroup, location, sku = sku.name
  `;

  const results: DocIntelResource[] = [];

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
        tier: (row.sku || "s0").toLowerCase(),
      });
    }
  } catch (err) {
    console.error("[docIntelCollector] Error fetching resources:", err);
  }

  return results;
}

export async function getDocIntelRealCost(
  tenantId: string,
  credential: any,
  resourceId: string,
  subscriptionId: string
): Promise<number> {
  try {
    const sub = subscriptionId && subscriptionId !== "unknown" ? subscriptionId : (resourceId.split("/")[2] || "");
    if (sub && credential) {
      const costMgmtClient = new CostManagementClient(credential);
      const scope = `/subscriptions/${sub}`;

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
              values: [resourceId],
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
    console.warn(`[docIntelCollector] Cost query failed for ${resourceId}:`, err);
  }

  // Fallback to CostMeterSnapshots for Document Intelligence / Form Recognizer
  try {
    const [meterRows]: any = await pool.query(
      `
      SELECT COALESCE(SUM(cost_usd), 0) as totalCost
      FROM CostMeterSnapshots
      WHERE tenant_id = ?
        AND (
          resource_id = ? 
          OR LOWER(service_name) LIKE '%document intelligence%'
          OR LOWER(MeterCategory) LIKE '%document intelligence%'
          OR LOWER(service_name) LIKE '%form recognizer%'
          OR LOWER(MeterCategory) LIKE '%form recognizer%'
        )
        AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      `,
      [tenantId, resourceId]
    );

    if (meterRows && meterRows.length > 0) {
      const val = parseFloat(meterRows[0].totalCost || 0);
      if (val > 0) return val;
    }
  } catch (meterErr) {
    console.warn(`[docIntelCollector] CostMeterSnapshots query error:`, meterErr);
  }

  return 0;
}

export async function getDocIntelMetrics(
  tenantId: string,
  resourceId: string,
  subscriptionId: string
): Promise<{ pagesProcessed: number; latencyMs: number; successRate: number }> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
  const timespan = `${startTime.toISOString()}/${endTime.toISOString()}`;

  const metrics = { pagesProcessed: 0, latencyMs: 0, successRate: 95 };

  try {
    const credential = await getAzureCredential(tenantId);
    const sub = subscriptionId && subscriptionId !== "unknown" ? subscriptionId : (resourceId.split("/")[2] || "");
    if (!sub) return metrics;
    const monitorClient = new MonitorClient(credential, sub);

    const metricNames = ["ProcessedPages", "SuccessfulPages"];

    for (const metricName of metricNames) {
      try {
        const data = await monitorClient.metrics.list(resourceId, {
          timespan,
          interval: "P1D",
          metricnames: metricName,
          aggregation: "Total",
        });

        if (data.value && data.value.length > 0) {
          const latestMetric = data.value[0];
          if (latestMetric.timeseries && latestMetric.timeseries.length > 0) {
            const dataPoints = latestMetric.timeseries[0].data || [];
            if (dataPoints.length > 0) {
              const latest = dataPoints[dataPoints.length - 1];
              if (metricName === "ProcessedPages") metrics.pagesProcessed = latest.total || 0;
            }
          }
        }
      } catch (err: any) {
        console.warn(`[docIntelCollector] Metric ${metricName} not found`);
      }
    }
  } catch (err) {
    console.error(`[docIntelCollector] Error fetching metrics:`, err);
  }

  return metrics;
}

export async function syncDocIntelSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const resources = await getDocIntelResources(tenantId);
    console.log(`[docIntelCollector] Found ${resources.length} resources for tenant ${tenantId}`);

    if (resources.length === 0) return;

    const credential = await getAzureCredential(tenantId);

    for (const resource of resources) {
      try {
        const resourceSubId = resource.id.split("/")[2] || "unknown";
        const metrics = await getDocIntelMetrics(tenantId, resource.id, resourceSubId);
        const realCost = await getDocIntelRealCost(tenantId, credential, resource.id, resourceSubId);

        const costPerPage =
          resource.tier === "f0"
            ? 0
            : resource.tier === "s0"
              ? COST_PER_PAGE.s0_prebuilt
              : 0;

        const estimatedCost = new Decimal(metrics.pagesProcessed).times(costPerPage).toNumber();
        const totalCost = realCost > 0 ? realCost : estimatedCost;

        await pool.query(
          `
          INSERT INTO AzureDocumentIntelligenceSnapshots (
            tenantId, snapshotDate, resourceId, resourceName, resourceGroup, region, 
            tier, monthlyCostUSD, costBreakdown_prebuilt, usage_pagesProcessed, 
            usage_successRate, utilizationPercent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            monthlyCostUSD = VALUES(monthlyCostUSD),
            usage_pagesProcessed = VALUES(usage_pagesProcessed),
            updatedAt = CURRENT_TIMESTAMP
          `,
          [
            tenantId,
            snapshotDate,
            resource.id,
            resource.name,
            resource.resourceGroup,
            resource.region,
            resource.tier,
            totalCost,
            totalCost,
            metrics.pagesProcessed,
            metrics.successRate,
            Math.min(100, Math.floor((metrics.pagesProcessed / 450000) * 100)),
          ]
        );

        console.log(`[docIntelCollector] Synced ${resource.name} (${totalCost.toFixed(2)} USD)`);
      } catch (err) {
        console.error(`[docIntelCollector] Error syncing ${resource.name}:`, err);
      }
    }
  } catch (err) {
    console.error(`[docIntelCollector] Error for tenant ${tenantId}:`, err);
  }
}

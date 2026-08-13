import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { Decimal } from "decimal.js";

interface DocIntelResource {
  id: string;
  name: string;
  resourceGroup: string;
  region: string;
  tier: string;
}

const TIER_PRICING: Record<string, number> = {
  f0: 0,
  s0: 1.5,
};

const COST_PER_PAGE = {
  f0: 0,
  s0_prebuilt: 0.0198,
  s0_custom: 0.03,
};

export async function getDocIntelResources(tenantId: string): Promise<DocIntelResource[]> {
  const query = `
    resources
    | where type == "microsoft.cognitiveservices/accounts" and kind =~ "FormRecognizer|DocumentIntelligence"
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
    const monitorClient = new MonitorClient(credential, subscriptionId);

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
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    const subId = subs[0] || "unknown";

    for (const resource of resources) {
      try {
        const metrics = await getDocIntelMetrics(tenantId, resource.id, subId);

        const costPerPage =
          resource.tier === "f0"
            ? 0
            : resource.tier === "s0"
              ? COST_PER_PAGE.s0_prebuilt
              : 0;

        const totalCost = new Decimal(metrics.pagesProcessed).times(costPerPage).toNumber();

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

        console.log(`[docIntelCollector] Synced ${resource.name}`);
      } catch (err) {
        console.error(`[docIntelCollector] Error syncing ${resource.name}:`, err);
      }
    }
  } catch (err) {
    console.error(`[docIntelCollector] Error for tenant ${tenantId}:`, err);
  }
}

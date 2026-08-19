import { CostManagementClient } from "@azure/arm-costmanagement";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";

/**
 * Fetch Azure AI Foundry deployment profiles from a tenant's subscriptions.
 * Queries for cognitive services accounts (OpenAI deployments) and extracts model endpoints.
 */
async function getFoundryResources(tenantId: string, credential: any, subs: string[]) {
  if (subs.length === 0) return [];

  const query = `
    resources
    | where type =~ "microsoft.cognitiveservices/accounts"
    | where kind in~ ("OpenAI", "AIServices", "CognitiveServices", "AIFoundry", "AIFoundryProject", "Hub", "Project")
    | project 
        id, 
        name, 
        location, 
        resourceGroup,
        kind,
        sku = sku.name,
        endpoint = properties.endpoint
    | order by name asc
  `;

  try {
    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    const rows = (response.data as any[]) || [];
    console.log(`[foundryCollector] Found ${rows.length} Foundry resources`);
    return rows;
  } catch (err) {
    console.error(`[foundryCollector] Resource Graph query failed:`, err);
    return [];
  }
}

/**
 * Fetch monthly cost for a specific Foundry resource using Cost Management API.
 */
export async function getFoundryResourceCost(
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
        if (!isNaN(val)) return val;
      }
      return 0;
    }
  } catch (err) {
    console.error(`[foundryCollector] Cost query failed for ${resourceId}:`, err);
  }

  // Fallback to CostMeterSnapshots for OpenAI / Foundry
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
    console.warn(`[foundryCollector] CostMeterSnapshots query error:`, meterErr);
  }

  return 0;
}

/**
 * Main sync function: collect Foundry resources, costs, and metrics.
 */
export async function syncFoundrySnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);

    if (subs.length === 0) {
      console.log(`[foundryCollector] No subscriptions for tenant ${tenantId}`);
      return;
    }

    const resources = await getFoundryResources(tenantId, credential, subs);

    if (resources.length === 0) {
      console.log(`[foundryCollector] No Foundry resources found for tenant ${tenantId}`);
      return;
    }

    // Process each Foundry resource
    for (const resource of resources) {
      try {
        const subscriptionId = (resource.id as string).split("/")[2];
        const monthlyCostUSD = await getFoundryResourceCost(tenantId, credential, resource.id, subscriptionId);

        await pool.query(
            `
            INSERT INTO AzureFoundrySnapshots (
              tenantId, snapshotDate, resourceId, resourceName, resourceGroup, region,
              deploymentName, modelDeploymentName, modelName, sku,
              monthlyCostUSD, computeCost, storageCost, queryTransactionCost, overheadCost,
              utilizationPercent, usage_promptTokens, usage_completionTokens, usage_finetuningJobs, usage_modelEndpoints
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              monthlyCostUSD = VALUES(monthlyCostUSD),
              computeCost = VALUES(computeCost),
              utilizationPercent = VALUES(utilizationPercent),
              updatedAt = CURRENT_TIMESTAMP
            `,
            [
              tenantId,
              snapshotDate,
              resource.id,
              resource.name,
              resource.resourceGroup || "unknown",
              resource.location || "unknown",
              "unattributed",
              "unattributed",
              "unattributed",
              (resource.sku || "S0").toLowerCase(),
              monthlyCostUSD,
              monthlyCostUSD,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
            ]
          );
      } catch (err) {
        console.error(`[foundryCollector] Error processing resource ${resource.name}:`, err);
      }
    }

    console.log(`[foundryCollector] Synced ${resources.length} Foundry resources for ${tenantId}`);
  } catch (err) {
    console.error(`[foundryCollector] Failed for tenant ${tenantId}:`, err);
  }
}

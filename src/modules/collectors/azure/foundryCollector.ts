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

export interface AzureLiveFoundryDeployment {
  id: string;
  name: string;
  accountName: string;
  accountId: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  modelName: string;
  modelVersion: string;
  modelFormat: string;
  skuName: string;
  capacity: number;
}

/**
 * Discovers all model deployments across all Cognitive Services / Foundry accounts in Azure.
 * Uses Azure Resource Graph first, then falls back to direct ARM REST deployments API.
 */
export async function getAzureFoundryDeployments(tenantId: string): Promise<AzureLiveFoundryDeployment[]> {
  const deployments: AzureLiveFoundryDeployment[] = [];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential).catch(() => []);
    if (subs.length === 0) return [];

    // 1. Query Azure Resource Graph for deployments
    try {
      const argClient = new ResourceGraphClient(credential);
      const query = `
        resources
        | where type =~ "microsoft.cognitiveservices/accounts/deployments"
        | project 
            id, 
            name, 
            resourceGroup, 
            subscriptionId, 
            location,
            modelName = tostring(properties.model.name),
            modelVersion = tostring(properties.model.version),
            modelFormat = tostring(properties.model.format),
            skuName = tostring(sku.name),
            capacity = toint(sku.capacity)
      `;
      const requestOptions = subs.length > 0 ? { query, subscriptions: subs } : { query };
      const response = await argClient.resources(requestOptions);
      const rows = (response.data as any[]) || [];

      for (const row of rows) {
        const idParts = (row.id || "").split("/");
        const accountIdx = idParts.findIndex((p: string) => p.toLowerCase() === "accounts");
        const accountName = accountIdx >= 0 ? idParts[accountIdx + 1] : "unknown";
        const accountId = accountIdx >= 0 ? idParts.slice(0, accountIdx + 2).join("/") : row.id;

        deployments.push({
          id: row.id,
          name: row.name,
          accountName,
          accountId,
          resourceGroup: row.resourceGroup || "unknown",
          subscriptionId: row.subscriptionId || idParts[2] || "unknown",
          location: row.location || "unknown",
          modelName: row.modelName || row.name,
          modelVersion: row.modelVersion || "latest",
          modelFormat: row.modelFormat || "OpenAI",
          skuName: row.skuName || "Standard",
          capacity: row.capacity || 0,
        });
      }
    } catch (argErr) {
      console.warn("[foundryCollector] ARG deployment query warning:", argErr);
    }

    // 2. Direct ARM REST lookup for each account (if ARG found 0 or as enrichment)
    if (deployments.length === 0) {
      const accounts = await getFoundryResources(tenantId, credential, subs);
      try {
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        if (tokenResponse?.token) {
          for (const acc of accounts) {
            try {
              const url = `https://management.azure.com${acc.id}/deployments?api-version=2024-10-01`;
              const resp = await fetch(url, {
                headers: {
                  Authorization: `Bearer ${tokenResponse.token}`,
                  "Content-Type": "application/json",
                },
              });
              if (resp.ok) {
                const data = await resp.json();
                for (const dep of data.value || []) {
                  const model = dep.properties?.model || {};
                  deployments.push({
                    id: dep.id,
                    name: dep.name,
                    accountName: acc.name,
                    accountId: acc.id,
                    resourceGroup: acc.resourceGroup || "unknown",
                    subscriptionId: (acc.id as string).split("/")[2] || "unknown",
                    location: acc.location || "unknown",
                    modelName: model.name || dep.name,
                    modelVersion: model.version || "latest",
                    modelFormat: model.format || "OpenAI",
                    skuName: dep.sku?.name || "Standard",
                    capacity: dep.sku?.capacity || dep.properties?.scaleSettings?.capacity || 0,
                  });
                }
              }
            } catch (armErr) {
              console.warn(`[foundryCollector] Direct ARM deployments lookup failed for ${acc.name}:`, armErr);
            }
          }
        }
      } catch (authErr) {
        console.warn("[foundryCollector] Token acquisition failed for ARM deployments:", authErr);
      }
    }
  } catch (err) {
    console.error("[foundryCollector] Error getting live deployments from Azure:", err);
  }

  return deployments;
}

/**
 * Main sync function: collect Foundry resources, costs, and model deployments.
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

    // Discover live deployments
    const liveDeployments = await getAzureFoundryDeployments(tenantId);
    const deploymentsByAccount = new Map<string, AzureLiveFoundryDeployment[]>();
    for (const dep of liveDeployments) {
      const key = dep.accountId.toLowerCase();
      const arr = deploymentsByAccount.get(key) || [];
      arr.push(dep);
      deploymentsByAccount.set(key, arr);
    }

    // Process each Foundry resource
    for (const resource of resources) {
      try {
        const subscriptionId = (resource.id as string).split("/")[2];
        const monthlyCostUSD = await getFoundryResourceCost(tenantId, credential, resource.id, subscriptionId);
        const accountDeployments = deploymentsByAccount.get((resource.id as string).toLowerCase()) || [];

        if (accountDeployments.length > 0) {
          const costPerDeployment = monthlyCostUSD / accountDeployments.length;
          for (const dep of accountDeployments) {
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
                deploymentName = VALUES(deploymentName),
                modelDeploymentName = VALUES(modelDeploymentName),
                modelName = VALUES(modelName),
                utilizationPercent = VALUES(utilizationPercent),
                updatedAt = CURRENT_TIMESTAMP
              `,
              [
                tenantId,
                snapshotDate,
                `${resource.id}/deployments/${dep.name}`,
                resource.name,
                resource.resourceGroup || "unknown",
                resource.location || "unknown",
                dep.name,
                dep.name,
                dep.modelName,
                (dep.skuName || resource.sku || "Standard").toLowerCase(),
                costPerDeployment,
                costPerDeployment,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                1,
              ]
            );
          }
        } else {
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
        }
      } catch (err) {
        console.error(`[foundryCollector] Error processing resource ${resource.name}:`, err);
      }
    }

    console.log(`[foundryCollector] Synced ${resources.length} Foundry resources and ${liveDeployments.length} deployments for ${tenantId}`);
  } catch (err) {
    console.error(`[foundryCollector] Failed for tenant ${tenantId}:`, err);
  }
}

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
              // Cost Management stores ResourceId lowercased; match every casing
              // so Foundry/OpenAI accounts don't silently return $0.
              values: [resourceId, resourceId.toLowerCase(), resourceId.toUpperCase()],
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

// ── Real per-model cost + tokens (Cost Management grouped by Meter) ──────────

export interface FoundryMeterUsage {
  meterName: string;
  costUSD: number;
  quantity: number;
}

export interface FoundryModelAgg {
  modelName: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
}

// ponytail: Azure OpenAI token meters bill per 1K tokens (UnitOfMeasure "1K"),
// so tokens ≈ quantity × 1000. Bump this if a model's meter bills per 1M.
const TOKEN_UNIT_MULTIPLIER = 1000;

// Words in a Meter name that describe the charge, not the model.
const METER_DESCRIPTOR_WORDS = new Set([
  "inp", "input", "outp", "output", "prompt", "prompts", "completion", "completions",
  "generated", "cached", "cache", "caching", "glbl", "global", "regional", "zone",
  "data", "datazone", "tokens", "token", "images", "image", "hours", "hour",
  "trained", "training", "hosting", "fine", "tune", "tuned", "finetune", "spot",
  "batch", "enterprise", "provisioned", "ptu", "standard", "units", "unit", "per",
  "transactions", "transaction", "requests", "request", "1k", "1m", "characters",
]);

/**
 * Split a Cost Management `Meter` name into a model name + token bucket.
 * e.g. "gpt-4o-0806 Outp glbl Tokens" → { modelName: "gpt-4o-0806", tokenType: "output" }
 */
export function parseFoundryMeter(
  meterName: string
): { modelName: string; tokenType: "input" | "output" | "cached" | "none" } {
  const lower = (meterName || "").toLowerCase();
  let tokenType: "input" | "output" | "cached" | "none" = "none";
  if (lower.includes("token")) {
    if (/cach/.test(lower)) tokenType = "cached";
    else if (/outp|output|completion|generat/.test(lower)) tokenType = "output";
    else tokenType = "input";
  }
  const model = (meterName || "")
    .split(/\s+/)
    .filter((w) => w && !METER_DESCRIPTOR_WORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();
  return { modelName: model || (meterName || "").trim() || "unknown", tokenType };
}

/** Aggregate raw meter rows into per-model cost + input/output tokens. */
export function aggregateFoundryMeters(meters: FoundryMeterUsage[]): FoundryModelAgg[] {
  const byModel = new Map<string, FoundryModelAgg>();
  for (const m of meters) {
    const { modelName, tokenType } = parseFoundryMeter(m.meterName);
    const key = modelName.toLowerCase();
    const agg = byModel.get(key) || { modelName, costUSD: 0, inputTokens: 0, outputTokens: 0 };
    agg.costUSD += m.costUSD;
    const tokens = m.quantity * TOKEN_UNIT_MULTIPLIER;
    if (tokenType === "output") agg.outputTokens += tokens;
    else if (tokenType === "input" || tokenType === "cached") agg.inputTokens += tokens;
    byModel.set(key, agg);
  }
  return Array.from(byModel.values());
}

/**
 * Real MTD cost + token usage per meter for ONE Foundry/Cognitive account,
 * from Azure Cost Management grouped by the `Meter` dimension. The meter name
 * carries the model + token type, so any newly activated model shows up
 * automatically (new deployment → new meter → new row).
 */
export async function getFoundryModelCostsByMeter(
  credential: any,
  resourceId: string,
  subscriptionId: string
): Promise<FoundryMeterUsage[]> {
  const sub = subscriptionId && subscriptionId !== "unknown" ? subscriptionId : (resourceId.split("/")[2] || "");
  if (!sub || !credential) return [];
  const idVariants = [resourceId, resourceId.toLowerCase(), resourceId.toUpperCase()];
  try {
    const costMgmtClient = new CostManagementClient(credential);
    const scope = `/subscriptions/${sub}`;
    const query = {
      type: "Usage",
      timeframe: "MonthToDate",
      dataset: {
        granularity: "None",
        aggregation: {
          totalCost: { name: "PreTaxCost", function: "Sum" },
          totalQty: { name: "UsageQuantity", function: "Sum" },
        },
        grouping: [{ type: "Dimension", name: "Meter" }],
        filter: {
          dimensions: { name: "ResourceId", operator: "In", values: idVariants },
        },
      },
    };
    const result: any = await costMgmtClient.query.usage(scope, query as any);
    const columns = (result.columns || []) as Array<{ name: string }>;
    const rows = (result.rows || []) as any[][];
    const idx = (name: string) => columns.findIndex((c) => c.name === name);
    const meterIdx = idx("Meter");
    const costIdx = idx("CostUSD") >= 0 ? idx("CostUSD") : idx("PreTaxCost");
    const qtyIdx = idx("UsageQuantity");
    const out: FoundryMeterUsage[] = [];
    for (const row of rows) {
      const costUSD = costIdx >= 0 ? Number(row[costIdx] ?? 0) || 0 : 0;
      const quantity = qtyIdx >= 0 ? Number(row[qtyIdx] ?? 0) || 0 : 0;
      const meterName = meterIdx >= 0 ? String(row[meterIdx] ?? "") : "";
      if (costUSD === 0 && quantity === 0) continue;
      out.push({ meterName, costUSD, quantity });
    }
    return out;
  } catch (err) {
    console.warn(`[foundryCollector] Meter breakdown query failed for ${resourceId}:`, err);
    return [];
  }
}

/** Upsert one per-model snapshot row (real cost + tokens). */
async function upsertFoundryModelSnapshot(
  tenantId: string,
  snapshotDate: string,
  resource: any,
  deploymentName: string,
  model: FoundryModelAgg,
  sku: string
): Promise<void> {
  await pool.query(
    `
    INSERT INTO AzureFoundrySnapshots (
      tenantId, snapshotDate, resourceId, resourceName, resourceGroup, region,
      deploymentName, modelDeploymentName, modelName, sku,
      monthlyCostUSD, computeCost, storageCost, queryTransactionCost, overheadCost,
      utilizationPercent, usage_promptTokens, usage_completionTokens, usage_finetuningJobs, usage_modelEndpoints
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 0, 1)
    ON DUPLICATE KEY UPDATE
      monthlyCostUSD = VALUES(monthlyCostUSD),
      computeCost = VALUES(computeCost),
      modelName = VALUES(modelName),
      usage_promptTokens = VALUES(usage_promptTokens),
      usage_completionTokens = VALUES(usage_completionTokens),
      updatedAt = CURRENT_TIMESTAMP
    `,
    [
      tenantId,
      snapshotDate,
      resource.id,
      resource.name,
      resource.resourceGroup || "unknown",
      resource.location || "unknown",
      deploymentName,
      deploymentName,
      model.modelName,
      sku,
      model.costUSD,
      model.costUSD,
      Math.round(model.inputTokens),
      Math.round(model.outputTokens),
    ]
  );
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

    // Drop legacy per-deployment rows (old scheme keyed resourceId by
    // "/deployments/<name>") so the new per-model rows never double-count.
    await pool.query(
      `DELETE FROM AzureFoundrySnapshots WHERE tenantId = ? AND resourceId LIKE '%/deployments/%'`,
      [tenantId]
    ).catch(() => {});

    // Process each Foundry resource → REAL per-model cost + tokens.
    for (const resource of resources) {
      try {
        const subscriptionId = (resource.id as string).split("/")[2];
        const accountDeployments = deploymentsByAccount.get((resource.id as string).toLowerCase()) || [];

        // Idempotent re-run: drop today's rows for this account first so models
        // removed in Azure disappear from the snapshot instead of lingering.
        await pool.query(
          `DELETE FROM AzureFoundrySnapshots WHERE tenantId = ? AND resourceId = ? AND snapshotDate = ?`,
          [tenantId, resource.id, snapshotDate]
        ).catch(() => {});

        // Real per-model breakdown from Cost Management grouped by Meter.
        const meterModels = aggregateFoundryMeters(
          await getFoundryModelCostsByMeter(credential, resource.id, subscriptionId)
        );

        if (meterModels.length > 0) {
          for (const model of meterModels) {
            const dep = accountDeployments.find(
              (d) =>
                d.modelName.toLowerCase() === model.modelName.toLowerCase() ||
                d.name.toLowerCase() === model.modelName.toLowerCase()
            );
            await upsertFoundryModelSnapshot(
              tenantId,
              snapshotDate,
              resource,
              dep?.name || model.modelName,
              model,
              (dep?.skuName || resource.sku || "Standard").toLowerCase()
            );
          }
          continue;
        }

        // Fallback (no billed meters yet, e.g. brand-new resource): keep prior
        // behavior — account total split across discovered deployments.
        const monthlyCostUSD = await getFoundryResourceCost(tenantId, credential, resource.id, subscriptionId);
        if (accountDeployments.length > 0) {
          const costPerDeployment = monthlyCostUSD / accountDeployments.length;
          for (const dep of accountDeployments) {
            await upsertFoundryModelSnapshot(
              tenantId,
              snapshotDate,
              resource,
              dep.name,
              { modelName: dep.modelName, costUSD: costPerDeployment, inputTokens: 0, outputTokens: 0 },
              (dep.skuName || resource.sku || "Standard").toLowerCase()
            );
          }
        } else {
          await upsertFoundryModelSnapshot(
            tenantId,
            snapshotDate,
            resource,
            "unattributed",
            { modelName: "unattributed", costUSD: monthlyCostUSD, inputTokens: 0, outputTokens: 0 },
            (resource.sku || "S0").toLowerCase()
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

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
//
// Cost Management is the ONLY source that sees Foundry model usage:
// `microsoft.cognitiveservices/accounts/deployments` is not queryable through
// Resource Graph, so deployment discovery always comes back empty and every
// snapshot used to collapse into a single "unattributed" row. The billed meter
// name carries the model and the token bucket, so any newly activated model
// shows up on its own the moment Azure bills it.

export interface FoundryMeterUsage {
  meterName: string;
  resourceId: string;
  costUSD: number;
  quantity: number;
}

// Cost Management throttles aggressively (429) and a swallowed 429 used to look
// exactly like "this resource has no cost", which wiped good snapshots.
const COST_QUERY_ATTEMPTS = 3;
const COST_QUERY_BACKOFF_MS = 5_000;

export interface FoundryModelAgg {
  modelName: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
}

// Words in a Meter name that describe the charge, not the model.
const METER_DESCRIPTOR_WORDS = new Set([
  "inp", "input", "outp", "output", "opt", "cd", "cached", "cache", "caching",
  "prompt", "prompts", "completion", "completions", "generated",
  "glbl", "global", "gl", "dz", "datazone", "regional", "zone", "std", "standard",
  "shortco", "longco", "batch", "spot", "provisioned", "ptu", "enterprise",
  "1m", "1k", "tokens", "token", "units", "unit", "per", "hours", "hour",
  "images", "image", "characters", "transactions", "transaction",
  "requests", "request", "min", "minute", "data",
]);

/**
 * Split a Cost Management `Meter` name into model + token bucket + the unit
 * multiplier that turns UsageQuantity into raw tokens.
 *
 * Azure bills some model meters per 1M tokens and others per 1K, and says which
 * in the meter name:
 *   "5.6 sol ShortCo Inp Std Gl 1M Tokens" qty 5.386739 -> 5,386,739 tokens
 *   "V4 Pro Inp glbl Tokens"               qty 27467.14 -> 27,467,142 tokens
 * Both verified against AICostSnapshots token counts for this tenant.
 */
export function parseFoundryMeter(meterName: string): {
  modelName: string;
  tokenType: "input" | "output" | "cached" | "none";
  tokenMultiplier: number;
} {
  const raw = meterName || "";
  const lower = raw.toLowerCase();

  let tokenType: "input" | "output" | "cached" | "none" = "none";
  if (lower.includes("token")) {
    // Order matters: "Cd Inp" and "cached" also contain an input marker.
    if (/\bcd\b|cach/.test(lower)) tokenType = "cached";
    else if (/\bopt\b|outp|output|completion|generat/.test(lower)) tokenType = "output";
    else tokenType = "input";
  }

  // "1M Tokens" bills per million; everything else (glbl/DZ) bills per thousand.
  const tokenMultiplier = /\b1m\b/.test(lower) ? 1_000_000 : 1_000;

  const words = raw.split(/\s+/).filter((w) => w && !METER_DESCRIPTOR_WORDS.has(w.toLowerCase()));
  const label = words.join(" ").trim();

  return { modelName: normalizeFoundryModelName(label) || "unknown", tokenType, tokenMultiplier };
}

/**
 * Meter labels drop the family prefix ("GPT 5.1" but also plain "5.3 codex").
 * Re-add it so meter-derived names line up with the model ids the rest of the
 * app already uses (gpt-5.1, gpt-5.3-codex, gpt-5.6-terra).
 */
export function normalizeFoundryModelName(label: string): string {
  const cleaned = (label || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!cleaned) return "";
  return /^[0-9]/.test(cleaned) ? `gpt-${cleaned}` : cleaned;
}

/** Aggregate raw meter rows into per-model cost + input/output tokens. */
export function aggregateFoundryMeters(meters: FoundryMeterUsage[]): FoundryModelAgg[] {
  const byModel = new Map<string, FoundryModelAgg>();
  for (const m of meters) {
    const { modelName, tokenType, tokenMultiplier } = parseFoundryMeter(m.meterName);
    const key = modelName.toLowerCase();
    const agg = byModel.get(key) || { modelName, costUSD: 0, inputTokens: 0, outputTokens: 0 };
    agg.costUSD += m.costUSD;
    const tokens = m.quantity * tokenMultiplier;
    // Cached tokens are discounted input tokens, not a third bucket.
    if (tokenType === "output") agg.outputTokens += tokens;
    else if (tokenType === "input" || tokenType === "cached") agg.inputTokens += tokens;
    byModel.set(key, agg);
  }
  return Array.from(byModel.values());
}

/**
 * MTD cost + usage per (Meter, ResourceId) for a WHOLE subscription.
 *
 * One query per subscription, never per resource: Cost Management throttles
 * hard and per-resource fan-out returns "Too many requests". Grouping by
 * ResourceId instead of filtering on it also sidesteps the casing mismatch
 * (Azure stores resource ids lowercased).
 *
 * Returns `null` when the query FAILED, as opposed to `[]` for "queried fine,
 * nothing billed". Callers must not treat a throttled request as proof that a
 * resource is gone — doing so used to wipe real snapshots on a 429.
 */
export async function getSubscriptionMeterUsage(
  credential: any,
  subscriptionId: string
): Promise<FoundryMeterUsage[] | null> {
  if (!subscriptionId || !credential) return null;

  const costMgmtClient = new CostManagementClient(credential);
  const body = {
    type: "ActualCost",
    timeframe: "MonthToDate",
    dataset: {
      granularity: "None",
      aggregation: {
        totalCost: { name: "Cost", function: "Sum" },
        totalQty: { name: "UsageQuantity", function: "Sum" },
      },
      grouping: [
        { type: "Dimension", name: "Meter" },
        { type: "Dimension", name: "ResourceId" },
      ],
    },
  };

  let result: any = null;
  for (let attempt = 0; attempt < COST_QUERY_ATTEMPTS; attempt++) {
    try {
      result = await costMgmtClient.query.usage(`/subscriptions/${subscriptionId}`, body as any);
      break;
    } catch (err: any) {
      const status = err?.statusCode ?? err?.response?.status;
      const last = attempt === COST_QUERY_ATTEMPTS - 1;
      if (status !== 429 || last) {
        console.warn(
          `[foundryCollector] Meter query failed for sub ${subscriptionId}:`,
          err?.message || err
        );
        return null;
      }
      const retryAfter = Number(err?.response?.headers?.get?.("retry-after")) || 0;
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : COST_QUERY_BACKOFF_MS * 3 ** attempt;
      console.warn(
        `[foundryCollector] Cost Management throttled sub ${subscriptionId}, retrying in ${waitMs}ms`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  if (!result) return null;

  try {
    const columns = ((result.columns || []) as Array<{ name: string }>).map((c) => c.name);
    // This query returns "Cost"; other API shapes use CostUSD/PreTaxCost.
    const costIdx = ["Cost", "CostUSD", "PreTaxCost"]
      .map((n) => columns.indexOf(n))
      .find((i) => i >= 0) ?? -1;
    const meterIdx = columns.indexOf("Meter");
    const qtyIdx = columns.indexOf("UsageQuantity");
    const ridIdx = columns.indexOf("ResourceId");

    const out: FoundryMeterUsage[] = [];
    for (const row of (result.rows || []) as any[][]) {
      const costUSD = costIdx >= 0 ? Number(row[costIdx] ?? 0) || 0 : 0;
      const quantity = qtyIdx >= 0 ? Number(row[qtyIdx] ?? 0) || 0 : 0;
      if (costUSD === 0 && quantity === 0) continue;
      out.push({
        meterName: meterIdx >= 0 ? String(row[meterIdx] ?? "") : "",
        resourceId: ridIdx >= 0 ? String(row[ridIdx] ?? "") : "",
        costUSD,
        quantity,
      });
    }
    return out;
  } catch (err) {
    console.warn(`[foundryCollector] Meter parse failed for sub ${subscriptionId}:`, err);
    return null;
  }
}

/** Upsert one per-model snapshot row (real cost + tokens). */
async function upsertFoundryModelSnapshot(
  tenantId: string,
  snapshotDate: string,
  resource: { id: string; name: string; resourceGroup?: string; location?: string },
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
      model.modelName,
      model.modelName,
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
 * Main sync function: one row per (Foundry account, model) with the REAL billed
 * cost and token counts, driven entirely off Cost Management meters.
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

    // Resource Graph is used only for display metadata (name/region/sku); it
    // cannot see deployments, and billing may include accounts it cannot read.
    const resources = await getFoundryResources(tenantId, credential, subs);
    const metaById = new Map<string, any>();
    for (const r of resources) metaById.set(String(r.id).toLowerCase(), r);

    // Collect billed Foundry meters across every subscription (1 query each).
    const accounts = new Map<string, FoundryMeterUsage[]>();
    let anyQuerySucceeded = false;
    for (const sub of subs) {
      const meters = await getSubscriptionMeterUsage(credential, sub);
      if (meters === null) continue; // throttled/failed — don't treat as empty
      anyQuerySucceeded = true;
      for (const m of meters) {
        const rid = m.resourceId.toLowerCase();
        if (!rid.includes("/providers/microsoft.cognitiveservices/accounts/")) continue;
        const arr = accounts.get(rid) || [];
        arr.push(m);
        accounts.set(rid, arr);
      }
    }

    if (!anyQuerySucceeded) {
      console.warn(
        `[foundryCollector] All meter queries failed for tenant ${tenantId}; keeping previous snapshots`
      );
      return;
    }

    if (accounts.size === 0) {
      console.log(`[foundryCollector] No billed Foundry meters for tenant ${tenantId}`);
      return;
    }

    // Drop legacy per-deployment rows (old scheme keyed resourceId by
    // "/deployments/<name>") so the new per-model rows never double-count.
    await pool.query(
      `DELETE FROM AzureFoundrySnapshots WHERE tenantId = ? AND resourceId LIKE '%/deployments/%'`,
      [tenantId]
    ).catch(() => {});

    let modelRows = 0;
    for (const [rid, meters] of accounts) {
      try {
        const meta = metaById.get(rid);
        const resource = {
          id: meta?.id || rid,
          name: meta?.name || rid.split("/").pop() || "unknown",
          resourceGroup: meta?.resourceGroup || rid.split("/resourcegroups/")[1]?.split("/")[0] || "unknown",
          location: meta?.location || "unknown",
        };
        const sku = String(meta?.sku || "S0").toLowerCase();

        // Idempotent re-run: drop today's rows for this account first so models
        // that stopped being billed disappear instead of lingering.
        await pool.query(
          `DELETE FROM AzureFoundrySnapshots WHERE tenantId = ? AND resourceId = ? AND snapshotDate = ?`,
          [tenantId, resource.id, snapshotDate]
        ).catch(() => {});

        for (const model of aggregateFoundryMeters(meters)) {
          await upsertFoundryModelSnapshot(tenantId, snapshotDate, resource, model, sku);
          modelRows++;
        }
      } catch (err) {
        console.error(`[foundryCollector] Error processing account ${rid}:`, err);
      }
    }

    console.log(
      `[foundryCollector] Synced ${accounts.size} Foundry accounts / ${modelRows} model rows for ${tenantId}`
    );

    if (modelRows > 0) {
      // Legacy placeholder rows recorded the whole account as a single
      // "unattributed" model. They represent the same MTD spend as the
      // per-model rows above, so leaving them around double-counts the total.
      await pool.query(
        `DELETE FROM AzureFoundrySnapshots WHERE tenantId = ? AND deploymentName = 'unattributed'`,
        [tenantId]
      ).catch(() => {});
    }
  } catch (err) {
    console.error(`[foundryCollector] Failed for tenant ${tenantId}:`, err);
  }
}

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";

export async function getAiServiceRealCost(
  tenantId: string,
  credential: any,
  resourceId: string,
  subscriptionId: string,
  _serviceKeywords: string[] = []
): Promise<number> {
  void _serviceKeywords;
  // 1. Consultar Azure Cost Management MTD
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
    console.warn(`[getAiServiceRealCost] Cost Management query failed for ${resourceId}:`, err);
  }

  // 2. Fallback a CostMeterSnapshots en DB para este tenant y resourceId o palabras clave
  try {
    const params: any[] = [tenantId, resourceId];

    const [meterRows]: any = await pool.query(
      `
      SELECT COALESCE(SUM(cost_usd), 0) as totalCost
      FROM CostMeterSnapshots
      WHERE tenant_id = ?
        AND LOWER(resource_id) = LOWER(?)
        AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      `,
      params
    );

    if (meterRows && meterRows.length > 0) {
      const val = parseFloat(meterRows[0].totalCost || 0);
      if (val > 0) return val;
    }
  } catch (meterErr) {
    console.warn(`[getAiServiceRealCost] CostMeterSnapshots query error:`, meterErr);
  }

  return 0;
}

export async function getSpeechLanguageResources(tenantId: string) {
  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return [];

    const query = `
      resources
      | where type =~ "microsoft.cognitiveservices/accounts" and kind =~ "SpeechServices|TextAnalytics|Translator|Language"
      | project id, name, resourceGroup, location, sku = sku.name
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    return (response.data as any[]) || [];
  } catch (err) {
    console.error("[getSpeechLanguageResources] Error:", err);
    return [];
  }
}

export async function syncSpeechLanguageSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const rows = await getSpeechLanguageResources(tenantId);
    console.log(`[speechLanguageCollector] Found ${rows.length} resources`);

    for (const row of rows) {
      try {
        const resourceSubId = row.id.split("/")[2] || "unknown";
        const costUSD = await getAiServiceRealCost(tenantId, credential, row.id, resourceSubId, ["speech", "translator", "textanalytics", "language"]);

        await pool.query(
          `
          INSERT INTO AzureSpeechLanguageSnapshots (
            tenantId, snapshotDate, resourceId, resourceName, region, tier, 
            monthlyCostUSD, usage_audioMinutes, usage_textCharacters, utilizationPercent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            monthlyCostUSD = VALUES(monthlyCostUSD),
            updatedAt = CURRENT_TIMESTAMP
          `,
          [
            tenantId,
            snapshotDate,
            row.id,
            row.name,
            row.location || "Unknown",
            (row.sku || "S0").toLowerCase(),
            costUSD,
            0,
            0,
            0,
          ]
        );
      } catch (err) {
        console.error(`[speechLanguageCollector] Error:`, err);
      }
    }
  } catch (err) {
    console.error(`[speechLanguageCollector] Failed:`, err);
  }
}

export async function getVisionVideoResources(tenantId: string) {
  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return [];

    const query = `
      resources
      | where type =~ "microsoft.cognitiveservices/accounts" and kind =~ "ComputerVision|CustomVision|Face"
      | project id, name, resourceGroup, location, sku = sku.name
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    return (response.data as any[]) || [];
  } catch (err) {
    console.error("[getVisionVideoResources] Error:", err);
    return [];
  }
}

export async function syncVisionVideoSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const rows = await getVisionVideoResources(tenantId);

    for (const row of rows) {
      try {
        const resourceSubId = row.id.split("/")[2] || "unknown";
        const costUSD = await getAiServiceRealCost(tenantId, credential, row.id, resourceSubId, ["computervision", "customvision", "vision", "face"]);

        await pool.query(
          `
          INSERT INTO AzureVisionVideoSnapshots (
            tenantId, snapshotDate, resourceId, resourceName, region, tier, 
            monthlyCostUSD, usage_imagesProcessed, usage_videoMinutes, utilizationPercent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE monthlyCostUSD = VALUES(monthlyCostUSD), updatedAt = CURRENT_TIMESTAMP
          `,
          [
            tenantId,
            snapshotDate,
            row.id,
            row.name,
            row.location || "Unknown",
            (row.sku || "S1").toLowerCase(),
            costUSD,
            0,
            0,
            0,
          ]
        );
      } catch (err) {
        console.error(`[visionVideoCollector] Error:`, err);
      }
    }
  } catch (err) {
    console.error(`[visionVideoCollector] Failed:`, err);
  }
}

export async function getContentSafetyResources(tenantId: string) {
  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return [];

    const query = `
      resources
      | where type =~ "microsoft.cognitiveservices/accounts" and kind =~ "ContentSafety"
      | project id, name, resourceGroup, location, sku = sku.name
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    return (response.data as any[]) || [];
  } catch (err) {
    console.error("[getContentSafetyResources] Error:", err);
    return [];
  }
}

export async function syncContentSafetySnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const rows = await getContentSafetyResources(tenantId);

    for (const row of rows) {
      try {
        const resourceSubId = row.id.split("/")[2] || "unknown";
        const costUSD = await getAiServiceRealCost(tenantId, credential, row.id, resourceSubId, ["contentsafety", "content safety"]);

        await pool.query(
          `
          INSERT INTO AzureContentSafetySnapshots (
            tenantId, snapshotDate, resourceId, resourceName, region, tier, 
            monthlyCostUSD, usage_textAnalyses, usage_imageAnalyses, utilizationPercent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE monthlyCostUSD = VALUES(monthlyCostUSD), updatedAt = CURRENT_TIMESTAMP
          `,
          [
            tenantId,
            snapshotDate,
            row.id,
            row.name,
            row.location || "Unknown",
            (row.sku || "S0").toLowerCase(),
            costUSD,
            0,
            0,
            0,
          ]
        );
      } catch (err) {
        console.error(`[contentSafetyCollector] Error:`, err);
      }
    }
  } catch (err) {
    console.error(`[contentSafetyCollector] Failed:`, err);
  }
}

export async function getAMLResources(tenantId: string) {
  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return [];

    const query = `
      resources
      | where type =~ "microsoft.machinelearningservices/workspaces"
      | project id, name, resourceGroup, location
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    return (response.data as any[]) || [];
  } catch (err) {
    console.error("[getAMLResources] Error:", err);
    return [];
  }
}

export async function syncAMLSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const rows = await getAMLResources(tenantId);

    for (const row of rows) {
      try {
        const resourceSubId = row.id.split("/")[2] || "unknown";
        const costUSD = await getAiServiceRealCost(tenantId, credential, row.id, resourceSubId, ["machine learning", "machinelearningservices", "azureml"]);

        await pool.query(
          `
          INSERT INTO AzureMLSnapshots (
            tenantId, snapshotDate, resourceId, resourceName, region, 
            monthlyCostUSD, usage_computeHours, usage_gpuHours, utilizationPercent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE monthlyCostUSD = VALUES(monthlyCostUSD), updatedAt = CURRENT_TIMESTAMP
          `,
          [
            tenantId,
            snapshotDate,
            row.id,
            row.name,
            row.location || "Unknown",
            costUSD,
            0,
            0,
            0,
          ]
        );
      } catch (err) {
        console.error(`[amlCollector] Error:`, err);
      }
    }
  } catch (err) {
    console.error(`[amlCollector] Failed:`, err);
  }
}

export async function getDatabricksResources(tenantId: string) {
  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return [];

    const query = `
      resources
      | where type =~ "microsoft.databricks/workspaces"
      | project id, name, resourceGroup, location, sku = sku.name
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    return (response.data as any[]) || [];
  } catch (err) {
    console.error("[getDatabricksResources] Error:", err);
    return [];
  }
}

export async function syncDatabricksSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const rows = await getDatabricksResources(tenantId);

    for (const row of rows) {
      try {
        const resourceSubId = row.id.split("/")[2] || "unknown";
        const costUSD = await getAiServiceRealCost(tenantId, credential, row.id, resourceSubId, ["databricks"]);

        await pool.query(
          `
          INSERT INTO AzureDatabricksSnapshots (
            tenantId, snapshotDate, workspaceId, workspaceName, region, tier, 
            monthlyCostUSD, usage_dbuConsumed, usage_activeClusterCount, utilizationPercent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE monthlyCostUSD = VALUES(monthlyCostUSD), updatedAt = CURRENT_TIMESTAMP
          `,
          [
            tenantId,
            snapshotDate,
            row.id,
            row.name,
            row.location || "Unknown",
            (row.sku || "Standard").toLowerCase(),
            costUSD,
            0,
            0,
            0,
          ]
        );
      } catch (err) {
        console.error(`[databricksCollector] Error:`, err);
      }
    }
  } catch (err) {
    console.error(`[databricksCollector] Failed:`, err);
  }
}

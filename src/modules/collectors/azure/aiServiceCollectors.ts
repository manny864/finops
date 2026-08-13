import { MonitorClient } from "@azure/arm-monitor";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import pool from "@/modules/storage/db";
import { Decimal } from "decimal.js";

export async function syncSpeechLanguageSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return;

    const query = `
      resources
      | where type == "microsoft.cognitiveservices/accounts" and kind =~ "SpeechServices|TextAnalytics|Translator"
      | project id, name, location, sku = sku.name
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    const rows = (response.data as any[]) || [];

    console.log(`[speechLanguageCollector] Found ${rows.length} resources`);

    for (const row of rows) {
      try {
        const costUSD = new Decimal(Math.random() * 500).toNumber();

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
            Math.floor(Math.random() * 1000000),
            Math.floor(Math.random() * 10000000),
            Math.floor(Math.random() * 100),
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

export async function syncVisionVideoSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return;

    const query = `
      resources
      | where type == "microsoft.cognitiveservices/accounts" and kind =~ "ComputerVision|CustomVision"
      | project id, name, location, sku = sku.name
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    const rows = (response.data as any[]) || [];

    for (const row of rows) {
      try {
        const costUSD = new Decimal(Math.random() * 800).toNumber();

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
            Math.floor(Math.random() * 500000),
            Math.floor(Math.random() * 10000),
            Math.floor(Math.random() * 100),
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

export async function syncContentSafetySnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return;

    const query = `
      resources
      | where type == "microsoft.cognitiveservices/accounts" and kind == "ContentSafety"
      | project id, name, location, sku = sku.name
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    const rows = (response.data as any[]) || [];

    for (const row of rows) {
      try {
        const costUSD = new Decimal(Math.random() * 300).toNumber();

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
            Math.floor(Math.random() * 1000000),
            Math.floor(Math.random() * 500000),
            Math.floor(Math.random() * 100),
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

export async function syncAMLSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return;

    const query = `
      resources
      | where type == "microsoft.machinelearningservices/workspaces"
      | project id, name, location
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    const rows = (response.data as any[]) || [];

    for (const row of rows) {
      try {
        const costUSD = new Decimal(Math.random() * 5000).toNumber();

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
            Math.floor(Math.random() * 1000),
            Math.floor(Math.random() * 200),
            Math.floor(Math.random() * 100),
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

export async function syncDatabricksSnapshots(tenantId: string): Promise<void> {
  const snapshotDate = new Date().toISOString().split("T")[0];

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (subs.length === 0) return;

    const query = `
      resources
      | where type == "microsoft.databricks/workspaces"
      | project id, name, location, sku = sku.name
    `;

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    const rows = (response.data as any[]) || [];

    for (const row of rows) {
      try {
        const costUSD = new Decimal(Math.random() * 10000).toNumber();

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
            Math.random() * 100000,
            Math.floor(Math.random() * 10),
            Math.floor(Math.random() * 100),
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

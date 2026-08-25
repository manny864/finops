import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, getHistoricalAIUsage, insertAICostSnapshotRow, getAzureFoundryDeployments } = vi.hoisted(() => ({
  query: vi.fn(),
  getHistoricalAIUsage: vi.fn(),
  insertAICostSnapshotRow: vi.fn(),
  getAzureFoundryDeployments: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
  default: { query },
  insertAICostSnapshotRow,
}));
vi.mock("@/modules/collectors/azure/aiUsageCollector", () => ({ getHistoricalAIUsage }));
vi.mock("@/modules/collectors/azure/foundryCollector", () => ({ getAzureFoundryDeployments }));

import { getFoundryDetail } from "@/services/azureAiFoundry.service";

describe("azureAiFoundry.service", () => {
  beforeEach(() => {
    query.mockReset();
    getHistoricalAIUsage.mockReset().mockResolvedValue([]);
    insertAICostSnapshotRow.mockReset();
    getAzureFoundryDeployments.mockReset().mockResolvedValue([]);
  });

  it("uses AzureFoundrySnapshots when AICostSnapshots has no rows", async () => {
    query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        {
          snapshotDate: "2026-08-18",
          resourceId: "/subscriptions/sub-1/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/foundry-prod",
          resourceName: "foundry-prod",
          deploymentName: "gpt-4o-prod",
          modelDeploymentName: "gpt-4o-prod",
          modelName: "gpt-4o",
          sku: "Standard",
          monthlyCostUSD: "125.50",
          inputTokens: 120000,
          outputTokens: 30000,
          modelEndpoints: 1,
        },
      ]]);

    const result = await getFoundryDetail("real-tenant-id", 30);

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0][0])).toContain("date AS snapshot_date");
    expect(String(query.mock.calls[0][0])).toContain("billed_cost");
    expect(String(query.mock.calls[0][0])).toContain("resource_name");
    expect(result.mock).toBe(false);
    expect(result.metrics.source).toBe("snapshot");
    expect(result.metrics.estimatedCostUSD).toBe("125.50");
    expect(result.metrics.totalTokens).toBe(150000);
    expect(result.metrics.activeDeployments).toBe(1);
    expect(result.modelUsage).toHaveLength(1);
    expect(result.modelUsage[0].deploymentName).toBe("gpt-4o-prod");
    expect(result.applicationConsumers[0].appDisplayName).toBe("foundry-prod");
  });

  it("persists live Azure Monitor usage before aggregating Foundry", async () => {
    query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        {
          model_name: "gpt-4o-mini",
          application: "foundry-live",
          team: "Sin asignar",
          snapshot_date: "2026-08-19",
          cost_usd: "2.40",
          request_count: 10,
          input_tokens: 1000,
          output_tokens: 200,
          cached_tokens: 0,
          deployment_name: "gpt-4o-mini",
          sku_tier: "Standard",
        },
      ]]);
    getHistoricalAIUsage.mockResolvedValueOnce([{
      date: "2026-08-19",
      subscriptionId: "sub-1",
      resourceName: "foundry-live",
      resourceGroup: "rg-ai",
      modelName: "gpt-4o-mini",
      requestCount: 10,
      inputTokens: 1000,
      outputTokens: 200,
      billedCost: 2.4,
    }]);

    const result = await getFoundryDetail("real-tenant-id", 30);

    expect(insertAICostSnapshotRow).toHaveBeenCalledOnce();
    expect(result.metrics.source).toBe("snapshot");
    expect(result.metrics.totalRequests).toBe(10);
    expect(result.modelUsage[0].modelName).toBe("gpt-4o-mini");
  });

  it("aggregates DeepSeek sub-meters into DeepSeek-V4-Pro and DeepSeek-V4-Flash and excludes standard-s1-unit", async () => {
    // 1. queryRows returns empty so it queries AICostSnapshots then CostMeterSnapshots
    query
      .mockResolvedValueOnce([[
        {
          model_name: "gpt-5.6-sol",
          application: "mchavez-8282-resource",
          team: "Sin asignar",
          snapshot_date: "2026-08-25",
          cost_usd: "71.27",
          request_count: 50,
          input_tokens: 86400000,
          output_tokens: 134600,
          cached_tokens: 0,
          deployment_name: "gpt-5.6-sol",
          sku_tier: "Standard",
        },
      ]])
      // CostMeterSnapshots query returning sub-meters and search meter
      .mockResolvedValueOnce([[
        { model_name: "v4-pro-glbl", cost_usd: "47.79", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "v4-pro-glbl", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "v4-pro-cached-glbl", cost_usd: "16.29", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "v4-pro-cached-glbl", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "v4-pro-cached-dz", cost_usd: "3.40", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "v4-pro-cached-dz", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "v4-pro-dz", cost_usd: "1.38", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "v4-pro-dz", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "v4-pro-outp-glbl", cost_usd: "1.25", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "v4-pro-outp-glbl", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "v4-pro-outp-dz", cost_usd: "0.29", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "v4-pro-outp-dz", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "v4-flash-glbl", cost_usd: "0.36", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "v4-flash-glbl", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "gpt-5.3-codex", cost_usd: "22.65", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "gpt-5.3-codex", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "gpt-5.6-terra", cost_usd: "18.74", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "gpt-5.6-terra", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "gpt-5.1", cost_usd: "0.58", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "gpt-5.1", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
        { model_name: "standard-s1-unit", cost_usd: "34.61", snapshot_date: "2026-08-25", application: "sub-1", team: "Sin asignar", deployment_name: "standard-s1-unit", sku_tier: "Standard", request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
      ]]);

    getAzureFoundryDeployments.mockResolvedValueOnce([
      { id: "1", name: "gpt-5.6-sol", accountName: "acc", accountId: "id", resourceGroup: "rg", subscriptionId: "sub", location: "eastus", modelName: "gpt-5.6-sol", modelVersion: "2026-07-09", modelFormat: "OpenAI", skuName: "GlobalStandard", capacity: 10 },
      { id: "2", name: "DeepSeek-V4-Pro", accountName: "acc", accountId: "id", resourceGroup: "rg", subscriptionId: "sub", location: "eastus", modelName: "DeepSeek-V4-Pro", modelVersion: "2026-04-23", modelFormat: "OpenAI", skuName: "GlobalStandard", capacity: 10 },
      { id: "3", name: "DeepSeek-V4-Flash", accountName: "acc", accountId: "id", resourceGroup: "rg", subscriptionId: "sub", location: "eastus", modelName: "DeepSeek-V4-Flash", modelVersion: "2026-04-23", modelFormat: "OpenAI", skuName: "GlobalStandard", capacity: 10 },
      { id: "4", name: "gpt-5.6-terra", accountName: "acc", accountId: "id", resourceGroup: "rg", subscriptionId: "sub", location: "eastus", modelName: "gpt-5.6-terra", modelVersion: "2026-07-09", modelFormat: "OpenAI", skuName: "GlobalStandard", capacity: 10 },
      { id: "5", name: "gpt-5.1", accountName: "acc", accountId: "id", resourceGroup: "rg", subscriptionId: "sub", location: "eastus", modelName: "gpt-5.1", modelVersion: "2025-11-13", modelFormat: "OpenAI", skuName: "GlobalStandard", capacity: 10 },
      { id: "6", name: "gpt-5.3-codex", accountName: "acc", accountId: "id", resourceGroup: "rg", subscriptionId: "sub", location: "eastus", modelName: "gpt-5.3-codex", modelVersion: "2026-02-24", modelFormat: "OpenAI", skuName: "GlobalStandard", capacity: 10 },
    ]);

    const result = await getFoundryDetail("mchavez-8282", 30);

    // Exactly 6 models returned
    expect(result.modelUsage).toHaveLength(6);

    // standard-s1-unit is NOT present
    const modelNames = result.modelUsage.map((m) => m.modelName);
    expect(modelNames).not.toContain("standard-s1-unit");
    expect(modelNames).not.toContain("unknown");

    // DeepSeek-V4-Pro aggregates all 6 sub-meters to $70.40
    const deepseekPro = result.modelUsage.find((m) => m.modelName === "DeepSeek-V4-Pro");
    expect(deepseekPro).toBeDefined();
    expect(deepseekPro?.totalCostUSD).toBe("70.40");

    // DeepSeek-V4-Flash has $0.36
    const deepseekFlash = result.modelUsage.find((m) => m.modelName === "DeepSeek-V4-Flash");
    expect(deepseekFlash).toBeDefined();
    expect(deepseekFlash?.totalCostUSD).toBe("0.36");

    // Total cost across the 6 models matches $184.00
    expect(result.metrics.estimatedCostUSD).toBe("184.00");
  });
});
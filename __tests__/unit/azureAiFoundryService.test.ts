import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, getHistoricalAIUsage, insertAICostSnapshotRow } = vi.hoisted(() => ({
  query: vi.fn(),
  getHistoricalAIUsage: vi.fn(),
  insertAICostSnapshotRow: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
  default: { query },
  insertAICostSnapshotRow,
}));
vi.mock("@/modules/collectors/azure/aiUsageCollector", () => ({ getHistoricalAIUsage }));

import { getFoundryDetail } from "@/services/azureAiFoundry.service";

describe("azureAiFoundry.service", () => {
  beforeEach(() => {
    query.mockReset();
    getHistoricalAIUsage.mockReset().mockResolvedValue([]);
    insertAICostSnapshotRow.mockReset();
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
});
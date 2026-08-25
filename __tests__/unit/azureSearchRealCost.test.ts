import { describe, it, expect, vi, beforeEach } from "vitest";

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
  default: { query },
  insertAICostSnapshotRow: vi.fn(),
}));

vi.mock("@azure/arm-costmanagement", () => ({
  CostManagementClient: class {
    query = {
      usage: vi.fn().mockResolvedValue({ rows: [[34.61]] }),
    };
  },
}));

import { getAzureSearchRealCost } from "@/modules/collectors/azure/azureSearchCollector";

describe("Azure AI Search Real Cost & Cognitive Search Resolution", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("should extract real billed cost ($34.61) from Cost Management API", async () => {
    const credential = {};
    const cost = await getAzureSearchRealCost(
      "tenant-test",
      credential,
      "/subscriptions/sub-123/resourceGroups/rg-ai/providers/Microsoft.Search/searchServices/my-search-service",
      "sub-123"
    );

    expect(cost).toBe(34.61);
  });

  it("should fallback to CostMeterSnapshots with flexible service and name matching if Cost Management returns 0", async () => {
    // CostMeterSnapshots returns 34.61
    query.mockResolvedValueOnce([[{ totalCost: "34.61" }]]);

    const cost = await getAzureSearchRealCost(
      "tenant-test",
      null,
      "/subscriptions/sub-123/resourceGroups/rg-ai/providers/Microsoft.Search/searchServices/my-search-service",
      "sub-123"
    );

    expect(cost).toBe(34.61);
  });

  it("should match standard-s1-unit search meters in CostMeterSnapshots and return exact $34.61", async () => {
    query.mockResolvedValueOnce([[{ totalCost: "34.61" }]]);

    const cost = await getAzureSearchRealCost(
      "mchavez-8282",
      null,
      "/subscriptions/sub-123/resourceGroups/rg-ai/providers/Microsoft.Search/searchServices/search-service",
      "sub-123"
    );

    expect(cost).toBe(34.61);
    expect(String(query.mock.calls[0][0])).toContain("standard-s1");
  });
});

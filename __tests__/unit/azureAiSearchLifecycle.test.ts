import { describe, it, expect, vi, beforeEach } from "vitest";

const { query, getAzureCredential, getSubscriptionsForTenant, resources } = vi.hoisted(() => ({
  query: vi.fn(),
  getAzureCredential: vi.fn(),
  getSubscriptionsForTenant: vi.fn(),
  resources: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
  default: { query },
}));

vi.mock("@/lib/azure", () => ({
  getAzureCredential,
  getSubscriptionsForTenant,
}));

vi.mock("@azure/arm-resourcegraph", () => ({
  ResourceGraphClient: class {
    resources = resources;
  },
}));

import { getAiSearchPayload } from "@/services/azureAiSearch.service";

describe("Azure AI Search Lifecycle & Deleted Resources", () => {
  beforeEach(() => {
    query.mockReset();
    getAzureCredential.mockReset().mockResolvedValue({});
    getSubscriptionsForTenant.mockReset().mockResolvedValue(["sub-1"]);
    resources.mockReset();
  });

  it("should return empty list and zero cost when Azure Resource Graph confirms 0 search resources", async () => {
    // Azure Resource Graph returns 0 search services (e.g. resource was deleted in Azure)
    resources.mockResolvedValueOnce({ data: [] });
    query.mockResolvedValueOnce([[]]); // DB query for DELETE / Subscriptions

    const payload = await getAiSearchPayload("real-tenant-test");

    expect(payload.services).toEqual([]);
    expect(payload.summary.totalMonthlyCostUSD).toBe("0.00");
    expect(payload.summary.totalSearchUnits).toBe(0);
    expect(payload.summary.totalServicesCount).toBe(0);
    expect(payload.summary.totalIndexesCount).toBe(0);
    // Verified: It did NOT resurrect stale snapshots with $250.00
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM AzureSearchSnapshots WHERE tenantId = ?"),
      ["real-tenant-test"]
    );
  });
});

import { describe, expect, it } from "vitest";
import { selectLatestAzureAiSnapshots } from "@/lib/azureAiCost";

describe("selectLatestAzureAiSnapshots", () => {
  it("keeps the latest MTD snapshot for every resource", () => {
    const rows = selectLatestAzureAiSnapshots([
      { resourceId: "search-a", snapshotDate: "2026-08-10", monthlyCostUSD: "10.00" },
      { resourceId: "search-a", snapshotDate: "2026-08-18", monthlyCostUSD: "25.00" },
      { resourceId: "search-b", snapshotDate: "2026-08-17", monthlyCostUSD: "8.00" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      resourceId: "search-a",
      snapshotDate: "2026-08-18",
      monthlyCostUSD: "25.00",
    });
    expect(rows).toContainEqual({
      resourceId: "search-b",
      snapshotDate: "2026-08-17",
      monthlyCostUSD: "8.00",
    });
  });

  it("keeps deployments separate within one Foundry resource", () => {
    const rows = selectLatestAzureAiSnapshots([
      { resourceId: "foundry-a", deploymentName: "gpt-4o", snapshotDate: "2026-08-18" },
      { resourceId: "foundry-a", deploymentName: "embedding", snapshotDate: "2026-08-18" },
    ]);

    expect(rows).toHaveLength(2);
  });
});
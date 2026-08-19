import { describe, expect, it } from "vitest";
import {
  buildDocIntelligenceRemediations,
  calculateDocIntelligencePotentialSavings,
} from "@/lib/azureDocumentIntelligence";
import type { DocIntelligenceResource } from "@/types/azureDocumentIntelligence.types";

const resource = (overrides: Partial<DocIntelligenceResource>): DocIntelligenceResource => ({
  id: "resource-1",
  name: "docintel-dev",
  location: "eastus",
  resourceGroup: "rg-dev",
  subscriptionId: "sub-1",
  subscriptionName: "Development",
  skuName: "S0",
  totalPagesProcessed: 100,
  prebuiltPages: 0,
  customPages: 100,
  trainingHours: 0,
  trainingCostUSD: 0,
  inferenceCostUSD: 100,
  totalCostUSD: 100,
  primaryModelType: "Custom Neural Invoice",
  isOrphan: false,
  isDevOrTest: true,
  ...overrides,
});

describe("buildDocIntelligenceRemediations", () => {
  it("detects model arbitrage and non-production F0 opportunities", () => {
    const actions = buildDocIntelligenceRemediations([resource({})]);
    expect(actions.map((action) => action.category)).toEqual(
      expect.arrayContaining(["MODEL_ARBITRAGE", "DEV_F0_DOWNGRADE"])
    );
  });

  it("adds a commitment tier recommendation above 50K pages", () => {
    const actions = buildDocIntelligenceRemediations([
      resource({ totalPagesProcessed: 60000, customPages: 0, prebuiltPages: 60000, primaryModelType: "Prebuilt Read", isDevOrTest: false }),
    ]);
    expect(actions.some((action) => action.category === "COMMITMENT_TIER")).toBe(true);
  });

  it("does not double count overlapping savings for the same resource", () => {
    const actions = buildDocIntelligenceRemediations([resource({})]);
    expect(calculateDocIntelligencePotentialSavings(actions)).toBe(100);
  });
});
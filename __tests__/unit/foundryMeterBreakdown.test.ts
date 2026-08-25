import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/azure", () => ({
  getAzureCredential: vi.fn(),
  getSubscriptionsForTenant: vi.fn(),
}));

import { parseFoundryMeter, aggregateFoundryMeters } from "@/modules/collectors/azure/foundryCollector";

describe("Foundry meter → model + tokens breakdown", () => {
  it("parses model name and token type from Azure OpenAI meter names", () => {
    expect(parseFoundryMeter("gpt-4o-0806 Inp glbl Tokens")).toEqual({ modelName: "gpt-4o-0806", tokenType: "input" });
    expect(parseFoundryMeter("gpt-4o-0806 Outp glbl Tokens")).toEqual({ modelName: "gpt-4o-0806", tokenType: "output" });
    expect(parseFoundryMeter("gpt-4o-0806 Cached Inp glbl Tokens")).toEqual({ modelName: "gpt-4o-0806", tokenType: "cached" });
    expect(parseFoundryMeter("text-embedding-3-large Tokens")).toEqual({ modelName: "text-embedding-3-large", tokenType: "input" });
  });

  it("aggregates per model with real cost (PreTaxCost) and tokens (quantity × 1000)", () => {
    const models = aggregateFoundryMeters([
      { meterName: "gpt-4o-0806 Inp glbl Tokens", costUSD: 100, quantity: 40 },
      { meterName: "gpt-4o-0806 Outp glbl Tokens", costUSD: 84, quantity: 8 },
      { meterName: "gpt-4o-mini-0718 Inp glbl Tokens", costUSD: 12, quantity: 10 },
    ]);

    const gpt4o = models.find((m) => m.modelName === "gpt-4o-0806")!;
    expect(gpt4o.costUSD).toBeCloseTo(184); // cost is authoritative, straight from Cost Management
    expect(gpt4o.inputTokens).toBe(40_000);
    expect(gpt4o.outputTokens).toBe(8_000);

    // A newly activated model is auto-detected as its own entry.
    expect(models).toHaveLength(2);
    expect(models.some((m) => m.modelName === "gpt-4o-mini-0718")).toBe(true);
  });
});

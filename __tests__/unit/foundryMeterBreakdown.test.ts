import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/azure", () => ({
  getAzureCredential: vi.fn(),
  getSubscriptionsForTenant: vi.fn(),
}));

import {
  parseFoundryMeter,
  aggregateFoundryMeters,
  type FoundryMeterUsage,
} from "@/modules/collectors/azure/foundryCollector";

const meter = (meterName: string, costUSD: number, quantity: number): FoundryMeterUsage => ({
  meterName,
  resourceId:
    "/subscriptions/s/resourcegroups/rg/providers/microsoft.cognitiveservices/accounts/acct",
  costUSD,
  quantity,
});

describe("parseFoundryMeter — real Azure meter names", () => {
  it("reads the token bucket, treating 'opt' as output and 'Cd Inp' as cached", () => {
    expect(parseFoundryMeter("GPT 5.1 inp Gl 1M Tokens").tokenType).toBe("input");
    expect(parseFoundryMeter("GPT 5.1 opt Gl 1M Tokens").tokenType).toBe("output");
    expect(parseFoundryMeter("GPT 5.1 cd inp Gl 1M Tokens").tokenType).toBe("cached");
    expect(parseFoundryMeter("V4 Pro Outp glbl Tokens").tokenType).toBe("output");
    expect(parseFoundryMeter("V4 Pro cached glbl Tokens").tokenType).toBe("cached");
    expect(parseFoundryMeter("5.6 sol ShortCo Cd Inp Std Gl 1M Tokens").tokenType).toBe("cached");
  });

  it("takes the unit multiplier from the meter name (1M vs per-1K)", () => {
    expect(parseFoundryMeter("5.6 sol ShortCo Inp Std Gl 1M Tokens").tokenMultiplier).toBe(1_000_000);
    expect(parseFoundryMeter("V4 Pro Inp glbl Tokens").tokenMultiplier).toBe(1_000);
    expect(parseFoundryMeter("V4 Pro cached DZ Tokens").tokenMultiplier).toBe(1_000);
  });

  it("strips billing descriptors and restores the gpt- family prefix", () => {
    expect(parseFoundryMeter("GPT 5.1 opt Gl 1M Tokens").modelName).toBe("gpt-5.1");
    expect(parseFoundryMeter("5.3 codex inp Gl 1M Tokens").modelName).toBe("gpt-5.3-codex");
    expect(parseFoundryMeter("5.6 terra ShortCo Opt Std Gl 1M Tokens").modelName).toBe("gpt-5.6-terra");
    expect(parseFoundryMeter("5.6 sol ShortCo Cd Inp Std Gl 1M Tokens").modelName).toBe("gpt-5.6-sol");
    expect(parseFoundryMeter("V4 Pro Inp glbl Tokens").modelName).toBe("v4-pro");
    expect(parseFoundryMeter("V4 Flash Outp glbl Tokens").modelName).toBe("v4-flash");
  });
});

describe("aggregateFoundryMeters", () => {
  // Token counts below are the ones Azure Monitor recorded for this tenant on
  // 2026-08-06, which is what pins the 1M multiplier.
  it("converts UsageQuantity into the real token counts", () => {
    const [terra] = aggregateFoundryMeters([
      meter("5.6 terra ShortCo Inp Std Gl 1M Tokens", 1.4106, 0.564240),
      meter("5.6 terra ShortCo Opt Std Gl 1M Tokens", 0.1043, 0.006953),
    ]);
    expect(terra.modelName).toBe("gpt-5.6-terra");
    expect(terra.inputTokens).toBe(564_240);
    expect(terra.outputTokens).toBe(6_953);
    expect(terra.costUSD).toBeCloseTo(1.5149, 4);
  });

  it("folds cached tokens into input and keeps the billed cost authoritative", () => {
    const [sol] = aggregateFoundryMeters([
      meter("5.6 sol ShortCo Inp Std Gl 1M Tokens", 26.9337, 5.386739),
      meter("5.6 sol ShortCo Cd Inp Std Gl 1M Tokens", 40.333, 80.665984),
      meter("5.6 sol ShortCo Opt Std Gl 1M Tokens", 4.0024, 0.133413),
    ]);
    expect(sol.inputTokens).toBe(5_386_739 + 80_665_984);
    expect(sol.outputTokens).toBe(133_413);
    expect(sol.costUSD).toBeCloseTo(71.2691, 4);
  });

  it("splits per model and picks up a newly activated model with no code change", () => {
    const models = aggregateFoundryMeters([
      meter("GPT 5.1 inp Gl 1M Tokens", 0.1304, 0.104331),
      meter("GPT 5.1 opt Gl 1M Tokens", 0.7131, 0.07131),
      meter("brand-new-model inp Gl 1M Tokens", 9.5, 2.5),
    ]);
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.modelName).sort()).toEqual(["brand-new-model", "gpt-5.1"]);
    expect(models.find((m) => m.modelName === "brand-new-model")!.inputTokens).toBe(2_500_000);
  });

  it("reproduces the tenant's real $184.00 Foundry bill from its meters", () => {
    const real: Array<[string, number, number]> = [
      ["V4 Pro Inp glbl Tokens", 47.7928, 27467.142],
      ["5.6 sol ShortCo Cd Inp Std Gl 1M Tokens", 40.333, 80.665984],
      ["5.6 sol ShortCo Inp Std Gl 1M Tokens", 26.9337, 5.386739],
      ["5.3 codex inp Gl 1M Tokens", 17.3, 9.885703],
      ["V4 Pro cached glbl Tokens", 16.2886, 112335.104],
      ["5.6 terra ShortCo Inp Std Gl 1M Tokens", 12.3722, 6.186098],
      ["5.6 terra ShortCo Opt Std Gl 1M Tokens", 4.1076, 0.3423],
      ["5.6 sol ShortCo Opt Std Gl 1M Tokens", 4.0024, 0.133413],
      ["5.3 codex opt Gl 1M Tokens", 3.8716, 0.276542],
      ["V4 Pro cached DZ Tokens", 3.4041, 21275.392],
      ["5.6 terra ShortCo Cd Inp Std Gl 1M Tokens", 2.2639, 11.319552],
      ["5.3 codex cd inp Gl 1M Tokens", 1.4782, 8.446976],
      ["V4 Pro Inp DZ Tokens", 1.3812, 723.153],
      ["V4 Pro Outp glbl Tokens", 1.2547, 360.536],
      ["GPT 5.1 opt Gl 1M Tokens", 0.7131, 0.07131],
      ["V4 Pro Outp DZ Tokens", 0.2903, 75.784],
      ["GPT 5.1 inp Gl 1M Tokens", 0.1304, 0.104331],
      ["V4 Flash Inp glbl Tokens", 0.0782, 411.804],
      ["V4 Flash cached glbl Tokens", 0.0047, 167.168],
      ["GPT 5.1 cd inp Gl 1M Tokens", 0.0008, 0.006144],
      ["V4 Flash Outp glbl Tokens", 0.0005, 0.91],
    ];
    const models = aggregateFoundryMeters(real.map(([n, c, q]) => meter(n, c, q)));
    const total = models.reduce((s, m) => s + m.costUSD, 0);

    expect(total).toBeCloseTo(184.0, 2);
    expect(models.map((m) => m.modelName).sort()).toEqual([
      "gpt-5.1",
      "gpt-5.3-codex",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "v4-flash",
      "v4-pro",
    ]);
    // Every model must carry tokens, not just dollars.
    models.forEach((m) => expect(m.inputTokens + m.outputTokens).toBeGreaterThan(0));
  });
});

describe("per-model rows survive summary dedup", () => {
  // The summary keeps only the newest snapshot per resource+deployment. If the
  // Foundry query forgets to select deploymentName every model collapses into
  // one row and the reported total silently drops to a single model's cost.
  it("keeps one row per model and drops only older snapshots", async () => {
    const { selectLatestAzureAiSnapshots } = await import("@/lib/azureAiCost");
    const account = "/subscriptions/s/.../accounts/mchavez-8282-resource";
    const rows = [
      { resourceId: account, deploymentName: "gpt-5.6-sol", monthlyCostUSD: 71.27, snapshotDate: "2026-08-25" },
      { resourceId: account, deploymentName: "v4-pro", monthlyCostUSD: 70.41, snapshotDate: "2026-08-25" },
      { resourceId: account, deploymentName: "gpt-5.3-codex", monthlyCostUSD: 22.65, snapshotDate: "2026-08-25" },
      { resourceId: account, deploymentName: "gpt-5.6-terra", monthlyCostUSD: 18.74, snapshotDate: "2026-08-25" },
      { resourceId: account, deploymentName: "gpt-5.1", monthlyCostUSD: 0.84, snapshotDate: "2026-08-25" },
      { resourceId: account, deploymentName: "v4-flash", monthlyCostUSD: 0.08, snapshotDate: "2026-08-25" },
      // Yesterday's accumulator for a model already listed above.
      { resourceId: account, deploymentName: "v4-pro", monthlyCostUSD: 65.0, snapshotDate: "2026-08-24" },
    ];

    const kept = selectLatestAzureAiSnapshots(rows);
    const total = kept.reduce((s, r) => s + Number(r.monthlyCostUSD), 0);

    expect(kept).toHaveLength(6);
    expect(total).toBeCloseTo(183.99, 2);
  });
});

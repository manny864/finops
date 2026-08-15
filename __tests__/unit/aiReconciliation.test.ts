import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { estimateCost } from '../../src/modules/collectors/azure/aiUsageCollector';

// Simplified versions for testing
function toDateKey(value: string | Date): string {
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, "0");
        const day = String(value.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return raw.substring(0, 10);
    }
    return raw.substring(0, 10);
}

function normalizeModelKey(value: string): string {
    const s = String(value || "").toLowerCase().trim();
    if (!s) return "";

    let cleaned = s
      .replace(/\s+(inp|out|opt|op|tokens?|1m|1k|gl|ad|std|cd)\b/gi, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");

    let m = cleaned.match(/^(?:gpt-)?(\d+(?:\.\d+)?(?:[a-z]+)?(?:-[a-z]+)?)/i);
    if (m) {
      const version = m[1].toLowerCase();
      return `gpt-${version}`;
    }

    m = cleaned.match(/^([a-z]+-(?:[a-z]+-)*\d+(?:-[a-z]+)?)/i);
    if (m) {
      return m[1].toLowerCase();
    }

    m = cleaned.match(/^([a-z]+)-(\d+(?:\.\d+)?(?:[a-z]+)?)/i);
    if (m) {
      return `${m[1]}-${m[2]}`.toLowerCase();
    }

    return cleaned.toLowerCase();
}

type AggRow = {
    model_name: string;
    application: string;
    team: string;
    date: string;
    cost: Decimal.Value;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
};

// Mirrors reconcileAiRowsWithMeterCost in src/app/api/intelligence/ai-analytics/route.ts
function reconcileAiRowsWithMeterCost(aiRows: AggRow[], meterRows: AggRow[]): AggRow[] {
    if (!aiRows.length || !meterRows.length) return aiRows;

    const meterByDate = new Map<string, Decimal>();
    const meterByDateModel = new Map<string, Decimal>();
    const meterMetaByKey = new Map<string, { application: string; team: string }>();
    const attributableByDate = new Map<string, Decimal>();
    for (const row of meterRows) {
        const dateKey = toDateKey(row.date);
        const modelKey = normalizeModelKey(String(row.model_name || ""));
        const cost = new Decimal(row.cost || 0);
        meterByDate.set(dateKey, (meterByDate.get(dateKey) || new Decimal(0)).plus(cost));
        if (modelKey) {
            const key = `${dateKey}::${modelKey}`;
            meterByDateModel.set(key, (meterByDateModel.get(key) || new Decimal(0)).plus(cost));
            attributableByDate.set(dateKey, (attributableByDate.get(dateKey) || new Decimal(0)).plus(cost));
            if (!meterMetaByKey.has(key)) {
                meterMetaByKey.set(key, {
                    application: String(row.application || "unknown-subscription"),
                    team: String(row.team || "Sin asignar"),
                });
            }
        }
    }

    const rows = aiRows.map((r) => ({ ...r, cost: new Decimal(0) }));
    const rowsByDate = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
        const dateKey = toDateKey(rows[i].date);
        const arr = rowsByDate.get(dateKey) || [];
        arr.push(i);
        rowsByDate.set(dateKey, arr);
    }

    const matchedMeterKeys = new Set<string>();

    for (const [dateKey, idxs] of rowsByDate.entries()) {
        const modelBuckets = new Map<string, number[]>();
        for (const idx of idxs) {
            const key = normalizeModelKey(String(aiRows[idx].model_name || ""));
            const arr = modelBuckets.get(key) || [];
            arr.push(idx);
            modelBuckets.set(key, arr);
        }

        for (const [modelKey, modelIdxs] of modelBuckets.entries()) {
            const meterKey = `${dateKey}::${modelKey}`;
            const modelMeter = meterByDateModel.get(meterKey);
            if (!modelMeter || modelMeter.lte(0)) continue;

            const totalTokens = modelIdxs.reduce(
                (sum, idx) => sum + Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0),
                0
            );
            for (const idx of modelIdxs) {
                const rowTokens = Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0);
                const share = totalTokens > 0 ? new Decimal(rowTokens).dividedBy(totalTokens) : new Decimal(1).dividedBy(modelIdxs.length);
                rows[idx].cost = modelMeter.times(share).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
            }
            matchedMeterKeys.add(meterKey);
        }
    }

    const syntheticRows: AggRow[] = [];
    for (const [meterKey, cost] of meterByDateModel.entries()) {
        if (matchedMeterKeys.has(meterKey) || cost.lte(0)) continue;
        const sepIdx = meterKey.indexOf("::");
        const dateKey = meterKey.substring(0, sepIdx);
        const modelKey = meterKey.substring(sepIdx + 2);
        const meta = meterMetaByKey.get(meterKey);
        syntheticRows.push({
            model_name: modelKey,
            application: meta?.application || "unknown-subscription",
            team: meta?.team || "Sin asignar",
            date: dateKey,
            cost,
            requestCount: 0,
            inputTokens: 0,
            outputTokens: 0,
        });
    }

    let orphanDateCost = new Decimal(0);
    for (const [dateKey, meterTotal] of meterByDate.entries()) {
        const attributable = attributableByDate.get(dateKey) || new Decimal(0);
        const remaining = meterTotal.minus(attributable);
        if (remaining.lte(0)) continue;
        const idxs = rowsByDate.get(dateKey);
        if (idxs && idxs.length > 0) {
            const totalTokens = idxs.reduce(
                (sum, idx) => sum + Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0),
                0
            );
            for (const idx of idxs) {
                const rowTokens = Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0);
                const share = totalTokens > 0 ? new Decimal(rowTokens).dividedBy(totalTokens) : new Decimal(1).dividedBy(idxs.length);
                rows[idx].cost = (rows[idx].cost as Decimal).plus(remaining.times(share)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
            }
        } else {
            orphanDateCost = orphanDateCost.plus(remaining);
        }
    }

    if (orphanDateCost.gt(0) && rows.length > 0) {
        const tokenBase = rows.reduce((sum, r) => sum + Number(r.inputTokens || 0) + Number(r.outputTokens || 0), 0);
        for (const row of rows) {
            const rowTokens = Number(row.inputTokens || 0) + Number(row.outputTokens || 0);
            const share = tokenBase > 0 ? new Decimal(rowTokens).dividedBy(tokenBase) : new Decimal(1).dividedBy(rows.length);
            row.cost = (row.cost as Decimal).plus(orphanDateCost.times(share)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
        }
    }

    return [...rows, ...syntheticRows].map((r) => ({ ...r, cost: r.cost }));
}

describe("AI Reconciliation - Model Matching", () => {
  it("should correctly match text-embedding model from meter to AI row", () => {
    const today = "2026-08-12";
    
    const aiRows: AggRow[] = [
      {
        model_name: "text-embedding-3-large",
        application: "app1",
        team: "eng",
        date: today,
        cost: new Decimal("50"),
        requestCount: 100,
        inputTokens: 1000000,
        outputTokens: 0,
      },
    ];

    const meterRows: AggRow[] = [
      {
        model_name: "Text Embedding 3 Large inp",
        application: "sub123",
        team: "Sin asignar",
        date: today,
        cost: new Decimal("100"),
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    ];

    const result = reconcileAiRowsWithMeterCost(aiRows, meterRows);
    
    // After reconciliation, AI row should have meter's cost (100) since it matched
    expect(result[0].cost).toEqual(new Decimal("100"));
    console.log("✓ text-embedding model correctly matched and reconciled");
  });

  it("should handle 3 models (gpt-4o, gpt-4-turbo, text-embedding) without losing any", () => {
    const today = "2026-08-12";
    
    const aiRows: AggRow[] = [
      {
        model_name: "gpt-4o",
        application: "app1",
        team: "eng",
        date: today,
        cost: new Decimal("50"),
        requestCount: 100,
        inputTokens: 500000,
        outputTokens: 100000,
      },
      {
        model_name: "gpt-4-turbo",
        application: "app2",
        team: "eng",
        date: today,
        cost: new Decimal("30"),
        requestCount: 50,
        inputTokens: 300000,
        outputTokens: 50000,
      },
      {
        model_name: "text-embedding-3-large",
        application: "app3",
        team: "eng",
        date: today,
        cost: new Decimal("10"),
        requestCount: 200,
        inputTokens: 5000000,
        outputTokens: 0,
      },
    ];

    const meterRows: AggRow[] = [
      {
        model_name: "GPT 4o inp",
        application: "sub123",
        team: "Sin asignar",
        date: today,
        cost: new Decimal("80"),
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      {
        model_name: "GPT 4 turbo inp",
        application: "sub123",
        team: "Sin asignar",
        date: today,
        cost: new Decimal("50"),
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      {
        model_name: "Text Embedding 3 Large inp",
        application: "sub123",
        team: "Sin asignar",
        date: today,
        cost: new Decimal("20"),
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    ];

    const result = reconcileAiRowsWithMeterCost(aiRows, meterRows);
    
    // All 3 models should still be present
    expect(result.length).toBe(3);
    
    // Costs should be assigned from meter (not AI's initial values)
    const byModel = new Map<string, Decimal>();
    for (const row of result) {
      byModel.set(row.model_name, new Decimal(row.cost));
    }
    
    expect(byModel.get("gpt-4o")).toEqual(new Decimal("80"));
    expect(byModel.get("gpt-4-turbo")).toEqual(new Decimal("50"));
    expect(byModel.get("text-embedding-3-large")).toEqual(new Decimal("20"));
    
    console.log("✓ All 3 models correctly matched and costs properly reconciled");
  });

  it("should surface a meter-only model (no AI row) as its own row instead of smearing its cost", () => {
    // Reproduces the production bug: gpt-5.3-codex exists in CostMeterSnapshots
    // but NOT in AICostSnapshots, so its cost was being merged into gpt-5.6-terra.
    const today = "2026-08-12";

    const aiRows: AggRow[] = [
      { model_name: "gpt-5.6-terra", application: "app1", team: "eng", date: today, cost: new Decimal("5.85"), requestCount: 10, inputTokens: 1000, outputTokens: 500 },
      { model_name: "gpt-5.1", application: "app1", team: "eng", date: today, cost: new Decimal("0.11"), requestCount: 5, inputTokens: 200, outputTokens: 100 },
    ];

    const meterRows: AggRow[] = [
      { model_name: "5.6 terra ShortCo Inp Std Gl 1M Tokens", application: "sub1", team: "Sin asignar", date: today, cost: new Decimal("1.4106"), requestCount: 0, inputTokens: 0, outputTokens: 0 },
      { model_name: "5.6 terra ShortCo Opt Std Gl 1M Tokens", application: "sub1", team: "Sin asignar", date: today, cost: new Decimal("0.1043"), requestCount: 0, inputTokens: 0, outputTokens: 0 },
      { model_name: "5.3 codex inp Gl 1M Tokens", application: "sub1", team: "Sin asignar", date: today, cost: new Decimal("0.3630"), requestCount: 0, inputTokens: 0, outputTokens: 0 },
      { model_name: "5.3 codex opt Gl 1M Tokens", application: "sub1", team: "Sin asignar", date: today, cost: new Decimal("0.0889"), requestCount: 0, inputTokens: 0, outputTokens: 0 },
      { model_name: "5.3 codex cd inp Gl 1M Tokens", application: "sub1", team: "Sin asignar", date: today, cost: new Decimal("0.0019"), requestCount: 0, inputTokens: 0, outputTokens: 0 },
      { model_name: "GPT 5.1 inp Gl 1M Tokens", application: "sub1", team: "Sin asignar", date: today, cost: new Decimal("0.0384"), requestCount: 0, inputTokens: 0, outputTokens: 0 },
      { model_name: "GPT 5.1 opt Gl 1M Tokens", application: "sub1", team: "Sin asignar", date: today, cost: new Decimal("0.1398"), requestCount: 0, inputTokens: 0, outputTokens: 0 },
    ];

    const result = reconcileAiRowsWithMeterCost(aiRows, meterRows);

    const byModel = new Map<string, Decimal>();
    for (const row of result) {
      byModel.set(row.model_name, (byModel.get(row.model_name) || new Decimal(0)).plus(new Decimal(row.cost)));
    }

    // All 3 distinct models must be present and separated.
    expect(byModel.size).toBe(3);
    expect(byModel.get("gpt-5.6-terra")).toEqual(new Decimal("1.5149"));
    expect(byModel.get("gpt-5.3-codex")).toEqual(new Decimal("0.4538")); // surfaced as its own row
    expect(byModel.get("gpt-5.1")).toEqual(new Decimal("0.1782"));       // inp+opt collapsed, not fragmented

    // Total cost is preserved (nothing lost, nothing double-counted).
    const total = [...byModel.values()].reduce((s, c) => s.plus(c), new Decimal(0));
    expect(total).toEqual(new Decimal("2.1469"));

    console.log("✓ meter-only model surfaced; costs not smeared; total preserved");
  });

  it("should collapse input/output meter sides of the same model into one key", () => {
    expect(normalizeModelKey("GPT 5.1 inp Gl 1M Tokens")).toBe("gpt-5.1");
    expect(normalizeModelKey("GPT 5.1 opt Gl 1M Tokens")).toBe("gpt-5.1");
    expect(normalizeModelKey("5.3 codex inp Gl 1M Tokens")).toBe("gpt-5.3-codex");
    expect(normalizeModelKey("5.3 codex opt Gl 1M Tokens")).toBe("gpt-5.3-codex");
    expect(normalizeModelKey("5.6 terra ShortCo Inp Std Gl 1M Tokens")).toBe("gpt-5.6-terra");
    expect(normalizeModelKey("5.6 terra ShortCo Opt Std Gl 1M Tokens")).toBe("gpt-5.6-terra");
  });

  it("should accurately estimate costs for Azure Foundry models matching real tenant data", () => {
    // 1) gpt-5.1: 63.11K in, 43.46K out -> $0.51 USD
    const cost51 = estimateCost("gpt-5.1", 63110, 43460);
    expect(Math.round(cost51 * 100) / 100).toBe(0.51);

    // 2) gpt-5.6-terra: 17.51M in, 342.3K out -> $18.74 USD
    const costTerra = estimateCost("gpt-5.6-terra", 17510000, 342300);
    expect(Math.round(costTerra * 100) / 100).toBe(18.74);

    // 3) gpt-5.3-codex: 12.27M in, 229.25K out -> $18.32 USD
    const costCodex = estimateCost("gpt-5.3-codex", 12270000, 229250);
    expect(Math.round(costCodex * 100) / 100).toBe(18.32);

    // Total 30-day spend
    const total30d = Math.round((cost51 + costTerra + costCodex) * 100) / 100;
    expect(total30d).toBe(37.57);
  });
});


import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';

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
      .replace(/\s+(inp|out|tokens?|1m|1k|gl|ad)\b/gi, "")
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

function reconcileAiRowsWithMeterCost(aiRows: AggRow[], meterRows: AggRow[]): AggRow[] {
    if (!aiRows.length || !meterRows.length) return aiRows;

    const meterByDate = new Map<string, Decimal>();
    const meterByDateModel = new Map<string, Decimal>();
    for (const row of meterRows) {
        const dateKey = toDateKey(row.date);
        const modelKey = normalizeModelKey(String(row.model_name || ""));
        const cost = new Decimal(row.cost || 0);
        meterByDate.set(dateKey, (meterByDate.get(dateKey) || new Decimal(0)).plus(cost));
        if (modelKey) {
            const key = `${dateKey}::${modelKey}`;
            meterByDateModel.set(key, (meterByDateModel.get(key) || new Decimal(0)).plus(cost));
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

    for (const [dateKey, idxs] of rowsByDate.entries()) {
        const meterTotal = meterByDate.get(dateKey) || new Decimal(0);
        if (meterTotal.lte(0)) continue;

        let assigned = new Decimal(0);
        const assignedIdx = new Set<number>();

        const modelBuckets = new Map<string, number[]>();
        for (const idx of idxs) {
            const key = normalizeModelKey(String(aiRows[idx].model_name || ""));
            const arr = modelBuckets.get(key) || [];
            arr.push(idx);
            modelBuckets.set(key, arr);
        }

        for (const [modelKey, modelIdxs] of modelBuckets.entries()) {
            const modelMeter = meterByDateModel.get(`${dateKey}::${modelKey}`);
            if (!modelMeter || modelMeter.lte(0)) continue;

            const totalTokens = modelIdxs.reduce(
                (sum, idx) => sum + Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0),
                0
            );
            for (const idx of modelIdxs) {
                const rowTokens = Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0);
                const share = totalTokens > 0 ? new Decimal(rowTokens).dividedBy(totalTokens) : new Decimal(1).dividedBy(modelIdxs.length);
                rows[idx].cost = modelMeter.times(share).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
                assigned = assigned.plus(rows[idx].cost as Decimal);
                assignedIdx.add(idx);
            }
        }

        const remaining = meterTotal.minus(assigned);
        if (remaining.gt(0)) {
            const unmatched = idxs.filter((idx) => !assignedIdx.has(idx));
            if (unmatched.length > 0) {
                const totalTokensUnmatched = unmatched.reduce(
                    (sum, idx) => sum + Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0),
                    0
                );
                for (const idx of unmatched) {
                    const rowTokens = Number(aiRows[idx].inputTokens || 0) + Number(aiRows[idx].outputTokens || 0);
                    const share = totalTokensUnmatched > 0
                        ? new Decimal(rowTokens).dividedBy(totalTokensUnmatched)
                        : new Decimal(1).dividedBy(unmatched.length);
                    rows[idx].cost = (rows[idx].cost as Decimal).plus(remaining.times(share)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
                }
            }
        }
    }

    return rows.map((r) => ({ ...r, cost: r.cost }));
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
});

import { describe, it, expect, beforeEach, vi } from "vitest";

const insertCostSnapshot = vi.fn();
const insertCostSnapshotRow = vi.fn();
const getYesterdaysCost = vi.fn();
const getYesterdaysDetailedCosts = vi.fn();

vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn() },
    insertCostSnapshot: (...a: unknown[]) => insertCostSnapshot(...a),
    insertCostSnapshotRow: (...a: unknown[]) => insertCostSnapshotRow(...a),
    insertCostMeterSnapshotRow: vi.fn(),
    insertCostCategorySnapshotRow: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ redis: { set: vi.fn(async () => "OK") } }));
vi.mock("@/modules/collectors/azure/billingService", () => ({
    getHistoricalDailyCosts: vi.fn(async () => []),
    getHistoricalDetailedCosts: vi.fn(async () => []),
    getYesterdaysCost: (...a: unknown[]) => getYesterdaysCost(...a),
    getYesterdaysDetailedCosts: (...a: unknown[]) => getYesterdaysDetailedCosts(...a),
    AZURE_COST_HISTORY_MAX_MONTHS: 13,
}));

import pool from "@/modules/storage/db";
import { findMissingDays, backfillMissingDaysOneByOne } from "@/lib/historicalGapBackfill";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const dayKey = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
};

beforeEach(() => {
    vi.clearAllMocks();
    getYesterdaysCost.mockResolvedValue(10);
    getYesterdaysDetailedCosts.mockResolvedValue([{ kind: "resource", cost: 10 }]);
});

describe("detección de días faltantes", () => {
    it("lista sólo los días sin filas", async () => {
        // Presentes ayer y anteayer; falta el de hace 3 días.
        query.mockResolvedValue([[{ d: dayKey(1) }, { d: dayKey(2) }]]);
        const missing = await findMissingDays("t1", 3);
        expect(missing).toContain(dayKey(3));
        expect(missing).not.toContain(dayKey(1));
    });

    it("no incluye el día en curso: todavía no cerró en Cost Management", async () => {
        query.mockResolvedValue([[]]);
        const missing = await findMissingDays("t1", 3);
        expect(missing).not.toContain(new Date().toISOString().slice(0, 10));
    });

    it("devuelve del más viejo al más nuevo, para rellenar en orden", async () => {
        query.mockResolvedValue([[]]);
        const missing = await findMissingDays("t1", 3);
        expect(missing).toEqual([...missing].sort());
    });
});

describe("backfill día por día", () => {
    it("pide un día por vez y persiste cada uno", async () => {
        query.mockResolvedValue([[]]); // faltan los 2 días de la ventana
        const res = await backfillMissingDaysOneByOne("t1", { lookbackDays: 2, paceMs: 0 });

        expect(res.daysAttempted).toBe(2);
        expect(res.daysRecovered).toBe(2);
        expect(getYesterdaysDetailedCosts).toHaveBeenCalledTimes(2);
        expect(insertCostSnapshot).toHaveBeenCalledTimes(2);
    });

    it("corta tras 3 fallos seguidos en vez de martillar la API throttleada", async () => {
        query.mockResolvedValue([[]]);
        const throttled: any = new Error("Too many requests");
        throttled.statusCode = 429;
        getYesterdaysCost.mockRejectedValue(throttled);

        const res = await backfillMissingDaysOneByOne("t1", { lookbackDays: 30, paceMs: 0 });

        expect(res.abortedByThrottling).toBe(true);
        expect(res.daysRecovered).toBe(0);
        // Se detiene en 3, no intenta los 30.
        expect(getYesterdaysCost.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it("conserva el progreso parcial cuando la cuota se agota a mitad", async () => {
        // Es la ventaja sobre la consulta mensual: ahí un 429 se lleva puesta
        // la corrida entera y no queda nada persistido.
        query.mockResolvedValue([[]]);
        let call = 0;
        getYesterdaysCost.mockImplementation(async () => {
            call++;
            if (call <= 2) return 5;
            const e: any = new Error("Too many requests");
            e.statusCode = 429;
            throw e;
        });

        const res = await backfillMissingDaysOneByOne("t1", { lookbackDays: 10, paceMs: 0 });

        expect(res.daysRecovered).toBe(2);
        expect(res.abortedByThrottling).toBe(true);
        expect(res.remainingDays.length).toBeGreaterThan(0);
    });

    it("un fallo aislado no aborta la corrida", async () => {
        query.mockResolvedValue([[]]);
        let call = 0;
        getYesterdaysCost.mockImplementation(async () => {
            call++;
            if (call === 1) throw new Error("hipo transitorio");
            return 5;
        });

        const res = await backfillMissingDaysOneByOne("t1", { lookbackDays: 4, paceMs: 0 });
        expect(res.abortedByThrottling).toBe(false);
        expect(res.daysRecovered).toBeGreaterThan(0);
    });

    it("respeta el techo de días por corrida", async () => {
        query.mockResolvedValue([[]]);
        const res = await backfillMissingDaysOneByOne("t1", { lookbackDays: 60, maxDays: 3, paceMs: 0 });
        expect(res.daysAttempted).toBe(3);
    });

    it("no hace nada si no faltan días", async () => {
        query.mockResolvedValue([[{ d: dayKey(1) }, { d: dayKey(2) }]]);
        const res = await backfillMissingDaysOneByOne("t1", { lookbackDays: 2, paceMs: 0 });
        expect(res.daysAttempted).toBe(0);
        expect(getYesterdaysCost).not.toHaveBeenCalled();
    });
});

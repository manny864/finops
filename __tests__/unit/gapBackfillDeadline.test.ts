// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getYesterdaysCost = vi.fn(async () => 1);
const getYesterdaysDetailedCosts = vi.fn(async () => []);

vi.mock("@/modules/storage/db", () => ({
    // Sin filas presentes: findMissingDays devuelve toda la ventana.
    default: { query: vi.fn(async () => [[]]) },
    insertCostSnapshot: vi.fn(async () => {}),
    insertCostSnapshotRow: vi.fn(async () => {}),
    insertCostMeterSnapshotRow: vi.fn(async () => {}),
    insertCostCategorySnapshotRow: vi.fn(async () => {}),
}));
vi.mock("@/modules/collectors/azure/billingService", () => ({
    getYesterdaysCost: (...a: any[]) => (getYesterdaysCost as any)(...a),
    getYesterdaysDetailedCosts: (...a: any[]) => (getYesterdaysDetailedCosts as any)(...a),
    getHistoricalDailyCosts: vi.fn(async () => []),
    getHistoricalDetailedCosts: vi.fn(async () => []),
    AZURE_COST_HISTORY_MAX_MONTHS: 12,
}));
vi.mock("@/lib/redis", () => ({ redis: { get: async () => null, set: async () => "OK", del: async () => 1 } }));

import { backfillMissingDaysOneByOne } from "@/lib/historicalGapBackfill";

describe("backfillMissingDaysOneByOne — corte por deadline", () => {
    beforeEach(() => { getYesterdaysCost.mockClear(); });

    it("frena a mitad del tenant y deja el resto en remainingDays", async () => {
        // El bug real: el cron solo miraba el reloj ENTRE tenants, asi que un
        // tenant con 40 dias de hueco corria pasado el presupuesto hasta que el
        // runner cortaba por poll timeout a los 60 min y la corrida entera
        // figuraba fallida, perdiendo el registro de lo que si se recupero.
        // Reloj controlado: con los mocks los 40 dias corren en menos de un
        // milisegundo, asi que un deadline en tiempo real no se alcanza nunca y
        // el test pasaria sin ejercitar el corte.
        const t0 = 1_000_000;
        let ahora = t0;
        const real = Date.now;
        vi.spyOn(Date, "now").mockImplementation(() => (ahora += 10));

        const r = await backfillMissingDaysOneByOne("t1", { paceMs: 0, deadline: t0 + 60 });
        (Date.now as any).mockRestore?.();
        Date.now = real;

        expect(r.daysAttempted).toBeGreaterThan(r.daysRecovered);
        expect(r.remainingDays.length).toBeGreaterThan(0);
        // Cortar por tiempo NO es throttling: marcarlo asi dispararia ademas la
        // consulta ancha de respaldo, que es justo la que satura Cost Management.
        expect(r.abortedByThrottling).toBe(false);
    });

    it("sin deadline procesa todos los dias objetivo", async () => {
        const r = await backfillMissingDaysOneByOne("t1", { paceMs: 0, maxDays: 5 });
        expect(r.daysRecovered).toBe(r.daysAttempted);
        expect(r.remainingDays.length).toBeGreaterThan(0); // los que quedan fuera de maxDays
    });
});

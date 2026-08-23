import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn() },
    insertCostSnapshot: vi.fn(),
    insertCostSnapshotRow: vi.fn(),
    insertCostMeterSnapshotRow: vi.fn(),
    insertCostCategorySnapshotRow: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ redis: { set: vi.fn(async () => "OK") } }));
vi.mock("@/modules/collectors/azure/billingService", () => ({
    getHistoricalDailyCosts: vi.fn(async () => []),
    getHistoricalDetailedCosts: vi.fn(async () => []),
    AZURE_COST_HISTORY_MAX_MONTHS: 13,
}));

import pool from "@/modules/storage/db";
import { redis } from "@/lib/redis";
import { triggerBackfillIfStale } from "@/lib/historicalGapBackfill";
import { getHistoricalDailyCosts } from "@/modules/collectors/azure/billingService";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const redisSet = redis.set as unknown as ReturnType<typeof vi.fn>;
const fetchHistory = getHistoricalDailyCosts as unknown as ReturnType<typeof vi.fn>;

/** Deja que corra el fire-and-forget interno de triggerBackfillIfStale. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function snapshotState(opts: { lastDay: string; firstDay: string; daysWithData: number }) {
    query.mockResolvedValue([[{
        lastDay: opts.lastDay,
        firstDay: opts.firstDay,
        daysWithData: opts.daysWithData,
    }]]);
}

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);

beforeEach(() => {
    query.mockReset();
    fetchHistory.mockClear();
    redisSet.mockReset().mockResolvedValue("OK");
});

describe("detección de histórico incompleto", () => {
    it("dispara el backfill ante huecos internos aunque el último día sea reciente", async () => {
        // El caso real: último día a 2 días de antigüedad (parece sano) pero
        // 14 de 25 días sin datos. Con la lógica vieja —que sólo miraba
        // MAX(date)— esto se daba por "al día" y el reporte de facturación
        // informaba 368 USD en lugar de 677.
        snapshotState({ lastDay: daysAgo(2), firstDay: daysAgo(26), daysWithData: 11 });

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchHistory).toHaveBeenCalled();
    });

    it("no dispara cuando el histórico es continuo", async () => {
        // 25 días de span, 25 días con datos: sin huecos.
        snapshotState({ lastDay: daysAgo(1), firstDay: daysAgo(25), daysWithData: 25 });

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it("tolera huecos aislados: un día sin consumo no genera filas", async () => {
        // 2 faltantes sobre 25 está por debajo del umbral; reaccionar acá
        // dispararía el backfill de 13 meses de forma permanente.
        snapshotState({ lastDay: daysAgo(1), firstDay: daysAgo(25), daysWithData: 23 });

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it("sigue disparando cuando el último día quedó viejo", async () => {
        snapshotState({ lastDay: daysAgo(10), firstDay: daysAgo(12), daysWithData: 3 });

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchHistory).toHaveBeenCalled();
    });

    it("dispara si el tenant no tiene ninguna fila", async () => {
        query.mockResolvedValue([[{ lastDay: null, firstDay: null, daysWithData: 0 }]]);

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchHistory).toHaveBeenCalled();
    });

    it("un tenant nuevo con pocos días continuos no se marca incompleto", async () => {
        // Alta hace 3 días: no puede cubrir la ventana entera y no es un hueco.
        snapshotState({ lastDay: daysAgo(1), firstDay: daysAgo(3), daysWithData: 3 });

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it("respeta el lock: no re-dispara si ya corrió hace poco", async () => {
        redisSet.mockResolvedValue(null); // lock ya tomado
        snapshotState({ lastDay: daysAgo(2), firstDay: daysAgo(26), daysWithData: 11 });

        triggerBackfillIfStale("t1");
        await flush();

        // Sin el lock, cada carga del reporte pegaría a Cost Management.
        expect(fetchHistory).not.toHaveBeenCalled();
    });
});

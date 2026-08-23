import { describe, it, expect, beforeEach, vi } from "vitest";

// El backfill diario pausa entre días; sin esto el flush() asertaría antes
// de que el flujo termine.
process.env.GAP_BACKFILL_PACE_MS = "0";

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
    // El trigger ahora intenta primero la estrategia día por día, que usa estas.
    getYesterdaysCost: vi.fn(async () => 0),
    getYesterdaysDetailedCosts: vi.fn(async () => []),
    AZURE_COST_HISTORY_MAX_MONTHS: 13,
}));

import pool from "@/modules/storage/db";
import { redis } from "@/lib/redis";
import { triggerBackfillIfStale } from "@/lib/historicalGapBackfill";
import { getHistoricalDailyCosts, getYesterdaysCost } from "@/modules/collectors/azure/billingService";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const redisSet = redis.set as unknown as ReturnType<typeof vi.fn>;
const fetchHistory = getHistoricalDailyCosts as unknown as ReturnType<typeof vi.fn>;
/** La estrategia diaria es la que corre primero; observarla es observar
 *  "el backfill intentó recuperar datos". */
const fetchDay = getYesterdaysCost as unknown as ReturnType<typeof vi.fn>;

/** Deja que corra el fire-and-forget interno de triggerBackfillIfStale. */
const flush = () => new Promise((r) => setTimeout(r, 20));

/**
 * El flujo hace dos consultas distintas: la de staleness (lastDay/firstDay/
 * daysWithData) y la de días presentes que usa findMissingDays (columna `d`).
 * Se responde según el SQL para que ambas reciban la forma que esperan.
 */
function snapshotState(opts: { lastDay: string; firstDay: string; daysWithData: number; presentDays?: string[] }) {
    query.mockImplementation(async (sql: string) => {
        if (/SELECT\s+DISTINCT\s+DATE\(/i.test(String(sql))) {
            return [(opts.presentDays ?? []).map((d) => ({ d }))];
        }
        return [[{ lastDay: opts.lastDay, firstDay: opts.firstDay, daysWithData: opts.daysWithData }]];
    });
}

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
/** Histórico sin huecos: todos los días de la ventana presentes. */
const allDaysBack = (n: number) => Array.from({ length: n + 1 }, (_, i) => daysAgo(i));

beforeEach(() => {
    query.mockReset();
    fetchHistory.mockClear();
    fetchDay.mockClear();
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

        // Cualquiera de las dos estrategias cuenta como "intentó recuperar".
        expect(fetchDay.mock.calls.length + fetchHistory.mock.calls.length).toBeGreaterThan(0);
    });

    it("no dispara cuando el histórico es continuo", async () => {
        // 25 días de span, 25 días con datos: sin huecos.
        snapshotState({ lastDay: daysAgo(1), firstDay: daysAgo(25), daysWithData: 25, presentDays: allDaysBack(60) });

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchDay).not.toHaveBeenCalled();
        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it("tolera huecos aislados: un día sin consumo no genera filas", async () => {
        // 2 faltantes sobre 25 está por debajo del umbral; reaccionar acá
        // dispararía el backfill de 13 meses de forma permanente.
        snapshotState({ lastDay: daysAgo(1), firstDay: daysAgo(25), daysWithData: 23, presentDays: allDaysBack(60) });

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchDay).not.toHaveBeenCalled();
        expect(fetchHistory).not.toHaveBeenCalled();
    });

    it("sigue disparando cuando el último día quedó viejo", async () => {
        snapshotState({ lastDay: daysAgo(10), firstDay: daysAgo(12), daysWithData: 3 });

        triggerBackfillIfStale("t1");
        await flush();

        // Cualquiera de las dos estrategias cuenta como "intentó recuperar".
        expect(fetchDay.mock.calls.length + fetchHistory.mock.calls.length).toBeGreaterThan(0);
    });

    it("dispara si el tenant no tiene ninguna fila", async () => {
        query.mockResolvedValue([[{ lastDay: null, firstDay: null, daysWithData: 0 }]]);

        triggerBackfillIfStale("t1");
        await flush();

        // Cualquiera de las dos estrategias cuenta como "intentó recuperar".
        expect(fetchDay.mock.calls.length + fetchHistory.mock.calls.length).toBeGreaterThan(0);
    });

    it("un tenant nuevo con pocos días continuos no se marca incompleto", async () => {
        // Alta hace 3 días: no puede cubrir la ventana entera y no es un hueco.
        snapshotState({ lastDay: daysAgo(1), firstDay: daysAgo(3), daysWithData: 3, presentDays: allDaysBack(60) });

        triggerBackfillIfStale("t1");
        await flush();

        expect(fetchDay).not.toHaveBeenCalled();
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

describe("lock tras un backfill que no recuperó nada", () => {
    it("acorta el lock a 15 min cuando Azure no devolvió filas", async () => {
        // Caso real reproducido contra Azure: 429 sostenido de Cost Management,
        // los reintentos internos se agotan y el backfill retorna 0 filas
        // reportando éxito. Con el lock de 6 h intacto, el hueco sobrevivía
        // medio día más.
        snapshotState({ lastDay: daysAgo(2), firstDay: daysAgo(26), daysWithData: 11 });
        // Throttling sostenido: la vía diaria corta y la mensual no trae nada.
        const throttled: any = new Error("Too many requests");
        throttled.statusCode = 429;
        fetchDay.mockRejectedValue(throttled);
        fetchHistory.mockResolvedValue([]);

        triggerBackfillIfStale("t1");
        await flush();

        const ttls = redisSet.mock.calls.map((c) => c[3]);
        expect(ttls).toContain(15 * 60);
    });

    it("conserva el lock largo cuando sí recuperó filas", async () => {
        snapshotState({ lastDay: daysAgo(2), firstDay: daysAgo(26), daysWithData: 11 });
        // Recuperación exitosa por la estrategia diaria.
        fetchDay.mockResolvedValue(12.5);

        triggerBackfillIfStale("t1");
        await flush();

        const ttls = redisSet.mock.calls.map((c) => c[3]);
        expect(ttls).toContain(6 * 60 * 60);
        expect(ttls).not.toContain(15 * 60);
    });
});

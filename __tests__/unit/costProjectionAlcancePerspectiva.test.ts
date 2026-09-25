// @vitest-environment node
/**
 * MEJ-34 — la serie de Gastos y Proyección honrando el alcance transversal.
 *
 * Tercer tablero, y el primero que NO es un balde por centro de costo sino una
 * serie temporal. Trajo dos trampas propias:
 *
 *   - EL BACKFILL DE AZURE NO SE PUEDE ACOTAR y además GANA en las fechas que
 *     se superponen. `getHistoricalDailyCosts` devuelve totales diarios sin
 *     dimensión de recurso, así que bajo alcance pisaría los días acotados con
 *     el total del tenant: la serie quedaría mitad recortada y mitad no, sin
 *     que nada lo indique.
 *   - EL SERVICIO CAUSANTE de cada pico tiene que salir del mismo universo que
 *     la serie, o el tooltip nombraría un servicio que en ese alcance no gastó.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, redisMock, backfillMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    redisMock: { get: vi.fn(async () => null), set: vi.fn(async () => "OK") },
    backfillMock: vi.fn(async () => [] as Array<{ date: string; cost: number }>),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ email: "u@u" })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/modules/collectors/azure/billingService", () => ({
    getHistoricalDailyCosts: backfillMock,
    AZURE_COST_HISTORY_MAX_MONTHS: 13,
}));

import { GET } from "@/app/api/intelligence/cost-projection/route";

const req = (qs = "") =>
    new NextRequest(`http://localhost/api/intelligence/cost-projection?tenantId=t1${qs}`);

/**
 * Siete días tranquilos y un pico al final. El pico está repartido a propósito:
 * lo domina SQL en desarrollo (400) pero en Producción el causante es VM (100).
 * Es lo que distingue "el causante sale del universo acotado" de no.
 */
const DIAS = ["01", "02", "03", "04", "05", "06", "07"].map((dd) => `2026-09-${dd}`);
const PICO = "2026-09-08";

const fila = (d: string, env: string, svc: string, cost: number) => ({
    d, subscription_id: "s1", resource_group: `rg-${env}`, service_name: svc,
    ResourceId: `/r/${env}`, Tags: { Environment: env }, cost,
});

const DETALLE = [
    ...DIAS.map((d) => fila(d, "prod", "VM", 10)),
    fila(PICO, "prod", "VM", 100),
    fila(PICO, "dev", "SQL", 400),
];
const AGREGADO = [
    ...DIAS.map((d) => ({ d, cost: 10 })),
    { d: PICO, cost: 500 },
];

function stubDb({ exacto }: { exacto: boolean }) {
    queryMock.mockImplementation(async (sql: string) => {
        const s = String(sql);
        if (s.includes("costWithProvenance")) {
            return [[{ costTotal: 200, costWithProvenance: exacto ? 200 : 0 }]];
        }
        if (s.includes("FROM Perspectives")) return [[{ id: 7, name: "Entorno", description: null }]];
        if (s.includes("FROM PerspectiveRules")) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        // Las dos formas de cada consulta se distinguen por el detalle.
        if (s.includes("AS service") && s.includes("subscription_id")) {
            return [DETALLE.map((f) => ({ ...f, service: f.service_name, total: f.cost }))];
        }
        if (s.includes("AS service")) {
            return [[
                ...DIAS.map((d) => ({ d, service: "VM", total: 10 })),
                { d: PICO, service: "SQL", total: 400 },
                { d: PICO, service: "VM", total: 100 },
            ]];
        }
        if (s.includes("GROUP BY d, subscription_id")) return [DETALLE];
        if (s.includes("GROUP BY d")) return [AGREGADO];
        return [[]];
    });
}

const serie = (j: any) =>
    Object.fromEntries((j.dailyHistory as Array<{ date: string; cost: number }>)
        .filter((p) => p.cost > 0).map((p) => [p.date, p.cost]));

beforeEach(() => {
    queryMock.mockReset();
    redisMock.get.mockReset().mockResolvedValue(null);
    redisMock.set.mockReset().mockResolvedValue("OK");
    backfillMock.mockReset().mockResolvedValue([]);
});

describe("GET /api/intelligence/cost-projection con alcance de Perspective", () => {
    it("acota la serie diaria y el mensual se deriva de lo acotado", async () => {
        stubDb({ exacto: true });
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"))).json();

        expect(j.scopeApplied).toBe(true);
        expect(serie(j)).toEqual({ "2026-09-01": 10, "2026-09-02": 10, "2026-09-03": 10, "2026-09-04": 10, "2026-09-05": 10, "2026-09-06": 10, "2026-09-07": 10, "2026-09-08": 100 });
        expect(j.monthlyHistory).toEqual([{ month: "2026-09", cost: 170 }]);
    });

    it("no rellena desde Azure, que pisaría los días acotados con el total del tenant", async () => {
        stubDb({ exacto: true });
        await GET(req("&perspective=7&pgroup=Producci%C3%B3n"));
        expect(backfillMock).not.toHaveBeenCalled();
    });

    it("el servicio causante sale del mismo universo que la serie", async () => {
        stubDb({ exacto: true });
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"))).json();
        const dia = j.dailyHistory.find((p: any) => p.date === PICO);
        expect(dia.isSpike).toBe(true);
        // Sin acotar el pico lo domina SQL (400 contra 100); en Producción SQL
        // no gastó nada y el causante es VM.
        expect(dia.spikeService).toBe("VM");
    });

    it("no cachea el recorte: la clave sería una por grupo", async () => {
        stubDb({ exacto: true });
        await GET(req("&perspective=7&pgroup=Producci%C3%B3n"));
        expect(redisMock.get).not.toHaveBeenCalled();
        expect(redisMock.set).not.toHaveBeenCalled();
    });

    it("si el costo de la ventana llega sin procedencia, NO acota y lo dice", async () => {
        stubDb({ exacto: false });
        const j = await (await GET(req("&perspective=7&pgroup=Producci%C3%B3n"))).json();

        expect(j.scopeApplied).toBe(false);
        expect(serie(j)).toEqual({ "2026-09-01": 10, "2026-09-02": 10, "2026-09-03": 10, "2026-09-04": 10, "2026-09-05": 10, "2026-09-06": 10, "2026-09-07": 10, "2026-09-08": 500 });
    });

    it("sin alcance la serie no cambia: sigue agregando en SQL", async () => {
        stubDb({ exacto: true });
        const j = await (await GET(req())).json();

        expect(j.scopeApplied).toBe(false);
        expect(serie(j)).toEqual({ "2026-09-01": 10, "2026-09-02": 10, "2026-09-03": 10, "2026-09-04": 10, "2026-09-05": 10, "2026-09-06": 10, "2026-09-07": 10, "2026-09-08": 500 });
        expect(queryMock.mock.calls.some(([s]) => String(s).includes("GROUP BY d, subscription_id"))).toBe(false);
    });
});

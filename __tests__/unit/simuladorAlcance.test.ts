// @vitest-environment node
/**
 * MEJ-34 — el simulador What-If, acotado.
 *
 * Todo el simulador proyecta porcentajes sobre UN número: el gasto base. Por
 * eso alcanza con recortar ese número — y por eso, si no se recorta, la
 * pantalla contesta otra pregunta sin avisar: "¿qué pasa si mi equipo crece
 * 20%?" respondido sobre el gasto del tenant entero.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, alcanceMock, exigirMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    alcanceMock: vi.fn(),
    exigirMock: vi.fn(),
}));

const IDENT = { email: "u@u", tenantId: "t1", claims: {}, isCorporateDomain: false };
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => IDENT),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false }));
vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock },
    initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("@/services/perspectivesData.service", () => ({
    alcanceDeLaRuta: alcanceMock,
    exigirRecorte: exigirMock,
}));

import { GET } from "@/app/api/analytics/simulator/route";

const pedir = (qs = "") =>
    GET(new NextRequest(`http://localhost/api/analytics/simulator?tenantId=t1${qs}`));

beforeEach(() => {
    queryMock.mockReset().mockImplementation(async (sql: string) =>
        String(sql).includes("FROM CostSnapshots") ? [[{ spend: 50_000 }]] : [[]]
    );
    alcanceMock.mockReset().mockResolvedValue({ and: "", params: [], aplicado: false, recorte: null });
    exigirMock.mockReset();
});

describe("el gasto base se recorta", () => {
    it("el predicado y sus parámetros llegan a la consulta", async () => {
        alcanceMock.mockResolvedValue({
            and: "AND (COALESCE(resource_group,'') IN (?))", params: ["rg-datos"], aplicado: true, recorte: null,
        });
        await pedir("&perspective=7&pgroup=Datos");

        const base = queryMock.mock.calls.find(([s]) => String(s).includes("FROM CostSnapshots"));
        expect(String(base?.[0])).toContain("COALESCE(resource_group,'')");
        expect(base?.[1]).toEqual(["t1", "rg-datos"]);
    });

    it("sin alcance la consulta queda como estaba", async () => {
        await pedir();
        const base = queryMock.mock.calls.find(([s]) => String(s).includes("FROM CostSnapshots"));
        expect(base?.[1]).toEqual(["t1"]);
    });
});

describe("la pantalla dice sobre qué alcance está parada", () => {
    it("declara cuando el recorte se aplicó", async () => {
        alcanceMock.mockResolvedValue({ and: "", params: [], aplicado: true, recorte: null });
        const j = await (await pedir("&perspective=7")).json();
        expect(j.alcanceAplicado).toBe(true);
    });

    it("y cuando no", async () => {
        const j = await (await pedir()).json();
        expect(j.alcanceAplicado).toBe(false);
    });
});

describe("como permiso, un recorte que no se puede aplicar corta", () => {
    it("se le pasa el veredicto a `exigirRecorte`, que es quien tira el 403", async () => {
        alcanceMock.mockResolvedValue({ and: "", params: [], aplicado: false, recorte: null });
        await pedir();
        expect(exigirMock).toHaveBeenCalledWith(null, false);
    });
});

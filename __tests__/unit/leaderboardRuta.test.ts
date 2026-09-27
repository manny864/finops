// @vitest-environment node
/**
 * MEJ-37 — la ruta: de dónde sale cada columna.
 *
 * El orden ya está fijado en `leaderboardDeEquipos.test.ts`, que prueba la
 * función pura. Acá se cuidan los cruces, que es donde se puede mentir sin
 * darse cuenta: el presupuesto que no es de ese equipo y el ahorro que se
 * atribuye con otro criterio que el costo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, filasMock, listarMock, repartirMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    filasMock: vi.fn(),
    listarMock: vi.fn(),
    repartirMock: vi.fn(),
}));

const IDENT = { email: "u@u", tenantId: "t1", claims: {}, isCorporateDomain: false };
vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(async () => IDENT),
    requireTenantRole: vi.fn(async () => IDENT),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false, getMockDataForRoute: () => ({}) }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/services/perspectivesData.service", () => ({
    filasDeCosto: filasMock,
    listarPerspectivas: listarMock,
}));
vi.mock("@/services/perspectives.service", async (orig) => ({
    ...(await orig<any>()),
    repartir: repartirMock,
}));

import { GET } from "@/app/api/intelligence/leaderboard/route";

const pedir = () => GET(new NextRequest("http://localhost/api/intelligence/leaderboard?tenantId=t1"));

/** Reparto con dos grupos; el segundo argumento distingue actual de previo. */
function reparto(grupos: Array<[string, number]>) {
    return {
        grupos: grupos.map(([grupo, costo]) => ({ grupo, costo, porcentaje: 0, filas: 1 })),
        sinAsignar: { costo: 0, porcentaje: 0, filas: 0 },
        sinDatos: { costo: 0, porcentaje: 0, filas: 0, motivos: [] },
        total: grupos.reduce((a, [, c]) => a + c, 0),
        coberturaPct: 100,
    };
}

beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([[]]);
    filasMock.mockReset().mockResolvedValue([]);
    listarMock.mockReset().mockResolvedValue([{ id: 1, name: "Equipos", reglas: [] }]);
    repartirMock.mockReset();
});

describe("sin Perspective no hay tablero, y se dice", () => {
    it("no devuelve una tabla vacía, que se leería como «nadie gastó»", async () => {
        listarMock.mockResolvedValue([]);
        const j = await (await pedir()).json();
        expect(j.sinPerspectiva).toBe(true);
        expect(j.message).toMatch(/Perspective/);
        expect(j.filas).toBeUndefined();
    });
});

describe("el presupuesto se cruza por NOMBRE, y cuando no coincide queda vacío", () => {
    beforeEach(() => {
        repartirMock
            .mockReturnValueOnce(reparto([["Plataforma", 9_000], ["Datos", 5_000]]))  // actual
            .mockReturnValueOnce(reparto([["Plataforma", 10_000], ["Datos", 5_000]])) // previo
            .mockReturnValue(reparto([]));                                             // ahorro
    });

    it("el que coincide toma su presupuesto", async () => {
        queryMock.mockImplementation(async (sql: string) =>
            String(sql).includes("CostCenterBudgets")
                ? [[{ nombre: "plataforma", monto: 18_000 }]]
                : [[]]
        );
        const j = await (await pedir()).json();
        expect(j.filas.find((f: any) => f.grupo === "Plataforma").adherenciaPct).toBe(50);
    });

    it("el que no coincide aparece igual, con la columna vacía — NO con el de otro", async () => {
        // Mostrar el presupuesto de otro equipo sería peor que no mostrar ninguno.
        queryMock.mockImplementation(async (sql: string) =>
            String(sql).includes("CostCenterBudgets")
                ? [[{ nombre: "un centro que no es ningun grupo", monto: 18_000 }]]
                : [[]]
        );
        const j = await (await pedir()).json();
        expect(j.filas).toHaveLength(2);
        expect(j.filas.every((f: any) => f.adherenciaPct === null)).toBe(true);
    });
});

describe("el ahorro capturado", () => {
    it("sólo cuenta remediaciones aprobadas Y con resultado de ejecución ARM", async () => {
        repartirMock.mockReturnValue(reparto([["Plataforma", 100]]));
        await pedir();
        const sql = queryMock.mock.calls.map(([s]) => String(s)).find((s) => s.includes("RemediationRequests"));
        expect(sql).toBeDefined();
        expect(sql).toContain("status = 'Approved'");
        // Aprobar es una intención; esta columna dice "esto ya se hizo".
        expect(sql).toContain("arm_execution_result_json IS NOT NULL");
    });

    it("se atribuye con LAS MISMAS reglas que el costo, no con un criterio propio", async () => {
        // Una segunda forma de decidir de qué equipo es un recurso sería una
        // segunda forma de equivocarse.
        repartirMock.mockReturnValue(reparto([["Plataforma", 100]]));
        queryMock.mockImplementation(async (sql: string) =>
            String(sql).includes("RemediationRequests")
                ? [[{ resourceId: "/x", resourceGroup: "rg", subscriptionId: "s", ahorro: 500 }]]
                : [[]]
        );
        await pedir();
        // La tercera llamada a repartir es la del ahorro, con las mismas reglas.
        const llamadaAhorro = repartirMock.mock.calls[2];
        expect(llamadaAhorro[0][0]).toMatchObject({ costo: 500, resourceGroup: "rg" });
        expect(llamadaAhorro[1]).toBe(repartirMock.mock.calls[0][1]);
    });

    it("las remediaciones entran SIN etiquetas, y eso es literal", async () => {
        // RemediationRequests no guarda tags. Inventarlas desde el nombre del
        // recurso pondría el ahorro en el equipo equivocado.
        repartirMock.mockReturnValue(reparto([["Plataforma", 100]]));
        queryMock.mockImplementation(async (sql: string) =>
            String(sql).includes("RemediationRequests")
                ? [[{ resourceId: "/x", resourceGroup: "rg", subscriptionId: "s", ahorro: 500 }]]
                : [[]]
        );
        await pedir();
        expect(repartirMock.mock.calls[2][0][0].tags).toBeNull();
    });
});

describe("lo que no cae en ningún equipo se informa", () => {
    it("`sinAsignar` viaja en la respuesta: si no, el total no cuadra con la factura", async () => {
        const r = reparto([["Plataforma", 9_000]]);
        r.sinAsignar = { costo: 1_000, porcentaje: 10, filas: 3 };
        r.coberturaPct = 90;
        repartirMock.mockReturnValue(r);
        const j = await (await pedir()).json();
        expect(j.sinAsignar.costo).toBe(1_000);
        expect(j.coberturaPct).toBe(90);
    });
});

describe("un leaderboard no se le muestra a un usuario acotado", () => {
    it("la ruta queda fuera del mapa de MEJ-38", async () => {
        // Comparar equipos es justamente ver los otros; su recorte es no verlos.
        const { rutaAdmiteAlcance } = await import("@/lib/scopeAwareRoutes");
        expect(rutaAdmiteAlcance("/api/intelligence/leaderboard", "GET")).toBe(false);
        expect(rutaAdmiteAlcance("/api/intelligence/leaderboard", "PUT")).toBe(false);
    });
});

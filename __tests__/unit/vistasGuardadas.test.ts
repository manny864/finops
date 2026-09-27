// @vitest-environment node
/**
 * MEJ-38 — vistas guardadas. La mitad de comodidad.
 *
 * Lo que se cuida acá es el criterio 4 —una compartida la ve todo el tenant,
 * una personal sólo su dueño— y que la comodidad no se convierta en permiso
 * por accidente: borrar algo de otro, o crear algo que todos ven, exige más
 * que pertenecer al tenant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { queryMock, conexionMock, rolMock, accesoMock, listarPerspectivasMock, AuthErrorFalsa } = vi.hoisted(() => {
    class AuthErrorFalsa extends Error { status: number; constructor(m: string, s = 403) { super(m); this.status = s; } }
    const conexionMock = {
        beginTransaction: vi.fn(async () => {}),
        query: vi.fn(async () => [[]]),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => {}),
        release: vi.fn(() => {}),
    };
    return {
        queryMock: vi.fn(async () => [[]]),
        conexionMock,
        rolMock: vi.fn(),
        accesoMock: vi.fn(),
        listarPerspectivasMock: vi.fn(async () => [{ id: 7, name: "Equipos" }]),
        AuthErrorFalsa,
    };
});

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: accesoMock,
    requireTenantRole: rolMock,
    AuthError: AuthErrorFalsa,
}));
vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock, getConnection: async () => conexionMock },
}));
vi.mock("@/services/perspectivesData.service", () => ({ listarPerspectivas: listarPerspectivasMock }));

import { GET, POST, DELETE } from "@/app/api/intelligence/views/route";

const ANA = { email: "ana@empresa.com", tenantId: "t1", claims: {}, isCorporateDomain: false };
const BETO = { email: "beto@empresa.com", tenantId: "t1", claims: {}, isCorporateDomain: false };

beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([[]]);
    conexionMock.query.mockReset().mockResolvedValue([[]]);
    conexionMock.beginTransaction.mockClear();
    conexionMock.commit.mockClear();
    conexionMock.rollback.mockClear();
    accesoMock.mockReset().mockResolvedValue(ANA);
    rolMock.mockReset().mockResolvedValue(ANA);
    listarPerspectivasMock.mockReset().mockResolvedValue([{ id: 7, name: "Equipos" }]);
});

describe("criterio 4 — quién ve qué", () => {
    it("la consulta pide las propias y las compartidas, y nada más", async () => {
        await GET(new NextRequest("http://localhost/api/intelligence/views?tenantId=t1"));
        const [sql, params] = queryMock.mock.calls[0] as any;
        expect(String(sql)).toContain("user_email IN (?, ?)");
        // El correo propio y la cadena vacía, que es como se guarda lo compartido.
        expect(params).toEqual(["t1", "ana@empresa.com", "", ""]);
    });

    it("una compartida se marca como tal y no se ofrece borrarla desde la lista", async () => {
        queryMock.mockResolvedValue([[
            { id: 1, name: "Mía", owner: "ana@empresa.com", perspectiveId: 7, groupName: "Datos", is_default: 0 },
            { id: 2, name: "De todos", owner: "", perspectiveId: 7, groupName: null, is_default: 0 },
        ]]);
        const j = await (await GET(new NextRequest("http://localhost/api/intelligence/views?tenantId=t1"))).json();

        expect(j.views[0]).toMatchObject({ name: "Mía", shared: false, canDelete: true });
        expect(j.views[1]).toMatchObject({ name: "De todos", shared: true, canDelete: false });
    });
});

describe("crear", () => {
    it("una vista personal alcanza con pertenecer al tenant", async () => {
        const r = await POST(new NextRequest("http://localhost/api/intelligence/views", {
            method: "POST", body: JSON.stringify({ tenantId: "t1", name: "Q3", perspectiveId: 7 }),
        }));
        expect(r.status).toBe(200);
        expect(accesoMock).toHaveBeenCalled();
        expect(rolMock).not.toHaveBeenCalled();
    });

    it("una compartida exige Admin/Owner, porque la ve —y la pierde— todo el tenant", async () => {
        rolMock.mockRejectedValue(new AuthErrorFalsa("Requiere rol Owner/Admin", 403));
        const r = await POST(new NextRequest("http://localhost/api/intelligence/views", {
            method: "POST", body: JSON.stringify({ tenantId: "t1", name: "Q3", shared: true }),
        }));
        expect(r.status).toBe(403);
    });

    it("una Perspective de otro tenant no resuelve", async () => {
        listarPerspectivasMock.mockResolvedValue([{ id: 7, name: "Equipos" }]);
        const r = await POST(new NextRequest("http://localhost/api/intelligence/views", {
            method: "POST", body: JSON.stringify({ tenantId: "t1", name: "Ajena", perspectiveId: 999 }),
        }));
        expect(r.status).toBe(404);
    });

    it("sin nombre no se guarda", async () => {
        const r = await POST(new NextRequest("http://localhost/api/intelligence/views", {
            method: "POST", body: JSON.stringify({ tenantId: "t1", name: "   " }),
        }));
        expect(r.status).toBe(400);
    });

    it("marcar una como predeterminada apaga las otras, en la MISMA transacción", async () => {
        await POST(new NextRequest("http://localhost/api/intelligence/views", {
            method: "POST", body: JSON.stringify({ tenantId: "t1", name: "Q3", perspectiveId: 7, isDefault: true }),
        }));
        const sqls = conexionMock.query.mock.calls.map(([s]) => String(s));
        expect(conexionMock.beginTransaction).toHaveBeenCalled();
        expect(sqls.some((s) => s.includes("SET is_default = 0"))).toBe(true);
        expect(conexionMock.commit).toHaveBeenCalled();
    });

    it("sin predeterminada no se toca el resto", async () => {
        await POST(new NextRequest("http://localhost/api/intelligence/views", {
            method: "POST", body: JSON.stringify({ tenantId: "t1", name: "Q3", perspectiveId: 7 }),
        }));
        expect(conexionMock.query.mock.calls.some(([s]) => String(s).includes("SET is_default = 0"))).toBe(false);
    });

    it("si la escritura falla, se deshace y no queda media vista", async () => {
        conexionMock.query.mockRejectedValueOnce(new Error("boom"));
        const r = await POST(new NextRequest("http://localhost/api/intelligence/views", {
            method: "POST", body: JSON.stringify({ tenantId: "t1", name: "Q3", perspectiveId: 7, isDefault: true }),
        }));
        expect(r.status).toBe(500);
        expect(conexionMock.rollback).toHaveBeenCalled();
        expect(conexionMock.commit).not.toHaveBeenCalled();
    });
});

describe("borrar", () => {
    it("la propia, sí", async () => {
        queryMock.mockResolvedValueOnce([[{ owner: "ana@empresa.com" }]]).mockResolvedValue([[]]);
        const r = await DELETE(new NextRequest("http://localhost/api/intelligence/views?tenantId=t1&id=1", { method: "DELETE" }));
        expect(r.status).toBe(200);
    });

    it("la de otro usuario, no", async () => {
        queryMock.mockResolvedValueOnce([[{ owner: "beto@empresa.com" }]]).mockResolvedValue([[]]);
        accesoMock.mockResolvedValue(ANA);
        const r = await DELETE(new NextRequest("http://localhost/api/intelligence/views?tenantId=t1&id=1", { method: "DELETE" }));
        expect(r.status).toBe(403);
    });

    it("una compartida exige rol", async () => {
        queryMock.mockResolvedValueOnce([[{ owner: "" }]]).mockResolvedValue([[]]);
        rolMock.mockRejectedValue(new AuthErrorFalsa("Requiere rol Owner/Admin", 403));
        const r = await DELETE(new NextRequest("http://localhost/api/intelligence/views?tenantId=t1&id=9", { method: "DELETE" }));
        expect(r.status).toBe(403);
    });

    it("un id que no existe igual pasa por el guard antes de contestar 404", async () => {
        // Sin el guard, el 404 le confirmaría a cualquiera qué ids hay en un
        // tenant que no es suyo.
        queryMock.mockResolvedValue([[]]);
        accesoMock.mockRejectedValue(new AuthErrorFalsa("No pertenece al tenant", 403));
        const r = await DELETE(new NextRequest("http://localhost/api/intelligence/views?tenantId=t1&id=123", { method: "DELETE" }));
        expect(r.status).toBe(403);
        expect(accesoMock).toHaveBeenCalled();
    });
});

describe("una vista no es un permiso", () => {
    it("la ruta no le responde a un usuario con alcance asignado", async () => {
        const { rutaAdmiteAlcance } = await import("@/lib/scopeAwareRoutes");
        for (const m of ["GET", "POST", "DELETE"]) {
            expect(rutaAdmiteAlcance("/api/intelligence/views", m)).toBe(false);
        }
    });
});

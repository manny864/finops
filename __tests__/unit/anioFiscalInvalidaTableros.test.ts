// @vitest-environment node
/**
 * MEJ-36 — cambiar el año fiscal tiene que verse ya. Tres tableros cortan sus
 * acumulados por él y los cachean (el Whiteboard, hasta 12 h): sin invalidar,
 * el cambio parecía no haberse guardado.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ query: vi.fn(), borrar: vi.fn(), borrarPatron: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({ default: { query: m.query } }));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantRole: vi.fn(async () => ({})),
    requireTenantAccess: vi.fn(async () => ({})),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/cache", () => ({
    invalidateCache: m.borrar,
    invalidateCachePattern: m.borrarPatron,
    costGroupsCacheKeys: (t: string) => [`cost-groups:v2:${t}:fy`],
}));

const put = (body: object) => new NextRequest(new URL("http://localhost/api/admin/tenant-settings"), {
    method: "PUT", body: JSON.stringify(body),
});

describe("PUT /api/admin/tenant-settings", () => {
    beforeEach(() => { vi.clearAllMocks(); m.query.mockResolvedValue([{}]); });

    it("cambiar el año fiscal invalida Grupos de Costos, Centros de Costo y el Whiteboard", async () => {
        const { PUT } = await import("@/app/api/admin/tenant-settings/route");
        const res = await PUT(put({ tenantId: "t1", fiscalYearStartMonth: 4 }));
        expect(res.status).toBe(200);
        expect(m.borrar).toHaveBeenCalledWith("cost-groups:v2:t1:fy", "cost-centers:v3:t1");
        expect(m.borrarPatron).toHaveBeenCalledWith("whiteboard:v5:azure:t1:*");
    });

    it("cambiar sólo la zona horaria no toca los cachés", async () => {
        const { PUT } = await import("@/app/api/admin/tenant-settings/route");
        await PUT(put({ tenantId: "t1", timezone: "America/Argentina/Buenos_Aires" }));
        expect(m.borrar).not.toHaveBeenCalled();
        expect(m.borrarPatron).not.toHaveBeenCalled();
    });

    it("un mes fuera de rango se rechaza y no invalida nada", async () => {
        const { PUT } = await import("@/app/api/admin/tenant-settings/route");
        const res = await PUT(put({ tenantId: "t1", fiscalYearStartMonth: 13 }));
        expect(res.status).toBe(400);
        expect(m.borrar).not.toHaveBeenCalled();
    });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const queryMock = vi.fn();
const roleMock = vi.fn(async () => ({ tenantId: "t1", email: "ana@x.com" }));
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ tenantId: "t1", email: "ana@x.com" })),
    requireTenantRole: (...a: unknown[]) => roleMock(...(a as [])),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo_tenant" }));
vi.mock("@/lib/notifications", () => ({ sendWebhookAlert: vi.fn() }));
const invalidateMock = vi.fn();
vi.mock("@/lib/cache", () => ({
    invalidateCache: (...a: unknown[]) => invalidateMock(...a),
    liveAnomaliesCacheKey: (t: string) => `anomalies:v4:${t}`,
}));

import { PATCH } from "@/app/api/intelligence/anomalies/route";

const req = (body: unknown) => new NextRequest("http://localhost/api/intelligence/anomalies", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    roleMock.mockReset().mockResolvedValue({ tenantId: "t1", email: "ana@x.com" });
    invalidateMock.mockReset();
});

describe("PATCH /api/intelligence/anomalies — MEJ-33", () => {
    // El bug que esto arregla: el dashboard cambiaba el estado sólo en el
    // useState del componente, así que se perdía al recargar y nadie más lo veía.
    it("persiste el estado y registra quién lo cambió", async () => {
        const res = await PATCH(req({ tenantId: "t1", anomalyId: 7, status: "Investigating" }));
        expect(res.status).toBe(200);

        const [sql, params] = queryMock.mock.calls[0];
        expect(String(sql)).toContain("UPDATE Anomalies");
        expect(String(sql)).toContain("status_changed_by");
        expect(params).toEqual(["Investigating", "ana@x.com", false, 7, "t1"]);
    });

    // De `resolved_at` sale el MTTR del panel: se fija al cerrar y se borra al reabrir.
    it("cerrar fija la fecha de cierre; reabrir o tomarla la borra", async () => {
        for (const [st, cierra] of [["Resolved", true], ["False Positive", true], ["New", false], ["Investigating", false]] as const) {
            queryMock.mockClear().mockResolvedValue([{ affectedRows: 1 }]);
            await PATCH(req({ tenantId: "t1", anomalyId: 7, status: st }));
            const [sql, params] = queryMock.mock.calls[0];
            expect(String(sql)).toContain("resolved_at = IF(?, NOW(), NULL)");
            expect(params[2], st).toBe(cierra);
        }
    });

    // Sin esto, el panel vuelve a mostrar el estado anterior al recargar
    // durante los 5 minutos del TTL.
    it("invalida el payload cacheado del panel, y sólo si guardó algo", async () => {
        await PATCH(req({ tenantId: "t1", anomalyId: 7, status: "Resolved" }));
        expect(invalidateMock).toHaveBeenCalledWith("anomalies:v4:t1");

        invalidateMock.mockClear();
        queryMock.mockResolvedValue([{ affectedRows: 0 }]);
        await PATCH(req({ tenantId: "t1", anomalyId: 999, status: "Resolved" }));
        expect(invalidateMock).not.toHaveBeenCalled();
    });

    // Sin el tenant en el WHERE, conocer el número de id alcanzaría para editar
    // la anomalía de otro cliente.
    it("filtra por tenant en el WHERE, no sólo al validar el acceso", async () => {
        await PATCH(req({ tenantId: "t1", anomalyId: 7, status: "Resolved" }));
        expect(String(queryMock.mock.calls[0][0])).toContain("AND tenant_id = ?");
    });

    it("rechaza un estado fuera del vocabulario", async () => {
        const res = await PATCH(req({ tenantId: "t1", anomalyId: 7, status: "Completed" }));
        expect(res.status).toBe(400);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("acepta los cuatro estados válidos", async () => {
        for (const st of ["New", "Investigating", "Resolved", "False Positive"]) {
            queryMock.mockClear().mockResolvedValue([{ affectedRows: 1 }]);
            const res = await PATCH(req({ tenantId: "t1", anomalyId: 7, status: st }));
            expect(res.status, st).toBe(200);
        }
    });

    // Cambiar el estado es decir "me hago cargo": un Reader no debería poder.
    it("exige un rol que pueda actuar sobre el gasto", async () => {
        await PATCH(req({ tenantId: "t1", anomalyId: 7, status: "Resolved" }));
        expect(roleMock).toHaveBeenCalledWith(expect.anything(), "t1", ["Admin", "Owner", "Colaborador"]);
    });

    it("un id que no existe para ese tenant da 404, no un success falso", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 0 }]);
        const res = await PATCH(req({ tenantId: "t1", anomalyId: 999, status: "Resolved" }));
        expect(res.status).toBe(404);
    });

    it("faltan parámetros -> 400 antes de tocar la base", async () => {
        const res = await PATCH(req({ status: "Resolved" }));
        expect(res.status).toBe(400);
        expect(queryMock).not.toHaveBeenCalled();
    });
});

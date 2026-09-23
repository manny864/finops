// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireTenantTier = vi.fn();
const requireTenantRole = vi.fn();
const queryMock = vi.fn();

// vi.mock se iza al tope del archivo, asi que la clase tiene que nacer dentro
// de vi.hoisted o la factory la lee antes de que exista.
const { AuthErrorMock } = vi.hoisted(() => ({
    AuthErrorMock: class AuthErrorMock extends Error {
        status: number;
        constructor(message: string, status = 403) {
            super(message);
            this.status = status;
        }
    },
}));

vi.mock("@/lib/requestAuth", () => ({
    AuthError: AuthErrorMock,
    requireTenantTier: (...a: unknown[]) => requireTenantTier(...a),
    requireTenantRole: (...a: unknown[]) => requireTenantRole(...a),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { PUT } from "@/app/api/governance/shift-left/gates/route";

const pedido = (cuerpo: unknown) =>
    new Request("https://x/api/governance/shift-left/gates", {
        method: "PUT",
        body: JSON.stringify(cuerpo),
        headers: { "Content-Type": "application/json" },
    }) as any;

const SQL = () => String(queryMock.mock.calls[0]?.[0] || "");

beforeEach(() => {
    requireTenantTier.mockReset().mockResolvedValue({ email: "a@b.c" });
    requireTenantRole.mockReset().mockResolvedValue({ email: "a@b.c" });
    queryMock.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
});

describe("PUT /api/governance/shift-left/gates", () => {
    it("guarda el umbral del repo", async () => {
        const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", threshold_usd: 250 }));
        expect(r.status).toBe(200);
        expect(await r.json()).toMatchObject({ ok: true, repository: "acme/infra", threshold_usd: 250 });
        expect(SQL()).toContain("ON DUPLICATE KEY UPDATE");
        expect(queryMock.mock.calls[0][1]).toEqual(["t1", "acme/infra", 250]);
    });

    it("un umbral vacío saca el gate en vez de guardar 0", async () => {
        // 0 es un umbral legítimo: "cualquier aumento bloquea". Confundirlo con
        // "sin gate" haría imposible configurar el más estricto de todos.
        const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", threshold_usd: "" }));
        expect(await r.json()).toMatchObject({ ok: true, threshold_usd: null });
        expect(SQL()).toContain("DELETE FROM IacBudgetGates");

        queryMock.mockClear();
        await PUT(pedido({ tenantId: "t1", repository: "acme/infra", threshold_usd: 0 }));
        expect(SQL()).toContain("ON DUPLICATE KEY UPDATE");
        expect(queryMock.mock.calls[0][1][2]).toBe(0);
    });

    it("rechaza umbrales imposibles sin tocar la base", async () => {
        for (const v of [-1, "no-es-un-numero", 10_000_001]) {
            queryMock.mockClear();
            const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", threshold_usd: v }));
            expect(r.status).toBe(400);
            expect(queryMock).not.toHaveBeenCalled();
        }
    });

    it("exige tier y rol antes de escribir", async () => {
        requireTenantRole.mockRejectedValue(new AuthErrorMock("requiere rol Admin/Owner", 403));
        const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", threshold_usd: 10 }));
        expect(r.status).toBe(403);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("el tier se chequea aunque el rol alcance", async () => {
        requireTenantTier.mockRejectedValue(new AuthErrorMock("Esta función requiere el plan Business o superior.", 403));
        const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", threshold_usd: 10 }));
        expect(r.status).toBe(403);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("sin repository no hay nada que configurar", async () => {
        const r = await PUT(pedido({ tenantId: "t1", threshold_usd: 10 }));
        expect(r.status).toBe(400);
        expect(queryMock).not.toHaveBeenCalled();
    });

    // La demo valida igual que producción y sólo se saltea la persistencia: si
    // aceptara lo que el producto rechaza, estaría mostrando otro producto.
    it("el tenant de demo no escribe, pero valida igual", async () => {
        const ok = await PUT(pedido({ tenantId: "demo", repository: "acme/infra", threshold_usd: 250 }));
        expect(await ok.json()).toMatchObject({ ok: true, mock: true, threshold_usd: 250 });
        expect(queryMock).not.toHaveBeenCalled();
        expect(requireTenantRole).not.toHaveBeenCalled();

        const mal = await PUT(pedido({ tenantId: "demo", repository: "acme/infra", threshold_usd: -5 }));
        expect(mal.status).toBe(400);
    });
});

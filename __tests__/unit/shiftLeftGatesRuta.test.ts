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
        expect(queryMock.mock.calls[0][1]).toEqual(["t1", "acme/infra", null, 250, null]);
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
        expect(queryMock.mock.calls[0][1][3]).toBe(0);
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
        requireTenantTier.mockRejectedValue(new AuthErrorMock("Esta función requiere el plan Enterprise.", 403));
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

    describe("presupuesto por repositorio", () => {
        const conCentro = () => queryMock.mockResolvedValueOnce([[{ 1: 1 }]]);

        it("guarda el centro de costos y el porcentaje cuando el centro tiene presupuesto", async () => {
            conCentro();
            const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", cost_center_name: " Plataforma ", threshold_pct_of_remaining: 40 }));
            expect(await r.json()).toMatchObject({ ok: true, cost_center_name: "Plataforma", threshold_pct_of_remaining: 40, threshold_usd: null });
            expect(String(queryMock.mock.calls[0][0])).toContain("CostCenterBudgets");
            expect(queryMock.mock.calls[1][1]).toEqual(["t1", "acme/infra", "Plataforma", null, 40]);
        });

        it("el centro solo, sin umbrales, es un gate de contexto: informa y no bloquea", async () => {
            conCentro();
            await PUT(pedido({ tenantId: "t1", repository: "acme/infra", cost_center_name: "Plataforma" }));
            expect(queryMock.mock.calls[1][1]).toEqual(["t1", "acme/infra", "Plataforma", null, null]);
        });

        it("rechaza un centro sin presupuesto cargado: el gate nunca se evaluaría", async () => {
            const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", cost_center_name: "Fantasma", threshold_pct_of_remaining: 40 }));
            expect(r.status).toBe(400);
            expect((await r.json()).error).toMatch(/presupuesto/);
            // Se consultó el centro, pero no se escribió nada.
            expect(queryMock).toHaveBeenCalledTimes(1);
        });

        it("el porcentaje necesita un centro: sin presupuesto no hay contra qué medirlo", async () => {
            const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", threshold_pct_of_remaining: 40 }));
            expect(r.status).toBe(400);
            expect(queryMock).not.toHaveBeenCalled();
        });

        it("acota el porcentaje", async () => {
            for (const v of [-1, 1001, "mucho"]) {
                queryMock.mockClear();
                const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", cost_center_name: "P", threshold_pct_of_remaining: v }));
                expect(r.status).toBe(400);
                expect(queryMock).not.toHaveBeenCalled();
            }
        });

        it("un porcentaje en 0 es válido: cualquier aumento bloquea", async () => {
            conCentro();
            const r = await PUT(pedido({ tenantId: "t1", repository: "acme/infra", cost_center_name: "P", threshold_pct_of_remaining: 0 }));
            expect(r.status).toBe(200);
            expect(queryMock.mock.calls[1][1][4]).toBe(0);
        });

        it("sin umbrales ni centro borra el gate; con sólo el monto en blanco y un centro, no", async () => {
            await PUT(pedido({ tenantId: "t1", repository: "acme/infra", threshold_usd: null, threshold_pct_of_remaining: "", cost_center_name: "" }));
            expect(SQL()).toContain("DELETE FROM IacBudgetGates");
        });

        it("el tenant de demo valida el porcentaje y no escribe", async () => {
            const ok = await PUT(pedido({ tenantId: "demo", repository: "acme/infra", cost_center_name: "P", threshold_pct_of_remaining: 30 }));
            expect(await ok.json()).toMatchObject({ ok: true, mock: true, threshold_pct_of_remaining: 30 });
            expect(queryMock).not.toHaveBeenCalled();
            const mal = await PUT(pedido({ tenantId: "demo", repository: "acme/infra", cost_center_name: "P", threshold_pct_of_remaining: 5000 }));
            expect(mal.status).toBe(400);
        });
    });
});

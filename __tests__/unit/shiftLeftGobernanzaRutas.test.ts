// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const requireTenantAccess = vi.fn();
const requireTenantTier = vi.fn();
const requireTenantRole = vi.fn();
const queryMock = vi.fn();

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
    requireTenantAccess: (...a: unknown[]) => requireTenantAccess(...a),
    requireTenantTier: (...a: unknown[]) => requireTenantTier(...a),
    requireTenantRole: (...a: unknown[]) => requireTenantRole(...a),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { GET as LISTA } from "@/app/api/governance/shift-left/route";
import { GET as DETALLE } from "@/app/api/governance/shift-left/[id]/route";
import { PUT as PRECIO } from "@/app/api/governance/shift-left/pricing/route";

const get = (url: string) => new NextRequest(url) as any;
const put = (cuerpo: unknown) =>
    new Request("https://x/api/governance/shift-left/pricing", {
        method: "PUT", body: JSON.stringify(cuerpo), headers: { "Content-Type": "application/json" },
    }) as any;

beforeEach(() => {
    requireTenantAccess.mockReset().mockResolvedValue({ email: "a@b.c" });
    requireTenantTier.mockReset().mockResolvedValue({});
    requireTenantRole.mockReset().mockResolvedValue({ email: "admin@x.com" });
    queryMock.mockReset();
});

describe("GET /api/governance/shift-left", () => {
    const base = (url = "https://x/api/governance/shift-left?tenantId=t1") => get(url);

    it("devuelve historial, gates con presupuesto, centros de costos y descuento", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            if (/FROM IacCostEstimations/.test(sql)) return [[
                { id: 5, repository: "a/b", pr_number: 1, author: "x", delta_cost_usd: "120.0000", gate_status: "EXCEEDED",
                  meta_json: { tool: "terraform", discount_pct: 10 }, created_at: "2026-10-08T10:00:00Z" },
                { id: 4, repository: "a/b", pr_number: 1, author: "x", delta_cost_usd: "-30.0000", gate_status: "OK",
                  meta_json: '{"tool":"tofu"}', created_at: "2026-10-07T10:00:00Z" },
                { id: 3, repository: "a/c", pr_number: null, author: null, delta_cost_usd: "5.0000", gate_status: "NOT_EVALUATED",
                  meta_json: "no es json", created_at: "2026-10-06T10:00:00Z" },
            ]];
            if (/FROM IacBudgetGates/.test(sql)) return [[{ repository: "a/b", cost_center_name: "Plataforma", threshold_usd: "500.0000", threshold_pct_of_remaining: "40.00" }]];
            if (/FROM CostCenterBudgets/.test(sql)) return [[{ cost_center_name: "Plataforma", monthly_budget_usd: "4000.00" }]];
            if (/FROM IacPricingSettings/.test(sql)) return [[{ discount_pct: "12.50" }]];
            return [[]];
        });
        const r = await LISTA(base());
        const j = await r.json();
        expect(j.items).toHaveLength(3);
        // meta_json no sale crudo: viaja ya parseado, con la forma que consume la pantalla.
        expect(j.items[0].meta).toEqual({ tool: "terraform", discount_pct: 10 });
        expect(j.items[1].meta).toEqual({ tool: "tofu" });
        expect(j.items[2].meta).toBeNull();
        expect(j.items[0]).not.toHaveProperty("meta_json");
        expect(j.gates[0]).toMatchObject({ cost_center_name: "Plataforma", threshold_pct_of_remaining: "40.00" });
        expect(j.costCenters).toEqual([{ cost_center_name: "Plataforma", monthly_budget_usd: "4000.00" }]);
        expect(j.pricing).toEqual({ discount_pct: 12.5 });
        // Los KPIs separan aumento y ahorro: netearlos escondería las dos cosas.
        expect(j.kpis).toEqual({ analizados: 3, aumentoDetectado: 125, ahorroDetectado: 30, bloqueados: 1 });
    });

    it("exige acceso al tenant y tier Enterprise", async () => {
        requireTenantTier.mockRejectedValue(new AuthErrorMock("Esta función requiere el plan Enterprise.", 403));
        queryMock.mockResolvedValue([[]]);
        const r = await LISTA(base());
        expect(r.status).toBe(403);
        expect(requireTenantAccess).toHaveBeenCalled();
        expect(requireTenantTier.mock.calls[0][2]).toBe("Enterprise");
    });

    it("el tenant de demo trae datos de ejemplo con presupuesto y sin tocar la base", async () => {
        const j = await (await LISTA(base("https://x/api/governance/shift-left?tenantId=demo"))).json();
        expect(j.mock).toBe(true);
        expect(j.items.length).toBeGreaterThan(2);
        expect(j.gates[0].cost_center_name).toBeTruthy();
        expect(j.costCenters.length).toBeGreaterThan(0);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("sin tenantId es un 400", async () => {
        expect((await LISTA(base("https://x/api/governance/shift-left"))).status).toBe(400);
    });
});

describe("GET /api/governance/shift-left/:id", () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const url = (t = "t1") => get(`https://x/api/governance/shift-left/7?tenantId=${t}`);

    it("devuelve el desglose por recurso de la estimación", async () => {
        queryMock.mockResolvedValue([[{
            id: 7, repository: "a/b", pr_number: 3, gate_status: "OK", created_at: "2026-10-08T10:00:00Z",
            detail_json: JSON.stringify([{ direccion: "azurerm_firewall.x", mensualDespues: 912.5 }]),
            meta_json: { tool: "terraform" },
        }]]);
        const j = await (await DETALLE(url(), ctx("7"))).json();
        expect(j.lines).toEqual([{ direccion: "azurerm_firewall.x", mensualDespues: 912.5 }]);
        expect(j.item.meta).toEqual({ tool: "terraform" });
        expect(j.item).not.toHaveProperty("detail_json");
    });

    it("filtra por tenant: pedir una estimación ajena es un 404, no un 403", async () => {
        queryMock.mockResolvedValue([[]]);
        const r = await DETALLE(url("otro"), ctx("7"));
        expect(r.status).toBe(404);
        expect(queryMock.mock.calls[0][1]).toEqual(["otro", 7]);
    });

    it("un detalle ilegible no rompe la pantalla", async () => {
        queryMock.mockResolvedValue([[{ id: 7, detail_json: "{roto", meta_json: null }]]);
        const j = await (await DETALLE(url(), ctx("7"))).json();
        expect(j.lines).toEqual([]);
    });

    it("rechaza ids que no son enteros positivos antes de consultar", async () => {
        for (const id of ["abc", "-1", "0", "1.5", "7; DROP TABLE x"]) {
            expect((await DETALLE(url(), ctx(id))).status).toBe(400);
        }
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("exige tier y acceso, y el demo no toca la base", async () => {
        requireTenantTier.mockRejectedValue(new AuthErrorMock("plan", 403));
        expect((await DETALLE(url(), ctx("7"))).status).toBe(403);

        const demo = await DETALLE(get("https://x/api/governance/shift-left/2?tenantId=demo"), ctx("2"));
        expect((await demo.json()).lines.length).toBeGreaterThan(2);
        expect((await DETALLE(get("https://x/api/governance/shift-left/999?tenantId=demo"), ctx("999"))).status).toBe(404);
    });
});

describe("PUT /api/governance/shift-left/pricing", () => {
    it("guarda el descuento del tenant", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 1 }]);
        const r = await PRECIO(put({ tenantId: "t1", discount_pct: 17.5 }));
        expect(await r.json()).toEqual({ ok: true, discount_pct: 17.5 });
        expect(String(queryMock.mock.calls[0][0])).toContain("ON DUPLICATE KEY UPDATE");
        expect(queryMock.mock.calls[0][1]).toEqual(["t1", 17.5, "admin@x.com"]);
    });

    it("redondea a dos decimales, como la columna", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 1 }]);
        const r = await PRECIO(put({ tenantId: "t1", discount_pct: 12.3456 }));
        expect((await r.json()).discount_pct).toBe(12.35);
    });

    it("0 o vacío borra la fila: sin fila significa sin descuento", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 1 }]);
        for (const v of [0, "", null, undefined, "0"]) {
            queryMock.mockClear();
            const r = await PRECIO(put({ tenantId: "t1", discount_pct: v }));
            expect(await r.json()).toEqual({ ok: true, discount_pct: 0 });
            expect(String(queryMock.mock.calls[0][0])).toContain("DELETE FROM IacPricingSettings");
        }
    });

    it("rechaza lo imposible sin tocar la base: más de 100 daría un costo negativo", async () => {
        // (NaN no viaja en JSON: se serializa como null, que es "sin descuento".)
        for (const v of [-1, 100.01, "mucho", 150]) {
            queryMock.mockClear();
            const r = await PRECIO(put({ tenantId: "t1", discount_pct: v }));
            expect(r.status).toBe(400);
            expect(queryMock).not.toHaveBeenCalled();
        }
    });

    it("acepta el 100%: un contrato que lo cubre todo", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 1 }]);
        expect((await PRECIO(put({ tenantId: "t1", discount_pct: 100 }))).status).toBe(200);
    });

    it("exige tier y rol antes de escribir", async () => {
        requireTenantRole.mockRejectedValue(new AuthErrorMock("requiere rol Admin/Owner", 403));
        expect((await PRECIO(put({ tenantId: "t1", discount_pct: 10 }))).status).toBe(403);
        expect(queryMock).not.toHaveBeenCalled();

        requireTenantRole.mockResolvedValue({});
        requireTenantTier.mockRejectedValue(new AuthErrorMock("plan", 403));
        expect((await PRECIO(put({ tenantId: "t1", discount_pct: 10 }))).status).toBe(403);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("sin tenantId es un 400, y el tenant de demo valida pero no escribe", async () => {
        expect((await PRECIO(put({ discount_pct: 10 }))).status).toBe(400);
        const ok = await PRECIO(put({ tenantId: "demo", discount_pct: 10 }));
        expect(await ok.json()).toEqual({ ok: true, mock: true, discount_pct: 10 });
        expect((await PRECIO(put({ tenantId: "demo", discount_pct: 500 }))).status).toBe(400);
        expect(queryMock).not.toHaveBeenCalled();
    });
});

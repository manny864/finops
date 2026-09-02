// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantRole: vi.fn(async () => ({ tenantId: "t1", email: "admin@x.com" })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/paddleTierMap", () => ({ getPaddleBaseUrl: () => "https://sandbox-api.paddle.com" }));

import { POST } from "@/app/api/billing/addons/capacity/route";

const TENANT_PRICE = "pri_tenant";
const req = (body: unknown) => new NextRequest("http://localhost/api/billing/addons/capacity", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
    queryMock.mockReset();
    process.env.PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL = TENANT_PRICE;
    process.env.PADDLE_API_KEY = "key";
    vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
    delete process.env.PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL;
    delete process.env.PADDLE_API_KEY;
    vi.unstubAllGlobals();
});

describe("POST /api/billing/addons/capacity", () => {
    // EL RIESGO CENTRAL: el PATCH de Paddle REEMPLAZA la lista de ítems.
    // Mandar sólo el add-on borraría el plan del cliente.
    it("conserva los ítems del plan al agregar el add-on", async () => {
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: "sub_1", tier: "Professional" }]]);
        (global.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { items: [
                { price: { id: "pri_plan_business" }, quantity: 1 },
            ] } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) });

        const res = await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: 2 }));
        expect(res.status).toBe(200);

        const patchBody = JSON.parse((global.fetch as any).mock.calls[1][1].body);
        expect(patchBody.items).toEqual([
            { price_id: "pri_plan_business", quantity: 1 },
            { price_id: TENANT_PRICE, quantity: 2 },
        ]);
    });

    it("cantidad 0 saca el add-on pero deja el plan", async () => {
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: "sub_1", tier: "Professional" }]]);
        (global.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { items: [
                { price: { id: "pri_plan_business" }, quantity: 1 },
                { price: { id: TENANT_PRICE }, quantity: 3 },
            ] } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) });

        await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: 0 }));
        const patchBody = JSON.parse((global.fetch as any).mock.calls[1][1].body);
        expect(patchBody.items).toEqual([{ price_id: "pri_plan_business", quantity: 1 }]);
    });

    it("cambiar la cantidad no duplica el ítem", async () => {
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: "sub_1", tier: "Professional" }]]);
        (global.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { items: [
                { price: { id: TENANT_PRICE }, quantity: 1 },
            ] } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) });

        await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: 5 }));
        const patchBody = JSON.parse((global.fetch as any).mock.calls[1][1].body);
        expect(patchBody.items).toHaveLength(1);
        expect(patchBody.items[0].quantity).toBe(5);
    });

    // Antes la ruta de tenants respondía `canAddDirectly: true` sin config, o
    // sea REGALABA la capacidad ante un error de entorno.
    it("sin PADDLE_API_KEY corta con 503, no habilita nada gratis", async () => {
        delete process.env.PADDLE_API_KEY;
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: "sub_1", tier: "Professional" }]]);
        const res = await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: 1 }));
        expect(res.status).toBe(503);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("sin suscripción de Paddle no hay a qué agregarle el ítem", async () => {
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: null, tier: "Professional" }]]);
        const res = await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: 1 }));
        expect(res.status).toBe(409);
    });

    it("rechaza cantidades absurdas antes de llamar a Paddle", async () => {
        for (const q of [-1, 1.5, 999]) {
            queryMock.mockReset();
            const res = await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: q }));
            expect(res.status).toBe(400);
        }
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("un add-on sin price ID configurado no se puede contratar en línea", async () => {
        // Sólo está configurado el de tenant; el de suscripción no.
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: "sub_1", tier: "Professional" }]]);
        const res = await POST(req({ tenantId: "t1", addonType: "additional_subscription_slot", quantity: 1 }));
        expect(res.status).toBe(409);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    // Cobrar el precio de Business a un Professional sería facturar mal.
    it("usa el price ID del TIER del tenant, no uno cualquiera", async () => {
        process.env.PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS = "pri_tenant_business";
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: "sub_1", tier: "Business" }]]);
        (global.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { items: [] } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) });

        await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: 1 }));
        const body = JSON.parse((global.fetch as any).mock.calls[1][1].body);
        expect(body.items[0].price_id).toBe("pri_tenant_business");
        delete process.env.PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS;
    });

    // Un tenant que cambió de plan arrastra el precio del tier anterior; si no
    // se limpiara, quedarían dos ítems del mismo add-on cobrándose los dos.
    it("reemplaza el precio del tier anterior en vez de duplicar el add-on", async () => {
        process.env.PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS = "pri_tenant_business";
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: "sub_1", tier: "Business" }]]);
        (global.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { items: [
                { price: { id: "pri_plan" }, quantity: 1 },
                { price: { id: TENANT_PRICE }, quantity: 2 }, // precio de Professional, del plan viejo
            ] } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) });

        await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: 3 }));
        const body = JSON.parse((global.fetch as any).mock.calls[1][1].body);
        expect(body.items).toEqual([
            { price_id: "pri_plan", quantity: 1 },
            { price_id: "pri_tenant_business", quantity: 3 },
        ]);
        delete process.env.PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS;
    });

    it("si Paddle rechaza el PATCH devuelve 502 y no dice que salió bien", async () => {
        queryMock.mockResolvedValueOnce([[{ paddle_subscription_id: "sub_1", tier: "Professional" }]]);
        (global.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { items: [] } }) })
            .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { detail: "nope" } }) });
        const res = await POST(req({ tenantId: "t1", addonType: "additional_tenant_slot", quantity: 1 }));
        expect(res.status).toBe(502);
    });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { resolveAddonQuantities, applyAddonCapacity, getAddonPriceIdMap } from "@/lib/paddleAddons";

const TENANT_PRICE = "pri_tenant_slot";
const SUB_PRICE = "pri_sub_slot";

beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([{}]);
    process.env.PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL = TENANT_PRICE;
    process.env.PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_PROFESSIONAL = SUB_PRICE;
});
afterEach(() => {
    delete process.env.PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL;
    delete process.env.PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_PROFESSIONAL;
});

describe("resolveAddonQuantities", () => {
    it("lee la cantidad de cada add-on desde los ítems", () => {
        const q = resolveAddonQuantities([
            { price: { id: "pri_plan_business" }, quantity: 1 },
            { price: { id: TENANT_PRICE }, quantity: 2 },
            { price: { id: SUB_PRICE }, quantity: 5 },
        ]);
        expect(q.additional_tenant_slot).toBe(2);
        expect(q.additional_subscription_slot).toBe(5);
    });

    // EL CASO QUE ROMPE EL PLAN ORIGINAL DE MEJ-15: proponía sumar +1 en
    // `transaction.completed`, que dispara en CADA renovación mensual. Leyendo
    // la cantidad vigente, procesar el mismo evento diez veces da siempre 2.
    it("es idempotente: reprocesar el mismo evento no acumula", () => {
        const items = [{ price: { id: TENANT_PRICE }, quantity: 2 }];
        for (let i = 0; i < 10; i++) {
            expect(resolveAddonQuantities(items).additional_tenant_slot).toBe(2);
        }
    });

    // Sin este 0 explícito, dar de baja el add-on dejaría la capacidad pagada
    // para siempre.
    it("un add-on ausente de los ítems da 0, para que la baja devuelva la capacidad", () => {
        const q = resolveAddonQuantities([{ price: { id: "pri_plan_business" }, quantity: 1 }]);
        expect(q.additional_tenant_slot).toBe(0);
        expect(q.additional_subscription_slot).toBe(0);
    });

    it("acepta price_id plano además de price.id", () => {
        expect(resolveAddonQuantities([{ price_id: SUB_PRICE, quantity: 3 }]).additional_subscription_slot).toBe(3);
    });

    it("ignora cantidades inválidas en vez de escribir NaN", () => {
        const q = resolveAddonQuantities([
            { price: { id: SUB_PRICE }, quantity: "tres" },
            { price: { id: TENANT_PRICE }, quantity: -4 },
        ]);
        expect(q.additional_subscription_slot).toBe(0);
        expect(q.additional_tenant_slot).toBe(0);
    });

    it("no rompe si el payload no trae ítems", () => {
        expect(resolveAddonQuantities(undefined).additional_tenant_slot).toBe(0);
        expect(resolveAddonQuantities(null).additional_subscription_slot).toBe(0);
    });

    it("sin price IDs configurados no reconoce ningún add-on", () => {
        delete process.env.PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL;
        delete process.env.PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_PROFESSIONAL;
        expect(getAddonPriceIdMap()).toEqual({});
        expect(resolveAddonQuantities([{ price: { id: TENANT_PRICE }, quantity: 9 }]).additional_tenant_slot).toBe(0);
    });
});

describe("applyAddonCapacity", () => {
    it("fija ambas capacidades", async () => {
        const ok = await applyAddonCapacity("t1", { additional_tenant_slot: 2, additional_subscription_slot: 5 });
        expect(ok).toBe(true);
        expect(String(queryMock.mock.calls[0][0])).toContain("additional_tenant_slots = ?");
        expect(queryMock.mock.calls[0][1]).toEqual([2, "t1"]);
        expect(String(queryMock.mock.calls[1][0])).toContain("purchased_subscription_slots");
        expect(queryMock.mock.calls[1][1]).toEqual(["t1", 5]);
    });

    // Sin add-ons dados de alta en Paddle, un webhook cualquiera pisaría con 0
    // la capacidad que un comercial cargó a mano.
    it("no toca nada si no hay price IDs configurados", async () => {
        delete process.env.PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL;
        delete process.env.PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_PROFESSIONAL;
        const ok = await applyAddonCapacity("t1", { additional_tenant_slot: 0, additional_subscription_slot: 0 });
        expect(ok).toBe(false);
        expect(queryMock).not.toHaveBeenCalled();
    });
});

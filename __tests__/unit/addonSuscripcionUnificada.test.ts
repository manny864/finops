import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV = {
    PADDLE_PRICE_SUB_MONTHLY: "pri_unificado",
    PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_PROFESSIONAL: "pri_legacy_prof",
    PADDLE_ADDON_SUBSCRIPTION_PRICE_ID_BUSINESS: "pri_legacy_bus",
    PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL: "pri_tenant_prof",
    PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS: "pri_tenant_bus",
};

describe("suscripcion adicional: un solo producto para vender, todos para acreditar", () => {
    beforeEach(() => { for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v); });
    afterEach(() => vi.unstubAllEnvs());

    it("una compra nueva cobra el producto unificado, no el del tier", async () => {
        const { getAddonPriceIdForTier } = await import("@/lib/paddleAddons");
        for (const tier of ["Professional", "Business"]) {
            expect(getAddonPriceIdForTier("additional_subscription_slot", tier)).toBe("pri_unificado");
        }
    });

    it("el tenant adicional sigue cobrandose por tier", async () => {
        const { getAddonPriceIdForTier } = await import("@/lib/paddleAddons");
        expect(getAddonPriceIdForTier("additional_tenant_slot", "Professional")).toBe("pri_tenant_prof");
        expect(getAddonPriceIdForTier("additional_tenant_slot", "Business")).toBe("pri_tenant_bus");
    });

    it("los price IDs viejos siguen acreditando capacidad ya comprada", async () => {
        const { getAddonPriceIdMap, resolveAddonQuantities } = await import("@/lib/paddleAddons");
        const map = getAddonPriceIdMap();
        // Si alguno de estos se cayera del mapa, el webhook fijaria la capacidad
        // en 0 para quien lo tiene contratado: le saca lo que esta pagando.
        expect(map["pri_legacy_prof"]).toBe("additional_subscription_slot");
        expect(map["pri_legacy_bus"]).toBe("additional_subscription_slot");
        expect(map["pri_unificado"]).toBe("additional_subscription_slot");

        const items = [{ price: { id: "pri_legacy_prof" }, quantity: 3 }];
        expect(resolveAddonQuantities(items).additional_subscription_slot).toBe(3);
    });

    it("un tenant con el producto viejo y el nuevo suma los dos", async () => {
        const { resolveAddonQuantities } = await import("@/lib/paddleAddons");
        const items = [
            { price: { id: "pri_legacy_bus" }, quantity: 2 },
            { price: { id: "pri_unificado" }, quantity: 1 },
        ];
        expect(resolveAddonQuantities(items).additional_subscription_slot).toBe(3);
    });
});

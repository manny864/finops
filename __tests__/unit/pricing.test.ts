// @vitest-environment node
import { describe, it, expect } from "vitest";
import { TIER_BASE_PRICE_USD, ADDON_PRICE_USD, getAddonPrice } from "@/lib/pricing";
import { SUBSCRIPTION_LIMITS, USER_LIMITS } from "@/lib/tierLogic";

describe("catálogo de precios", () => {
    it("los precios de lista vigentes", () => {
        expect(TIER_BASE_PRICE_USD.Professional).toBe(299);
        expect(TIER_BASE_PRICE_USD.Business).toBe(999);
        expect(TIER_BASE_PRICE_USD.Enterprise).toBeNull(); // a convenir
    });

    // Business cuesta MÁS por suscripción incluida que Professional ($333 vs
    // $149.50) y es deliberado: se paga por capacidades, no por volumen. Por
    // eso NO se testea que el tier caro sea más barato por unidad — sería
    // imponer un modelo de precio que este producto no usa.
    //
    // Lo que sí tiene que cumplirse: ampliar capacidad con el add-on tiene que
    // salir MÁS BARATO que lo que cuesta una suscripción incluida en el plan.
    // Si se invirtiera, comprar extras sería peor negocio que el plan base y
    // el add-on quedaría muerto.
    it("la suscripción extra es más barata que una incluida en el plan", () => {
        for (const tier of ["Professional", "Business"]) {
            const incluida = TIER_BASE_PRICE_USD[tier]! / SUBSCRIPTION_LIMITS[tier];
            expect(ADDON_PRICE_USD.extraSubscription[tier]!).toBeLessThan(incluida);
        }
    });

    it("Business incluye 3 suscripciones y 5 usuarios", () => {
        expect(SUBSCRIPTION_LIMITS.Business).toBe(3);
        expect(USER_LIMITS.Business).toBe(5);
    });

    it("Enterprise sigue sin tope", () => {
        expect(SUBSCRIPTION_LIMITS.Enterprise).toBe(Infinity);
        expect(USER_LIMITS.Enterprise).toBe(Infinity);
    });
});

describe("add-ons", () => {
    it("el tenant extra cuesta ~30% del plan base, no un monto plano", () => {
        for (const tier of ["Professional", "Business"]) {
            const ratio = ADDON_PRICE_USD.extraTenant[tier]! / TIER_BASE_PRICE_USD[tier]!;
            expect(ratio).toBeGreaterThan(0.22);
            expect(ratio).toBeLessThan(0.32);
        }
    });

    // Si el add-on costara más que el salto de tier, nadie lo compraría y el
    // cliente se iría al upgrade (o a la competencia).
    it("sumar una suscripción suelta es más barato que saltar de tier", () => {
        const saltoDeTier = TIER_BASE_PRICE_USD.Business! - TIER_BASE_PRICE_USD.Professional!;
        expect(ADDON_PRICE_USD.extraSubscription.Professional!).toBeLessThan(saltoDeTier);
    });

    it("el add-on baja de precio en el tier más alto (descuento por volumen)", () => {
        expect(ADDON_PRICE_USD.extraSubscription.Business!).toBeLessThan(ADDON_PRICE_USD.extraSubscription.Professional!);
        expect(ADDON_PRICE_USD.extraUser.Business!).toBeLessThan(ADDON_PRICE_USD.extraUser.Professional!);
    });

    // Enterprise se negocia por contrato: una factura por unidad lo vuelve
    // impredecible, que es lo que ese comprador rechaza.
    it("Enterprise no tiene precio por unidad de capacidad", () => {
        expect(getAddonPrice("extraSubscription", "Enterprise")).toBeNull();
        expect(getAddonPrice("extraTenant", "Enterprise")).toBeNull();
        expect(getAddonPrice("extraUser", "Enterprise")).toBeNull();
    });

    it("soporte y retención vienen incluidos en Enterprise", () => {
        expect(getAddonPrice("prioritySupport", "Enterprise")).toBe(0);
        expect(getAddonPrice("extendedRetention", "Enterprise")).toBe(0);
    });

    it("un add-on inexistente devuelve null en vez de undefined", () => {
        expect(getAddonPrice("noExiste", "Business")).toBeNull();
    });
});

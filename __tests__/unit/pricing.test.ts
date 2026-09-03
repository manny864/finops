// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
    TIER_BASE_PRICE_USD,
    TIER_ANNUAL_PRICE_USD,
    ADDON_PRICE_USD,
    getAddonPrice,
    getAnnualMonthlyEquivalent,
    getAnnualDiscountPercent,
} from "@/lib/pricing";
import { SUBSCRIPTION_LIMITS, USER_LIMITS } from "@/lib/tierLogic";

describe("catálogo de precios", () => {
    // Los números son los de la oferta de Paddle, que es quien cobra. El
    // catálogo decía 299/999 mientras Paddle cobraba 299.99/999.99 y la página
    // de precios mostraba lo de Paddle: el catálogo era el que discrepaba.
    it("los precios de lista coinciden con lo que cobra Paddle", () => {
        expect(TIER_BASE_PRICE_USD.Professional).toBe(299.99);
        expect(TIER_BASE_PRICE_USD.Business).toBe(999.99);
        expect(TIER_BASE_PRICE_USD.Enterprise).toBeNull(); // a convenir

        expect(TIER_ANNUAL_PRICE_USD.Professional).toBe(3167.88);
        expect(TIER_ANNUAL_PRICE_USD.Business).toBe(10559.88);
        expect(TIER_ANNUAL_PRICE_USD.Enterprise).toBeNull();
    });

    /**
     * El equivalente mensual es lo que se MUESTRA en la tarjeta del plan
     * anual, y su ×12 tiene que dar exactamente lo que Paddle cobra. Si no
     * cerrara, el cliente vería un número y le cobrarían otro a un click de
     * distancia.
     *
     * Este test es el que faltaba: la página calculaba `mensual * 0.88` y daba
     * el número correcto sólo porque el redondeo a dos decimales coincidía con
     * la oferta de Paddle. Nada verificaba esa coincidencia.
     */
    it("el equivalente mensual del plan anual cierra exacto contra Paddle", () => {
        for (const tier of ["Professional", "Business"]) {
            const equiv = getAnnualMonthlyEquivalent(tier)!;
            expect(Number((equiv * 12).toFixed(2))).toBe(TIER_ANNUAL_PRICE_USD[tier]);
        }
        expect(getAnnualMonthlyEquivalent("Enterprise")).toBeNull();
    });

    it("el descuento anual se deriva de los precios y da 12%", () => {
        expect(getAnnualDiscountPercent("Professional")).toBe(12);
        expect(getAnnualDiscountPercent("Business")).toBe(12);
        expect(getAnnualDiscountPercent("Enterprise")).toBeNull();
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

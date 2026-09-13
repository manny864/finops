import { describe, it, expect } from "vitest";
import { ADDON_CATALOG, isAddonVisibleForTier } from "@/lib/addonCatalog";

const modulos = Object.values(ADDON_CATALOG).filter((a) => a.key.startsWith("mod_"));
const visibles = (tier: string) =>
    Object.values(ADDON_CATALOG).filter((a) => isAddonVisibleForTier(a, tier)).map((a) => a.key);

describe("modulos del marketplace", () => {
    it("los 19 modulos estan en el catalogo con ruta y escalera completa", () => {
        expect(modulos).toHaveLength(19);
        for (const m of modulos) {
            expect(m.route, m.key).toMatch(/^\//);
            expect(["Business", "Enterprise"]).toContain(m.requiredTierFallback);
            for (const d of ["monthly", "pass1m", "pass3m", "pass6m", "pass9m", "pass12m"] as const) {
                expect(m.basePriceUSD[d], `${m.key}.${d}`).toBeGreaterThan(0);
            }
        }
    });

    it("un modulo sin price ID mensual no se ofrece a nadie", () => {
        // Azure Integration Services todavia no tiene productos en Paddle.
        expect(ADDON_CATALOG.mod_integration.prices.monthly).toBe("");
        for (const tier of ["Professional", "Business", "Enterprise"]) {
            expect(visibles(tier)).not.toContain("mod_integration");
        }
    });

    it("Business no ve los modulos que su plan ya incluye, pero si los de Enterprise", () => {
        const v = visibles("Business");
        expect(v).not.toContain("mod_databases");   // requiere Business: ya lo tiene
        expect(v).not.toContain("mod_approvals");   // idem
        expect(v).toContain("mod_azure_ai");        // requiere Enterprise: le falta
        expect(v).toContain("mod_policies");
    });

    it("Professional ve modulos de las dos clases", () => {
        const v = visibles("Professional");
        expect(v).toContain("mod_databases");
        expect(v).toContain("mod_azure_ai");
    });

    it("Enterprise no ve ningun modulo ni add-on de cuota", () => {
        const v = visibles("Enterprise");
        expect(v.filter((k) => k.startsWith("mod_"))).toHaveLength(0);
        expect(v).not.toContain("quota_subscriptions");
        expect(v).not.toContain("quota_user_seats");
    });

    it("las cuotas se siguen ofreciendo a Business aunque el plan las incluya", () => {
        expect(visibles("Business")).toContain("quota_subscriptions");
    });
});

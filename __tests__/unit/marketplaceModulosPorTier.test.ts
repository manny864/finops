import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ADDON_CATALOG, isAddonVisibleForTier, resolveAddonForTier } from "@/lib/addonCatalog";

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

    it("todos los modulos tienen sus 6 price IDs cargados", () => {
        for (const m of modulos) {
            for (const d of ["monthly", "pass1m", "pass3m", "pass6m", "pass9m", "pass12m"] as const) {
                expect(m.prices[d], `${m.key}.${d}`).toMatch(/^pri_[a-z0-9]{26}$/);
            }
        }
    });

    it("un modulo sin price ID mensual no se ofreceria a nadie", () => {
        // Se prueba la REGLA con un item sintetico y no con un modulo real:
        // atarlo a uno concreto hace que el test se caiga solo el dia que ese
        // modulo recibe su price ID, que es justo cuando todo esta bien.
        const sinPrecio = { ...ADDON_CATALOG.mod_databases, prices: { ...ADDON_CATALOG.mod_databases.prices, monthly: "" } };
        for (const tier of ["Professional", "Business", "Enterprise"]) {
            expect(isAddonVisibleForTier(sinPrecio, tier)).toBe(false);
        }
    });

    it("Computo y Bases de Datos usan la escalera de $129", () => {
        for (const k of ["mod_compute", "mod_databases"]) {
            expect(ADDON_CATALOG[k].basePriceUSD).toMatchObject({
                monthly: 129, pass3m: 341, pass6m: 627, pass9m: 871, pass12m: 1099,
            });
        }
    });

    it("comprar todos los modulos Business sale mas caro que subir a Business", () => {
        // La cerca que sostiene el escalon de precio: si juntar los modulos
        // sueltos saliera menos que el upgrade, el plan Business no se vende.
        const suelto = modulos
            .filter((m) => m.requiredTierFallback === "Business")
            .reduce((a, m) => a + m.basePriceUSD.monthly, 0);
        expect(suelto).toBeGreaterThan(999.99 - 299.99);
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

describe("tenant adicional", () => {
    // El catalogo lee process.env al importarse, asi que hay que stubear ANTES
    // y reimportar. Sin esto el test mide como esta configurado el ambiente que
    // lo corre, no la logica.
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv("PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL", "pri_tenant_prof");
        vi.stubEnv("PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS", "pri_tenant_bus");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("resuelve price ID y precio segun el tier", async () => {
        const { ADDON_CATALOG: cat, resolveAddonForTier: resolve } = await import("@/lib/addonCatalog");
        const prof = resolve(cat.quota_tenant, "Professional");
        const bus = resolve(cat.quota_tenant, "Business");
        expect(prof.basePriceUSD.monthly).toBe(90);
        expect(bus.basePriceUSD.monthly).toBe(240);
        expect(prof.prices.monthly).toBe("pri_tenant_prof");
        expect(bus.prices.monthly).toBe("pri_tenant_bus");
    });

    it("NO se cobra por el checkout del marketplace", async () => {
        // Abrir el checkout crearia una segunda suscripcion y el webhook, que
        // FIJA la capacidad desde los items, la pondria en cero en la proxima
        // actualizacion de la principal.
        const { ADDON_CATALOG: cat } = await import("@/lib/addonCatalog");
        expect(cat.quota_tenant.fulfilledBy).toBe("capacity");
        expect(cat.quota_tenant.fulfillmentHref).toBeTruthy();
    });

    it("lo ven Professional y Business, no Enterprise", async () => {
        const { ADDON_CATALOG: cat, resolveAddonForTier: resolve, isAddonVisibleForTier: visible } =
            await import("@/lib/addonCatalog");
        const ve = (t: string) => visible(resolve(cat.quota_tenant, t), t);
        expect(ve("Professional")).toBe(true);
        expect(ve("Business")).toBe(true);
        expect(ve("Enterprise")).toBe(false);
    });

    it("sin price ID configurado no se muestra en ningun tier", async () => {
        vi.stubEnv("PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL", "");
        vi.stubEnv("PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS", "");
        vi.resetModules();
        const { ADDON_CATALOG: cat, resolveAddonForTier: resolve, isAddonVisibleForTier: visible } =
            await import("@/lib/addonCatalog");
        for (const t of ["Professional", "Business"]) {
            expect(visible(resolve(cat.quota_tenant, t), t)).toBe(false);
        }
    });
});

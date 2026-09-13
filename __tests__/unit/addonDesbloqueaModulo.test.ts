import { describe, it, expect } from "vitest";
import { addonUnlocksPath, ADDON_CATALOG } from "@/lib/addonCatalog";

describe("un add-on de modulo habilita todos sus componentes", () => {
    it("habilita la ruta raiz del modulo", () => {
        expect(addonUnlocksPath(["mod_databases"], "/intelligence/bases-de-datos")).toBe(true);
    });

    it("habilita las sub-rutas sin enumerarlas", () => {
        for (const sub of ["/intelligence/bases-de-datos/cosmos-db", "/intelligence/bases-de-datos/sql/detalle"]) {
            expect(addonUnlocksPath(["mod_databases"], sub), sub).toBe(true);
        }
    });

    it("funciona con el prefijo de locale", () => {
        expect(addonUnlocksPath(["mod_databases"], "/es/intelligence/bases-de-datos/cosmos-db")).toBe(true);
        expect(addonUnlocksPath(["mod_databases"], "/pt-BR/intelligence/bases-de-datos")).toBe(true);
    });

    it("no habilita rutas de otro modulo", () => {
        expect(addonUnlocksPath(["mod_databases"], "/intelligence/computo")).toBe(false);
        expect(addonUnlocksPath([], "/intelligence/bases-de-datos")).toBe(false);
    });

    it("compara por segmento, no por texto suelto", () => {
        // /governance/policies no puede habilitar /governance/policies-draft
        expect(addonUnlocksPath(["mod_policies"], "/governance/policies-draft")).toBe(false);
        expect(addonUnlocksPath(["mod_policies"], "/governance/policies")).toBe(true);
    });

    it("los add-ons sin ruta (cuotas, features viejos) no habilitan nada", () => {
        expect(ADDON_CATALOG.quota_subscriptions.route).toBeUndefined();
        expect(addonUnlocksPath(["quota_subscriptions"], "/intelligence/bases-de-datos")).toBe(false);
    });

    it("tolera barras finales y query string", () => {
        expect(addonUnlocksPath(["mod_ttl"], "/cleanup/ttl/")).toBe(true);
        expect(addonUnlocksPath(["mod_ttl"], "/cleanup/ttl?vista=tabla")).toBe(true);
    });
});

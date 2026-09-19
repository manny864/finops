// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { canDeleteResources, canRemediateTags, getDeleteRemediationTier, getTagRemediationTier } from "@/lib/tierLogic";

/**
 * Los carteles del candado de tier decian "requiere Enterprise" para dos
 * acciones que habilitan desde Business. A un cliente Business se le ofrecia
 * comprar algo que YA tenia, y a uno Professional se le pedia un plan de mas
 * que el necesario. El plan estaba escrito a mano en el texto, sin nada que lo
 * atara al chequeo que decide la compuerta.
 */
describe("el cartel nombra el mismo plan que exige el chequeo", () => {
    it("borrar zombis habilita desde el tier que declara tierLogic", () => {
        const requerido = getDeleteRemediationTier("zombies");
        expect(canDeleteResources(requerido, "zombies")).toBe(true);
        // Y el inmediatamente inferior no alcanza.
        expect(canDeleteResources("Professional", "zombies")).toBe(false);
    });

    it("etiquetar habilita desde el tier que declara tierLogic", () => {
        expect(canRemediateTags(getTagRemediationTier())).toBe(true);
        expect(canRemediateTags("Professional")).toBe(false);
    });

    it("hoy ese tier es Business, no Enterprise", () => {
        // Si esto cambia a proposito, actualizar tambien la expectativa: lo que
        // no puede pasar es que cambie el chequeo y el cartel siga diciendo otra
        // cosa, que es exactamente lo que habia.
        expect(getDeleteRemediationTier("zombies")).toBe("Business");
        expect(getTagRemediationTier()).toBe("Business");
    });
});

describe("la tabla de zombis no escribe el plan a mano", () => {
    const tabla = readFileSync(join(__dirname, "..", "..", "src/components/ZombieResourcesTable.tsx"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

    it("el tier sale de tierLogic", () => {
        expect(tabla).toContain('getDeleteRemediationTier("zombies")');
        expect(tabla).toContain("getTagRemediationTier()");
    });

    it("no quedan claves con el plan en el nombre", () => {
        expect(tabla).not.toContain("enterpriseTooltip");
        expect(tabla).not.toContain("deleteRequiresEnterprise");
    });

    it("los carteles reciben el tier como parametro", () => {
        expect(tabla).toMatch(/tierRequiredTooltip", \{ tier:/);
        expect(tabla).toMatch(/deleteRequiresTier", \{ tier:/);
    });
});

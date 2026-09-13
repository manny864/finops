// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { addonUnlocksApiPath, ADDON_CATALOG } from "@/lib/addonCatalog";

const API_DIR = path.join(process.cwd(), "src/app/api");

function rutasGateadasPorTier(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) rutasGateadasPorTier(full, acc);
        else if (entry.name === "route.ts" && fs.readFileSync(full, "utf8").includes("requireTenantTier(request")) {
            acc.push(path.dirname(full).replace(API_DIR, "").replace(/\\/g, "/"));
        }
    }
    return acc;
}

describe("el modulo comprado tambien abre sus APIs", () => {
    it("habilita el endpoint exacto y los de adentro", () => {
        expect(addonUnlocksApiPath(["mod_monitoring"], "/api/intelligence/monitoring/alerts")).toBe(true);
        expect(addonUnlocksApiPath(["mod_ttl"], "/api/cleanup/ttl")).toBe(true);
        expect(addonUnlocksApiPath(["mod_ttl"], "/api/cleanup/ttl/policies")).toBe(true);
    });

    it("no habilita endpoints de otro modulo ni del core", () => {
        expect(addonUnlocksApiPath(["mod_monitoring"], "/api/intelligence/security/key-vault")).toBe(false);
        expect(addonUnlocksApiPath(["mod_monitoring"], "/api/cost-groups")).toBe(false);
        expect(addonUnlocksApiPath([], "/api/cleanup/ttl")).toBe(false);
    });

    it("compara por segmento, no por texto suelto", () => {
        expect(addonUnlocksApiPath(["mod_ttl"], "/api/cleanup/ttl-legacy")).toBe(false);
    });

    it("tolera query string y barra final", () => {
        expect(addonUnlocksApiPath(["mod_ha"], "/api/governance/ha/?scope=all")).toBe(true);
    });

    // Sin esto, un prefijo con typo pasa el type-check y el modulo sigue dando 403.
    it("cada prefijo declarado apunta a una API que realmente gatea por tier", () => {
        const gateadas = rutasGateadasPorTier(API_DIR);
        for (const [key, item] of Object.entries(ADDON_CATALOG)) {
            for (const prefijo of item.apiPrefixes ?? []) {
                const cubre = gateadas.some((r) => r === prefijo || r.startsWith(prefijo + "/"));
                expect(cubre, `${key}: "${prefijo}" no cubre ninguna ruta con requireTenantTier`).toBe(true);
            }
        }
    });

    it("todo modulo vendible declara su ruta de UI", () => {
        const modulos = Object.values(ADDON_CATALOG).filter((a) => a.key.startsWith("mod_"));
        expect(modulos.length).toBeGreaterThan(0);
        for (const m of modulos) expect(m.route, m.key).toBeTruthy();
    });
});

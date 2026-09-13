import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ADDON_CATALOG } from "@/lib/addonCatalog";

/**
 * Cada producto del catálogo necesita `product_<key>_name` y `product_<key>_desc`
 * en los tres idiomas. `AddonsMarketplace` los pide con `t()` y, aunque tiene
 * fallback al nombre del catálogo, next-intl igual escupe un MISSING_MESSAGE por
 * cada clave faltante: agregar los 19 módulos sin sus claves produjo 38 errores
 * de consola en una sola pantalla.
 */
const LOCALES = ["es", "en", "pt-BR"] as const;

const bloque = (loc: string): Record<string, string> =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), `messages/${loc}.json`), "utf8")).AddonsMarketplace;

describe("i18n del marketplace", () => {
    for (const loc of LOCALES) {
        it(`${loc}: todo producto del catálogo tiene nombre y descripción`, () => {
            const msgs = bloque(loc);
            const faltan: string[] = [];
            for (const key of Object.keys(ADDON_CATALOG)) {
                for (const suf of ["name", "desc"]) {
                    const k = `product_${key}_${suf}`;
                    if (!msgs[k]?.trim()) faltan.push(k);
                }
            }
            expect(faltan, `faltan en ${loc}`).toEqual([]);
        });
    }

    it("los add-ons con unidad la tienen traducida", () => {
        for (const loc of LOCALES) {
            const msgs = bloque(loc);
            for (const [key, item] of Object.entries(ADDON_CATALOG)) {
                if (item.unit) expect(msgs[`product_${key}_unit`], `${loc}/${key}`).toBeTruthy();
            }
        }
    });

    it("ningún texto quedó sin traducir (es igual en los tres idiomas)", () => {
        // Un nombre propio puede repetirse (Azure AI, Policies); una descripción
        // larga idéntica en tres idiomas es un copy-paste sin traducir.
        const [es, en, pt] = LOCALES.map(bloque);
        const sinTraducir = Object.keys(ADDON_CATALOG)
            .map((k) => `product_${k}_desc`)
            .filter((k) => es[k] && es[k] === en[k] && es[k] === pt[k]);
        expect(sinTraducir).toEqual([]);
    });
});

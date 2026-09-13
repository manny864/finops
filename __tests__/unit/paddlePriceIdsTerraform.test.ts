import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * El JSON que Terraform inyecta como env vars y los fallbacks del catalogo son
 * la misma lista escrita dos veces. Este test es lo unico que impide que se
 * separen: si divergen, la app lee un price ID del entorno y otro del codigo, y
 * el unico sintoma seria un cobro contra el producto equivocado.
 */
const JSON_PATH = "infra/terraform/environments/prod/paddle-price-ids.json";

const enTerraform: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), JSON_PATH), "utf8")
);

const enCatalogo: Record<string, string> = {};
for (const m of fs
    .readFileSync(path.join(process.cwd(), "src/lib/addonCatalog.ts"), "utf8")
    .matchAll(/process\.env\.(PADDLE_PRICE_[A-Z0-9_]+) \|\| "(pri_[a-z0-9]+)"/g)) {
    if (!enCatalogo[m[1]]) enCatalogo[m[1]] = m[2];
}

describe("price IDs: Terraform vs catalogo", () => {
    it("el JSON tiene exactamente las mismas claves que el catalogo", () => {
        expect(Object.keys(enTerraform).sort()).toEqual(Object.keys(enCatalogo).sort());
    });

    it("cada price ID coincide", () => {
        for (const [k, v] of Object.entries(enCatalogo)) {
            expect(enTerraform[k], k).toBe(v);
        }
    });

    it("todos los valores son price IDs de Paddle bien formados", () => {
        for (const [k, v] of Object.entries(enTerraform)) {
            expect(v, k).toMatch(/^pri_[a-z0-9]{26}$/);
        }
    });

    it("ningun price ID se repite en dos variables distintas", () => {
        // Fue un bug real: REPORTS_1M apuntaba al producto mensual, y los cinco
        // IDs de Integration Services estaban cargados bajo las variables de
        // Monitoreo. Se cobraba el producto equivocado.
        const vistos = new Map<string, string>();
        for (const [k, v] of Object.entries(enTerraform)) {
            expect(vistos.has(v), `${k} repite el ID de ${vistos.get(v)}`).toBe(false);
            vistos.set(v, k);
        }
    });
});

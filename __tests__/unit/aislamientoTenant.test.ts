import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/*
 * ARM devuelve suscripciones de otros directorios cuando el service principal
 * tiene RBAC sobre ellas, y cada una declara su `tenantId`. `listTenantSubscriptions`
 * es el único lugar donde se mira ese campo.
 *
 * El problema no fue que faltara el filtro: fue que había 16 lugares
 * enumerando suscripciones por su cuenta —cobros, inventario, auditoría,
 * selector de alcance— y arreglar uno dejaba los otros quince mezclando dos
 * clientes. Por eso la guardia cuida la puerta, no el filtro: mientras nadie
 * abra una segunda, el filtro no se puede saltear.
 */
function fuentes(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            if (entry !== "node_modules" && entry !== ".next") fuentes(p, out);
        } else if (/\.tsx?$/.test(entry)) out.push(p);
    }
    return out;
}

/*
 * `tenantHealthService` sólo mira si ARM contesta 200 para reportar el estado
 * de la credencial: no lee `value`, así que no puede atribuir nada mal.
 */
const PERMITIDOS = new Set(["src/lib/azure.ts", "src/services/tenantHealthService.ts"]);

describe("aislamiento entre tenants · enumeración de suscripciones", () => {
    const directos: string[] = [];
    for (const archivo of fuentes("src")) {
        const rel = archivo.replace(/\\/g, "/");
        if (PERMITIDOS.has(rel)) continue;
        if (readFileSync(archivo, "utf8").includes("management.azure.com/subscriptions?api-version")) {
            directos.push(rel);
        }
    }

    it("nadie consulta ARM por suscripciones fuera de listTenantSubscriptions", () => {
        expect(
            directos,
            "Estos archivos enumeran suscripciones sin filtrar por directorio y mezclan clientes.\n" +
                "Usá listTenantSubscriptions(tenantId, credential) de @/lib/azure."
        ).toEqual([]);
    });

    it("la puerta única sigue filtrando por el tenant de cada suscripción", () => {
        const azure = readFileSync("src/lib/azure.ts", "utf8");
        expect(azure).toContain("if (duenio !== esperado)");
    });
});

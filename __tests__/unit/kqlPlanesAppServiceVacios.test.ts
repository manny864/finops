// @vitest-environment node
import { describe, it, expect } from "vitest";
import { kqlCatalog } from "@/modules/core/kqlCatalog";

/**
 * `emptyAppServicePlans` era INVÁLIDA en Azure Resource Graph, y desde siempre: ARG la
 * rechaza con
 *
 *   Summarize group key 'sku' is of a 'dynamic' type. Please use an explicit cast
 *   (for example, 'summarize ... by tostring(sku)') as grouping by a 'dynamic' type is
 *   not supported.
 *
 * (verificado el 2026-10-09 contra un tenant real, con la api-version del SDK, 2021-03-01,
 * y con la 2022-10-01). `sku=sku.name` es un `dynamic` y el `summarize` agrupa por ella.
 *
 * `runGraphAudits` corre todo el catálogo y, ante una query inválida, sólo hace
 * `console.warn` y devuelve `[]` para esa clave: los planes de App Service vacíos NUNCA
 * aparecieron en Zombis ni en la auditoría de un tenant real. Era una de las 63 queries del
 * catálogo y la única inválida: las otras 62 corren.
 */
describe("kqlCatalog.emptyAppServicePlans — válida en Resource Graph", () => {
    const q = kqlCatalog.emptyAppServicePlans;

    it("castea sku a string: el summarize no puede agrupar por una columna dynamic", () => {
        expect(q).toMatch(/\bsku\s*=\s*tostring\(sku\.name\)/);
        expect(q).not.toMatch(/\bsku\s*=\s*sku\.name\b/);
    });

    it("sigue agrupando por sku y devolviendo sólo los planes sin sitios", () => {
        expect(q).toMatch(/summarize[^|]*\bby\b[^|]*\bsku\b/);
        expect(q).toContain("siteCount == 0");
    });
});

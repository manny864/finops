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

/**
 * Un plan de App Service cuesta distinto en Linux y en Windows (S1: 0,095/h contra 0,10/h en
 * eastus): son medidores y productos separados en la Retail API. ARM lo dice en
 * `properties.reserved` (Learn, Microsoft.Web/serverfarms: "If Linux app service plan true,
 * false otherwise"); `kind` es texto libre y `isXenon` figura como obsoleto.
 *
 * Se proyecta con `tostring`, no con `tobool`: medido el 2026-10-09 contra un plan Linux
 * real, `tobool(properties.reserved)` llega como el NÚMERO 1 y no como `true`, y un
 * `reserved === true` en la ruta habría tomado todos los planes Linux por Windows sin
 * ningún error. `tostring` llega como "true"/"false". Y como la query termina en un
 * `summarize`, que descarta toda columna que no esté en el `by`, hay que conservarla ahí.
 */
describe("kqlCatalog.emptyAppServicePlans — sistema operativo del plan", () => {
    const q = kqlCatalog.emptyAppServicePlans;

    it("proyecta properties.reserved como string, no como booleano", () => {
        expect(q).toMatch(/project[^|]*\breserved\s*=\s*tostring\(properties\.reserved\)/);
        expect(q).not.toMatch(/tobool\(properties\.reserved\)/);
    });

    it("la conserva en el summarize: sin estar en el `by` no llega a la ruta", () => {
        expect(q).toMatch(/summarize[^|]*\bby\b[^|]*\breserved\b/);
    });
});

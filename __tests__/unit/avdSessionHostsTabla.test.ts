// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");
const sin = (p: string) =>
    readFileSync(join(RAIZ, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Los session hosts de AVD NO viven en la tabla `Resources` de Resource Graph,
 * sino en `desktopvirtualizationresources`. Pedirlos en `Resources` no da
 * error: da CERO FILAS, que es indistinguible de "el host pool esta vacio".
 *
 * Asi salio a produccion el 2026-09-15: la pantalla mostraba dos host pools
 * reales con 0 session hosts, $0.00 de computo y ninguna recomendacion, y
 * parecia un tenant sin uso en vez de una consulta mal dirigida.
 */
describe("los session hosts se consultan en su propia tabla de Resource Graph", () => {
    const avd = sin("src/modules/collectors/azure/avdService.ts");

    it("declara la tabla desktopvirtualizationresources", () => {
        expect(avd).toContain('"desktopvirtualizationresources"');
    });

    it("la consulta de session hosts pasa esa tabla", () => {
        // El tipo de session host no puede ir en la llamada que usa la tabla
        // por defecto: ahi es donde no devolvia nada.
        const llamadaSessionHosts = avd.match(/listResourcesByTypes\([^;]*SESSIONHOST_TYPE[^;]*\)/s)?.[0] ?? "";
        expect(llamadaSessionHosts).toContain("SESSIONHOST_TABLA");
    });

    it("el tipo de session host no viaja en la consulta a Resources", () => {
        const llamadaResources = avd.match(/listResourcesByTypes\(\s*tenantId,\s*\[\s*HOSTPOOL_TYPE[^;]*?\)/s)?.[0] ?? "";
        expect(llamadaResources).not.toContain("SESSIONHOST_TYPE");
    });

    it("listResourcesByTypes no cae al respaldo ARM para tablas de hijos", () => {
        // `/resources` de ARM es el equivalente de la tabla `Resources`: para
        // una tabla de recursos hijos devolveria vacio y gastaria cuota.
        const compartido = sin("src/app/api/intelligence/databases/diagnosticsShared.ts");
        expect(compartido).toMatch(/tabla !== "Resources"/);
    });
});

/**
 * AVD tiene pagina dedicada desde el 2026-09-15, asi que sale del catalogo
 * catch-all: dejarlo en los dos lados duplica su costo en cualquier total que
 * sume ambas rutas.
 */
describe("AVD no se cuenta dos veces", () => {
    it("miscServices ya no lista hostpools ni workspaces", () => {
        const misc = sin("src/modules/collectors/azure/miscServicesCostService.ts");
        expect(misc).not.toContain("microsoft.desktopvirtualization/hostpools");
        expect(misc).not.toContain("microsoft.desktopvirtualization/workspaces");
    });
});

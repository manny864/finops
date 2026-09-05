// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { escapeKql } from "@/lib/kql";

const sinComentarios = (ruta: string) =>
    readFileSync(join(__dirname, "..", "..", ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

/**
 * SEC-01 — IDOR en la cuota del Copilot (auditoría 2026-09-04).
 *
 * `requireRequestIdentity` AUTENTICA pero no autoriza: valida la firma del token
 * y devuelve `claims.tid`, sin comprobar pertenencia a ningún tenant de la
 * plataforma. Y el `tenantId` del query string tenía precedencia sobre la
 * identidad, así que cualquier usuario autenticado podía pedir la cuota de otro
 * tenant y obtener su tier, si tenía clave de IA propia, y sus contadores de uso.
 */
describe("SEC-01: la cuota del Copilot valida pertenencia", () => {
    const ruta = sinComentarios("src/app/api/intelligence/copilot/quota/route.ts");

    it("un tenantId explícito pasa por el guard de pertenencia", () => {
        expect(ruta).toMatch(/if \(tenantId\) \{[\s\S]{0,120}requireTenantAccess\(request, tenantId/);
    });

    it("el guard corre ANTES de resolver el tenant efectivo", () => {
        const guard = ruta.indexOf("requireTenantAccess(request, tenantId");
        const resuelve = ruta.indexOf("effectiveTenantId = tenantId || identity.tenantId");
        expect(guard).toBeGreaterThan(-1);
        expect(resuelve).toBeGreaterThan(-1);
        expect(guard, "el guard tiene que correr antes de usar el tenantId").toBeLessThan(resuelve);
    });

    it("requireRequestIdentity sigue sin alcanzar por sí solo", () => {
        // Si alguien lo cambia por sólo `requireRequestIdentity`, vuelve el IDOR.
        expect(ruta).toContain("requireTenantAccess");
    });
});

/**
 * SEC-02 — Escape de KQL incompleto.
 *
 * `azureResourceCounts` BORRABA las comillas en vez de escaparlas y no tocaba la
 * barra invertida. No era explotable —los nombres salen de la ingesta de Azure y
 * los resource groups de Azure no admiten `\` ni `'`— pero era el mismo bug que
 * el `escapeKql` hermano documentaba haber arreglado, sobreviviendo porque ese
 * arreglo estaba atrapado dentro de un archivo de ruta y nadie podía importarlo.
 */
describe("SEC-02: un solo escape de KQL, compartido", () => {
    it("escapa la barra invertida ANTES que la comilla", () => {
        // Al revés, un valor terminado en `\` consume la comilla de escape recién
        // insertada y cierra el literal antes de tiempo.
        expect(escapeKql("foo\\")).toBe("foo\\\\");
        expect(escapeKql("o'brien")).toBe("o\\'brien");
        // El caso que rompe con el orden invertido:
        expect(escapeKql("x\\'")).toBe("x\\\\\\'");
    });

    it("no borra caracteres: los escapa", () => {
        // La versión vieja hacía `.replace(/'/g, "")`, o sea perdía el dato.
        expect(escapeKql("a'b")).toContain("a");
        expect(escapeKql("a'b")).toContain("b");
        expect(escapeKql("a'b")).toContain("'");
    });

    it("tolera null y undefined sin romper la consulta", () => {
        expect(escapeKql(null as never)).toBe("");
        expect(escapeKql(undefined as never)).toBe("");
    });

    it("los dos consumidores usan el compartido, no una copia local", () => {
        for (const ruta of [
            "src/lib/azureResourceCounts.ts",
            "src/app/api/cost-groups/[name]/route.ts",
        ]) {
            const src = sinComentarios(ruta);
            expect(src, `${ruta} no importa el escape compartido`).toMatch(
                /import \{ escapeKql \} from "@\/lib\/kql"/
            );
            expect(src, `${ruta} define su propia copia`).not.toMatch(
                /function escapeKql\s*\(/
            );
        }
    });

    it("no queda ningún escape de KQL casero en el repo", () => {
        // El patrón exacto que tenía azureResourceCounts: borrar la comilla.
        for (const ruta of ["src/lib/azureResourceCounts.ts"]) {
            expect(sinComentarios(ruta)).not.toMatch(/replace\(\/'\/g,\s*""\)/);
        }
    });
});

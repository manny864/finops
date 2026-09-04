// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sinComentarios = (ruta: string) =>
    readFileSync(join(__dirname, "..", "..", ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");

const RUTA = "src/app/api/onboard/lighthouse/[id]/route.ts";

/**
 * Baja de una delegación de Lighthouse.
 *
 * Borra NUESTRO registro, no la delegación: el `registrationAssignment` vive en
 * la suscripción del cliente. Los tests fijan las dos cosas que, calladas,
 * dejarían al sistema mintiendo: que un tenant no quede en modo lighthouse sin
 * ninguna delegación detrás, y que borrar una que sigue viva en Azure lo diga.
 */
describe("baja de delegaciones", () => {
    const ruta = sinComentarios(RUTA);

    it("un tenant sin delegaciones no queda en modo lighthouse", () => {
        // La credencial apunta a nuestro directorio y ya no hay suscripciones
        // delegadas detrás: el tenant se quedaría sin ninguna vía a Azure.
        expect(ruta).toMatch(/access_model = 'app_registration'/);
        expect(
            ruta,
            "la reversión tiene que depender de que no quede ninguna delegación"
        ).toMatch(/COUNT\(\*\)[\s\S]{0,300}app_registration/);
    });

    it("avisa cuando la delegación seguía activa en Azure", () => {
        expect(ruta).toContain("seguiaActivaEnAzure");
    });

    it("no intenta borrar filas que reporta Azure", () => {
        // Las que vienen de Resource Graph traen el assignmentId de ARM como id,
        // no un entero de nuestra tabla.
        expect(ruta).toMatch(/\^\\d\+\$/);
    });

    it("exige Owner, no Admin", () => {
        // Cambia cómo la plataforma accede al tenant.
        expect(ruta).toMatch(/requireTenantRole\(request, tenantId, \['Owner'\]\)/);
    });

    it("el borrado va acotado al tenant, no sólo al id", () => {
        // Sin el tenant en el WHERE, un id de otro tenant se borraría igual.
        expect(ruta).toMatch(/DELETE FROM TenantDelegations WHERE id = \? AND tenant_id = \?/);
    });
});

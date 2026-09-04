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

/**
 * Un cliente con varias suscripciones.
 *
 * La plantilla no nombra la suscripción --es un `subscriptionDeploymentTemplate`
 * con `guid(subscription().id)`, resuelto al desplegar-- así que el mismo JSON
 * sirve para todas y el cliente lo despliega una vez por suscripción sin
 * volver a pedirnos nada. `TenantDelegations` se entera de la primera y de
 * ninguna más, así que contar contra esa tabla sub-reporta.
 */
describe("delegación de varias suscripciones", () => {
    const svc = sinComentarios("src/services/lighthouseVerification.service.ts");

    it("cuenta por tenant delegante, no sólo por suscripción registrada", () => {
        expect(svc).toMatch(/delegante === tenantId\.toLowerCase\(\)/);
    });

    it("conserva el match por suscripción como respaldo", () => {
        // Para filas anteriores a que el KQL proyectara managedTenantId.
        expect(svc).toMatch(/:\s*esperadas\.has\(sub\)/);
    });

    it("no aborta cuando no hay ninguna fila registrada", () => {
        // El cliente pudo desplegar en suscripciones que nunca escribimos.
        expect(
            svc,
            "volvió el corte temprano: una delegación real quedaría invisible"
        ).not.toMatch(/esperadas\.size === 0/);
    });

    it("sigue exigiendo que la delegación sea hacia NOSOTROS", () => {
        // Resource Graph devuelve delegaciones de todos los administradores que
        // el principal pueda ver.
        expect(svc).toMatch(/managedByTenantId[\s\S]{0,80}nuestroTenant/);
    });
});

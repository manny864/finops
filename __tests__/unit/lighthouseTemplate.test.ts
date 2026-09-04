// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RUTA = "src/app/api/onboard/lighthouse/route.ts";
const src = readFileSync(join(__dirname, "..", "..", RUTA), "utf8");
const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * La plantilla de Azure Lighthouse (2026-09-04).
 *
 * `principalId` se rellenaba con `00000000-0000-0000-0000-00000000000${i+1}`
 * cuando no venía en el body, y no venía NUNCA: ni `LighthousePanel` ni
 * `LighthouseDelegationPanel` lo mandan. Todas las plantillas generadas llevaban
 * GUIDs inventados.
 *
 * Lo grave es que no falla. Lighthouse no verifica que el principal exista al
 * desplegar, así que en la suscripción de un cliente la plantilla habría entrado
 * en verde, la delegación figuraría activa de los dos lados, y no le habría dado
 * acceso a nadie. Un no-op que se ve como un éxito.
 */
describe("plantilla de Azure Lighthouse", () => {
    it("no inventa principals cuando no hay uno configurado", () => {
        expect(
            sinComentarios,
            "volvió el relleno de GUIDs: la delegación se despliega bien y no otorga acceso a nadie"
        ).not.toMatch(/principalId:\s*principalId\s*\|\|/);
        expect(sinComentarios).not.toMatch(/00000000-0000-0000-0000-0000000000\$\{/);
    });

    it("el principal sale de la configuración y se valida como GUID", () => {
        expect(sinComentarios).toContain("AZURE_LIGHTHOUSE_PRINCIPAL_ID");
        expect(
            sinComentarios,
            "un valor mal cargado tiene que caer como no configurado, no viajar a la plantilla"
        ).toMatch(/GUID\.test\(id\)/);
    });

    it("sin principal configurado devuelve error, no una plantilla a medias", () => {
        expect(sinComentarios).toMatch(/if\s*\(!armTemplate\)/);
        expect(sinComentarios).toMatch(/status:\s*503/);
    });

    it("rechaza delegar una suscripción al mismo tenant", () => {
        // Azure lo rechaza igual, pero con un
        // InvalidRegistrationDefinitionCreateRequest que no explica el motivo.
        expect(sinComentarios).toMatch(
            /managedTenantId\)\.toLowerCase\(\)\s*===\s*String\(tenantId\)\.toLowerCase\(\)/
        );
    });

    it("la asignación es determinística, para poder re-desplegar", () => {
        // Con `deployment().name` en el nombre, cada re-despliegue creaba una
        // asignación nueva en vez de actualizar la existente.
        const asignacion = sinComentarios.slice(sinComentarios.indexOf("registrationAssignments"));
        expect(asignacion.slice(0, 400)).not.toContain("deployment().name");
    });

    it("no ofrece roles que Lighthouse prohíbe", () => {
        // Owner está vedado en delegaciones de Lighthouse; User Access
        // Administrator sólo con delegatedRoleDefinitionIds.
        expect(sinComentarios, "Owner no es delegable por Lighthouse")
            .not.toContain("8e3af657-a8ff-443c-a75c-2fe8c4bcb635");
    });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

/**
 * SEC-01 de docs/security/audit-2026-09-21.md.
 *
 * El motor de prueba de entrega de alertas self-service recibe la URL de destino
 * en el BODY del request (no de la regla guardada), asi que es enteramente del
 * cliente. Sin guard, POSTea desde nuestra infraestructura a cualquier host y
 * devuelve el status HTTP: un oraculo para barrer la red interna.
 *
 * Es una asercion sobre el FUENTE y no un test de comportamiento a proposito: el
 * bug no es que la validacion falle, es que no este. Un test de comportamiento
 * sobre un `fetch` mockeado pasa igual si alguien saca la linea, porque el mock
 * responde a cualquier URL. Mismo criterio que paddleTierMap.test.ts.
 */
const SERVICIO = "src/services/azureSelfServiceAlerts.service.ts";
const RUTA = "src/app/api/analytics/self-service-alerts/test/route.ts";

describe("SEC-01 — la prueba de entrega no puede ser un relay saliente", () => {
    it("valida la URL con assertSafeWebhookUrl antes de hacer fetch", () => {
        const src = readFileSync(SERVICIO, "utf-8");

        expect(src).toContain("assertSafeWebhookUrl");

        const posGuard = src.indexOf("await assertSafeWebhookUrl(targetUrl)");
        const posFetch = src.indexOf("await safeWebhookFetch(destino.toString()");

        expect(posGuard).toBeGreaterThan(-1);
        expect(posFetch).toBeGreaterThan(-1);
        expect(posGuard).toBeLessThan(posFetch);
    });

    it("no vuelve a hacer fetch de la URL cruda del body", () => {
        const src = readFileSync(SERVICIO, "utf-8");
        // `targetUrl` es el valor sin validar; solo puede llegar al guard.
        expect(src).not.toContain("fetch(targetUrl");
    });

    it("bloquea los redirects, que sacarian el POST de la allow-list", () => {
        const src = readFileSync(SERVICIO, "utf-8");
        expect(src).toMatch(/redirect:\s*"error"/);
    });

    it("la ruta exige Admin/Owner, como crear o borrar una regla", () => {
        const src = readFileSync(RUTA, "utf-8");
        expect(src).toMatch(/requireTenantRole\(\s*request,\s*tenantId,\s*\["Admin",\s*"Owner"\]\s*\)/);
        // requireTenantAccess = cualquier miembro, incluido un Reader. Se busca
        // la LLAMADA y no la mencion: el comentario de cabecera nombra el guard
        // viejo para explicar por que se subio, y eso no debe romper el test.
        expect(src).not.toMatch(/await\s+requireTenantAccess\s*\(/);
    });
});

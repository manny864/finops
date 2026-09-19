// @vitest-environment node
import { describe, it, expect } from "vitest";
import { accionDenegada } from "@/lib/apiErrors";

/**
 * El 403 de Azure nombra la accion RBAC exacta que falta, que es lo unico
 * accionable del error. Pero el mensaje crudo trae tambien el client id y el
 * object id del Service Principal, y el scope trae el id de suscripcion: nada
 * de eso puede viajar al cliente.
 *
 * Mensaje real de produccion (2026-09-15), con los GUID intactos a proposito
 * para que el test falle si alguna vez se filtran.
 */
const MENSAJE_REAL =
    "Azure API error 403: {\"error\":{\"code\":\"AuthorizationFailed\",\"message\":\"The client " +
    "'51320858-e6e2-4b19-83a8-29b72ace9157' with object id 'b5f4281b-241f-4a85-be1d-5c8bd25fff07' " +
    "does not have authorization to perform action 'microsoft.web/connections/delete' over scope " +
    "'/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/rg/providers/microsoft.web/connections/office365-1' " +
    "or the scope is invalid.\"}}";

describe("accion denegada por Azure", () => {
    it("extrae la accion del mensaje real", () => {
        expect(accionDenegada(new Error(MENSAJE_REAL))).toBe("microsoft.web/connections/delete");
    });

    it("lo extraido NO lleva ids del Service Principal ni de la suscripcion", () => {
        const accion = accionDenegada(new Error(MENSAJE_REAL)) ?? "";
        expect(accion).not.toContain("51320858");
        expect(accion).not.toContain("b5f4281b");
        expect(accion).not.toContain("ec03e8ce");
        expect(accion).not.toContain("/subscriptions/");
    });

    it("tambien lo lee desde `details` del SDK de Azure", () => {
        const err = { details: { error: { message: "does not have authorization to perform action 'Microsoft.Compute/disks/delete' over scope '/x'" } } };
        expect(accionDenegada(err)).toBe("Microsoft.Compute/disks/delete");
    });

    it("un error que no es de autorizacion no devuelve nada", () => {
        expect(accionDenegada(new Error("Azure API error 429: Too many requests"))).toBeUndefined();
        expect(accionDenegada(undefined)).toBeUndefined();
        expect(accionDenegada({})).toBeUndefined();
    });
});

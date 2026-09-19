// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { esBorradoManual, UNIFIED_AUDIT_RESOURCE_CONFIG } from "@/lib/zombieAuditCatalog";

/**
 * Hay tipos que la plataforma DETECTA como fuga pero NO elimina: se gestionan
 * desde Azure. No es una limitacion tecnica sino de alcance del producto —
 * borrarlos exige Contributor sobre la suscripcion del cliente, que es
 * justamente el permiso que el onboarding no pide.
 *
 * El 2026-09-15, desde overview/financial-leaks, salio un DELETE de un
 * `microsoft.web/connections` igual. Llego hasta ARM y volvio un 403 de Azure:
 * un error de PERMISOS para algo que en realidad el producto no ofrece. Ese
 * diagnostico manda a pedirle Contributor al cliente sin necesidad.
 */
describe("tipos de borrado manual", () => {
    it("una API Connection no se borra desde la plataforma", () => {
        expect(esBorradoManual("microsoft.web/connections")).toBe(true);
    });

    it("no distingue mayusculas, como los armType de ARM", () => {
        expect(esBorradoManual("Microsoft.Web/Connections")).toBe(true);
    });

    it("un disco suelto SI se borra", () => {
        expect(esBorradoManual("microsoft.compute/disks")).toBe(false);
    });

    it("una IP publica huerfana SI se borra", () => {
        expect(esBorradoManual("microsoft.network/publicipaddresses")).toBe(false);
    });

    it("un tipo desconocido no se bloquea", () => {
        // Fail-open a proposito: el guard existe para lo que el catalogo
        // declara manual, no para inventar restricciones sobre lo que no conoce.
        expect(esBorradoManual("microsoft.loquesea/cosas")).toBe(false);
        expect(esBorradoManual(undefined)).toBe(false);
        expect(esBorradoManual("")).toBe(false);
    });

    it("ningun armType es borrable por una regla y manual por otra", () => {
        // El guard indexa por armType, asi que un tipo con dos valores distintos
        // haria que el resultado dependa del orden del catalogo.
        const porArm = new Map<string, Set<boolean>>();
        for (const config of Object.values(UNIFIED_AUDIT_RESOURCE_CONFIG)) {
            const k = config.armType.toLowerCase();
            if (!porArm.has(k)) porArm.set(k, new Set());
            porArm.get(k)!.add(config.manualDelete);
        }
        const conflictivos = [...porArm.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);
        expect(conflictivos).toEqual([]);
    });
});

/**
 * El guard va en la ruta y no solo en la UI: la UI YA lo tenia --el boton viene
 * deshabilitado y `handleDelete` corta con un toast-- y aun asi el DELETE
 * llego. Un chequeo en el unico punto por el que pasan todas las pantallas es
 * lo que hace que no importe cual de ellas se lo saltee.
 */
describe("la ruta de remediacion corta antes de llamar a Azure", () => {
    const ruta = readFileSync(
        join(__dirname, "..", "..", "src/app/api/remediation/route.ts"),
        "utf8",
    );

    it("consulta el catalogo", () => {
        expect(ruta).toContain("esBorradoManual(resourceType)");
        expect(ruta).toContain("RESOURCE_TYPE_NOT_DELETABLE");
    });

    it("el guard corre ANTES del borrado real", () => {
        expect(ruta.indexOf("esBorradoManual(resourceType)")).toBeLessThan(ruta.indexOf("await deleteResource("));
    });

    it("responde 4xx y no deja que Azure conteste 403", () => {
        const bloque = ruta.slice(ruta.indexOf("esBorradoManual(resourceType)"), ruta.indexOf("// Eliminar un recurso"));
        expect(bloque).toContain("status: 400");
    });
});

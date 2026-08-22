import { describe, it, expect, vi } from "vitest";

/**
 * Caso "la consulta de preferencias falla" en archivo propio: el throw va
 * horneado en la factory de `vi.mock` (que es por archivo). Asignar un
 * `mockImplementation` que lanza desde el cuerpo de un test hace que Vitest
 * reporte ese Error como fallo del test aunque el código lo capture bien.
 */
vi.mock("@/modules/storage/db", () => ({
    default: {
        query: vi.fn(() => {
            throw new Error("db down");
        }),
    },
    initializeDatabase: vi.fn(),
    insertPlatformAiUsage: vi.fn(),
}));

import { getDataSharingPrefs, redactForTenant, redactSerializedForTenant } from "@/modules/core/aiProvider";

describe("preferencias de compartición — fail closed", () => {
    it("devuelve el modo más restrictivo si no se pueden leer las preferencias", async () => {
        // Nunca 'compartir todo' ante un error: el costo de equivocarse es
        // mandar nombres de recursos y tags a un proveedor externo.
        expect(await getDataSharingPrefs("t1")).toEqual({
            shareResourceNames: false,
            shareTags: false,
        });
    });

    it("redacta el payload cuando la DB no responde", async () => {
        const out: any = await redactForTenant("t1", {
            resourceName: "vm-prod-finanzas-01",
            tags: { owner: "cfo@empresa.com" },
            costUSD: 99.5,
        });

        expect(out.resourceName).toBe("[REDACTED]");
        expect(out.tags).toEqual({ _redacted: true, tagCount: 1 });
        expect(out.costUSD).toBe(99.5);
    });

    it("descarta un contexto serializado no parseable cuando la DB no responde", async () => {
        const { payload, dropped } = await redactSerializedForTenant("t1", "vm-prod-01 gastó 500 USD");
        expect(dropped).toBe(true);
        expect(payload).not.toContain("vm-prod-01");
    });
});

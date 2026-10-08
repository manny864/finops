// @vitest-environment node
/**
 * El índice de manuales de los borradores de soporte con IA.
 *
 * Es un JSON generado y commiteado (la imagen de Docker no lleva docs/ ni los
 * .md), así que nada lo actualiza solo: si alguien edita un manual y no lo
 * regenera, la IA cita secciones que ya no dicen eso. Esto lo frena.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    MANUALS,
    OUTPUT,
    buildSupportManualIndex,
    serializeSupportManualIndex,
} from "../../scripts/generate-support-manual-index.mjs";

const RAIZ = process.cwd();

describe("índice de manuales para los borradores de soporte", () => {
    it("corresponde a los manuales actuales", () => {
        const commiteado = fs.readFileSync(path.join(RAIZ, OUTPUT), "utf-8");
        const esperado = serializeSupportManualIndex(buildSupportManualIndex(RAIZ));
        // Sin diff de strings: el JSON pesa cientos de KB y el mensaje es lo que importa.
        expect(
            commiteado === esperado,
            `${OUTPUT} no corresponde a los manuales actuales. Regeneralo con \`npm run support:index\` y commiteá el JSON.`,
        ).toBe(true);
    });

    it("no indexa manuales internos (superadmin, security, lld, hld)", () => {
        for (const m of MANUALS) {
            expect(m.file).not.toMatch(/SUPERADMIN|docs\/(security|lld|hld)\//);
        }
    });

    it("cubre los tres idiomas del manual de usuario y del partner", () => {
        const chunks = buildSupportManualIndex(RAIZ);
        for (const manual of ["usuario", "partner"]) {
            for (const lang of ["es", "en", "pt-BR"]) {
                expect(chunks.some((c) => c.manual === manual && c.lang === lang), `${manual}/${lang}`).toBe(true);
            }
        }
    });
});

// @vitest-environment node
/**
 * El panel del afiliado. Lo que se cuida acá es la PUERTA: es la única
 * superficie de la plataforma a la que se entra sin pasar por Entra ID, y el
 * enlace es la credencial.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));

import {
    hashTokenDePanel,
    generarTokenDePanel,
    pareceTokenDePanel,
} from "@/services/affiliatePortal.service";

describe("el token del panel", () => {
    it("tiene 32 bytes de entropía y el prefijo que lo identifica", () => {
        const { bruto, prefijo, hash } = generarTokenDePanel();
        expect(bruto).toMatch(/^afp_live_[0-9a-f]{64}$/);
        expect(prefijo).toBe(bruto.slice(0, 14));
        expect(hash).toHaveLength(64);
    });

    it("dos emisiones nunca coinciden", () => {
        const vistos = new Set(Array.from({ length: 200 }, () => generarTokenDePanel().bruto));
        expect(vistos.size).toBe(200);
    });

    it("EL HASH NO ES EL TOKEN: es lo único que se guarda", () => {
        // Si esto se rompiera, la base tendría credenciales en claro.
        const { bruto, hash } = generarTokenDePanel();
        expect(hash).not.toBe(bruto);
        expect(hash).not.toContain(bruto.slice(9));
        // Determinista, o el enlace emitido dejaría de resolver.
        expect(hashTokenDePanel(bruto)).toBe(hash);
        expect(hashTokenDePanel(` ${bruto} `)).toBe(hash);
    });

    it("no hay dos tokens con el mismo hash", () => {
        const a = generarTokenDePanel();
        const b = generarTokenDePanel();
        expect(hashTokenDePanel(a.bruto)).not.toBe(hashTokenDePanel(b.bruto));
    });
});

describe("pareceTokenDePanel · lo que no llega a la consulta", () => {
    it("acepta sólo la forma exacta", () => {
        expect(pareceTokenDePanel(generarTokenDePanel().bruto)).toBe(true);
    });

    it("descarta la basura antes de tocar la base", () => {
        // El filtro corre ANTES del hash y de la consulta: una ruta pública que
        // hashea cualquier cosa que le manden es un oráculo gratis.
        for (const malo of [
            "",
            "afp_live_",
            "afp_live_nohex".padEnd(73, "z"),
            `afp_live_${"a".repeat(63)}`, // uno corto
            `afp_live_${"a".repeat(65)}`, // uno largo
            `AFP_LIVE_${"a".repeat(64)}`, // el prefijo es sensible a mayúsculas
            `pak_live_${"a".repeat(64)}`, // una clave de API pública no sirve acá
            "' OR 1=1 --",
            null, undefined, 42, {}, [],
        ]) {
            expect(pareceTokenDePanel(malo as unknown), String(malo)).toBe(false);
        }
    });

    it("tolera los espacios que agrega copiar y pegar", () => {
        expect(pareceTokenDePanel(` ${generarTokenDePanel().bruto}\n`)).toBe(true);
    });
});

import { describe, expect, it } from "vitest";
import { resolverComentarios } from "@/lib/recommendationText";

/*
 * Los scripts que el tablero muestra se copian y se pegan en una terminal, asi
 * que el resolver tiene dos obligaciones que se contradicen: traducir todos los
 * comentarios y no tocar ni un caracter de los comandos. Estos casos fijan el
 * limite entre las dos.
 */
describe("resolverComentarios", () => {
    const t = (clave: string) => {
        if (clave === "cmt_PASO1") return "Unlink the gateway";
        throw new Error(`falta ${clave}`);
    };

    it("reemplaza el marcador por el comentario del idioma activo", () => {
        expect(resolverComentarios("#{cmt_PASO1}\naz network vnet update", t)).toBe(
            "# Unlink the gateway\naz network vnet update"
        );
    });

    it("no deja marcadores sin resolver", () => {
        const salida = resolverComentarios("#{cmt_PASO1}\n#{cmt_PASO1} extra", t);
        expect(salida).not.toMatch(/#\{/);
    });

    it("no toca los comandos ni las banderas con almohadilla", () => {
        const script = 'az network public-ip update --name "#pool" --tags "a#b"';
        expect(resolverComentarios(script, t)).toBe(script);
    });

    it("una clave faltante no rompe el script: degrada a un comentario vacío", () => {
        expect(resolverComentarios("#{cmt_NO_ESTA}\naz vm list", t)).toBe("#\naz vm list");
    });
});

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Ninguna clase de Tailwind apunta a un paso de escala que no existe.
 *
 * La escala de color de Tailwind es 50, 100, 200 … 900, 950. **No hay 750 ni
 * 850.** Una clase como `dark:bg-slate-850` se lee perfectamente bien, pasa el
 * lint, pasa `tsc`, no emite warning — y no genera NADA. El elemento se queda
 * con lo que tenga para el tema claro.
 *
 * Asi se veia: la barra de nombres de columnas del modal de recomendaciones del
 * indice de optimizacion salia **blanca** sobre una tabla oscura, porque el
 * `dark:bg-slate-850` no existia y quedaba el `bg-slate-50` del tema claro.
 *
 * Es la misma familia de trampa que el `\b` del barrido de modo oscuro: el
 * problema no es que el codigo este mal escrito, es que se ve bien y no hace
 * nada. Un barrido encontro tres casos, y el tercero
 * (`dark:hover:bg-slate-750`, un boton cuyo hover no hacia nada en oscuro) no
 * lo habia reportado nadie en dos anios.
 *
 * ── Alcance ──
 *
 * Cubre solo los pasos numericos de la paleta que trae Tailwind. NO valida
 * nombres de color inventados (`bg-brand-soft` es legitimo: sale del `@theme` de
 * globals.css) ni valores arbitrarios (`bg-[#0054A6]`). Para eso haria falta
 * resolver el tema, y el modo de falla frecuente es el paso numerico.
 *
 * Si el proyecto alguna vez define un paso propio en `@theme`
 * (`--color-slate-850`), hay que agregarlo a PASOS_VALIDOS y anotar por que.
 */

const PALETA = [
    "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber",
    "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
    "indigo", "violet", "purple", "fuchsia", "pink", "rose",
].join("|");

const PASOS_VALIDOS = new Set(["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]);

const UTILIDADES = [
    "bg", "text", "border", "ring", "from", "to", "via", "divide", "outline",
    "decoration", "accent", "caret", "fill", "stroke", "placeholder", "shadow",
].join("|");

// Acepta cualquier cadena de variantes delante (dark:, hover:, dark:hover:, md:…)
const PATRON = new RegExp(`\\b(?:[a-z-]+:)*(?:${UTILIDADES})-(?:${PALETA})-(\\d+)`, "g");

function fuentes(dir: string): string[] {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir)) {
        const p = join(dir, entrada);
        if (statSync(p).isDirectory()) salida.push(...fuentes(p));
        else if (/\.(tsx|ts|css)$/.test(entrada)) salida.push(p);
    }
    return salida;
}

describe("pasos de la escala de color de Tailwind", () => {
    it("no hay clases apuntando a un paso inexistente", () => {
        const infractores: string[] = [];

        for (const archivo of fuentes("src")) {
            const lineas = readFileSync(archivo, "utf-8").split("\n");
            lineas.forEach((linea, i) => {
                for (const m of linea.matchAll(PATRON)) {
                    if (!PASOS_VALIDOS.has(m[1])) {
                        infractores.push(`${archivo}:${i + 1} → ${m[0]}`);
                    }
                }
            });
        }

        expect(infractores).toEqual([]);
    });
});

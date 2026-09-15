// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RUTA = join(__dirname, "..", "..", "src/app/api/intelligence/whiteboard/route.ts");
const fuente = readFileSync(RUTA, "utf8");
const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * El whiteboard ensambla 12 fuentes contra Azure y en caché frío las espera a
 * todas. Una sola lenta se llevaba puesta la respuesta entera: el proxy corta a
 * los 100 s y el usuario recibe un 524, no un whiteboard degradado.
 */
describe("el whiteboard no espera a Azure más de lo que el proxy tolera", () => {
    it("toda fuente del ensamblado pasa por el techo", () => {
        // Si alguien agrega una fuente nueva con .catch en vez de `fuente(...)`,
        // vuelve a poder colgar la respuesta entera.
        const bloque = sinComentarios.slice(
            sinComentarios.indexOf("] = await Promise.all(["),
            sinComentarios.indexOf("]);", sinComentarios.indexOf("] = await Promise.all(["))
        );
        const conTecho = (bloque.match(/fuente\(/g) || []).length;
        expect(conTecho).toBeGreaterThanOrEqual(11);
        expect(bloque, "una fuente con .catch suelto no tiene techo de tiempo").not.toMatch(/\.catch\(/);
    });

    it("el techo queda por debajo del corte del proxy", () => {
        const m = sinComentarios.match(/TECHO_POR_FUENTE_MS = Number\([^)]*\|\| ([\d_]+)\)/);
        expect(m, "no encontré el techo").not.toBeNull();
        const techo = Number(m![1].replace(/_/g, ""));
        // El proxy corta a los 100 s. Con 12 fuentes EN PARALELO el peor caso es
        // el techo, no su suma, pero igual tiene que dejar aire para el resto
        // del ensamblado (traducción, enriquecimiento, escritura de caché).
        expect(techo).toBeLessThan(60_000);
    });

    // Sin esto, saber cuál de las doce es la lenta es adivinar: el 524 se lleva
    // la respuesta y no queda registro de tiempos.
    it("mide y loguea cada fuente y el total", () => {
        expect(sinComentarios).toMatch(/fuente=\$\{nombre\} ms=/);
        expect(sinComentarios).toMatch(/ensamblado tenant=\$\{tenantId\} ms=/);
    });

    // El 524 sólo ocurre con caché VACÍO: mientras haya algo guardado, el SWR
    // responde al instante y refresca en background.
    it("el respaldo en caché dura mucho más que la ventana de refresco", () => {
        // La política pasó de un ternario en una línea a un bloque cuando se
        // agregó el caso "degradado en cero no pisa al bueno" (2026-09-15), así
        // que se verifican los números y no la forma de escribirlos.
        const m = sinComentarios.match(/\}, (\d+), (\d+), \(result\) =>/);
        expect(m, "no encontré la política de caché").not.toBeNull();
        const [, duro, soft] = m!.map(Number);
        expect(duro).toBeGreaterThanOrEqual(12 * 3600);
        expect(soft).toBeLessThanOrEqual(1800);
        // El degradado era de 5 min: el respaldo se vencía justo cuando Azure
        // venía lento, y el siguiente usuario volvía a esperar el ensamblado.
        const degradado = Number(
            sinComentarios.match(/mtd === 0 \|\| result\?\._costDegraded\) return (\d+);/)?.[1],
        );
        expect(degradado).toBeGreaterThanOrEqual(3600);
    });

    // Cost Management devuelve 429 de forma crónica y, al agotar reintentos,
    // `getCostFigures` no falla: devuelve 0 y sale "ok". Sin esto, el respaldo
    // largo dejaba ese cero en pantalla medio día.
    it("un costo en cero no se cachea con el TTL largo", () => {
        expect(sinComentarios).toMatch(/const mtd = Number\(result\?\.summary\?\.costMtdUSD \|\| 0\);/);
        expect(sinComentarios).toMatch(/mtd === 0/);
    });
});

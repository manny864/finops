// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { rotateDaily } from "@/lib/rotacionDiaria";

const RAIZ = join(__dirname, "..", "..");
const sinComentarios = (ruta: string) =>
    readFileSync(join(RAIZ, ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

/**
 * `historical-gap-backfill` no tenía techo de tiempo.
 *
 * Fallaba TODOS los días con `poll timeout sin done` a los ~3576 s — agotaba el
 * presupuesto completo de sondeo del runner sin terminar nunca. En tres días de
 * logs no hay una sola corrida completa, o sea que los huecos históricos no se
 * estaban rellenando.
 *
 * Cortar antes no pierde trabajo: el progreso se persiste día a día, así que lo
 * recuperado queda y la próxima corrida sigue.
 */
describe("presupuesto del backfill histórico", () => {
    const ruta = sinComentarios("src/app/api/cron/historical-gap-backfill/route.ts");

    it("hay techo de tiempo y se chequea dentro del barrido", () => {
        expect(ruta).toContain("PRESUPUESTO_MS");
        expect(ruta).toMatch(/Date\.now\(\) - arranque > PRESUPUESTO_MS/);
    });

    it("el techo deja margen para reportar antes de que lo mate el runner", () => {
        // El runner sondea ~59.6 min. Si el presupuesto fuera igual o mayor, el
        // barrido moriría sin decir cuánto alcanzó a hacer, que es el estado
        // que estamos arreglando.
        const m = ruta.match(/CRON_BACKFILL_BUDGET_MS \|\| (\d+) \* 60 \* 1000/);
        expect(m, "no encontré el default del presupuesto").not.toBeNull();
        expect(Number(m![1])).toBeLessThan(55);
    });

    it("rota el orden: sin eso el presupuesto es PEOR que no tenerlo", () => {
        // Con orden fijo, los mismos tenants se procesarían siempre primero y
        // los últimos no se rellenarían nunca.
        expect(ruta).toContain("rotateDaily(tenants");
        expect(ruta).toMatch(/for \(const tenant of orden\)/);
    });

    it("los tenants que quedan afuera se reportan, no se pierden en silencio", () => {
        expect(ruta).toContain("tenantsPendientes");
        expect(ruta).toContain("presupuestoAgotado");
    });

    it("la rotación reparte el costo de ir último", () => {
        const t = ["a", "b", "c", "d"];
        const dia = (n: number) => new Date(n * 86400000);
        const primeros = new Set([0, 1, 2, 3].map((n) => rotateDaily(t, dia(n))[0]));
        expect(primeros.size, "en 4 días los 4 tenants tienen que ir primero una vez").toBe(4);
    });

    it("rotateDaily vive en lib, no en una ruta", () => {
        // Mismo criterio que SEC-02: un helper atrapado en un archivo de ruta es
        // uno que el archivo de al lado va a reimplementar mal.
        const backfill = sinComentarios("src/app/api/cron/historical-gap-backfill/route.ts");
        expect(backfill).toContain('from "@/lib/rotacionDiaria"');
        expect(backfill, "importar una ruta desde otra arrastra su árbol entero")
            .not.toContain('from "@/app/api/cron/sync/route"');
    });

    it("una lista de 0 o 1 elemento no se rompe", () => {
        expect(rotateDaily([], new Date())).toEqual([]);
        expect(rotateDaily(["solo"], new Date())).toEqual(["solo"]);
    });
});

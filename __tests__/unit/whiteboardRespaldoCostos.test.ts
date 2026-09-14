// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");
const sin = (p: string) =>
    readFileSync(join(RAIZ, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Dos caminos de la misma app calculaban "el costo del mes" con filtros de
 * fecha distintos. Con Cost Management throttleado --que es cuando el respaldo
 * importa-- el Resumen Ejecutivo mostraba $0.00 mientras el dashboard leía
 * 243.25 de la MISMA tabla. Que difieran es peor que que falten: el usuario ve
 * dos números y ninguno explica al otro.
 */
describe("el respaldo de costos del whiteboard filtra igual que el dashboard", () => {
    const whiteboard = sin("src/app/api/intelligence/whiteboard/route.ts");

    it("el respaldo prioriza `date`, no el inicio del período de cargo", () => {
        // `COALESCE(ChargePeriodStart, date)` dejaba afuera las filas cuyo
        // período de facturación arranca antes del mes en curso.
        expect(whiteboard).toContain("COALESCE(date, ChargePeriodStart)");
        expect(whiteboard).not.toContain("COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT");
    });

    it("el ensamblado loguea el monto, no sólo el tiempo", () => {
        // Sin el valor en el log, un $0.00 en pantalla no distingue "Cost
        // Management falló" de "el respaldo filtró mal".
        expect(whiteboard).toMatch(/costMtd=\$\{/);
    });
});

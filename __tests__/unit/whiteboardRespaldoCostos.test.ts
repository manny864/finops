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

    // EL BUG (prod, 2026-09-14): meter el pronóstico de Azure dentro de
    // `getCostFigures` lo puso bajo el techo de la fuente entera. Con Cost
    // Management throttleado la llamada se comía los 25 s, la fuente degradaba
    //   fuente=costFigures ms=25001 degradada: superó el techo de 25000 ms
    // y el respaldo de ceros borraba el costo del mes, que YA estaba calculado.
    // La pantalla mostraba $0.00 con la base llena.
    it("el pronóstico de Azure tiene su propio techo, más corto que el de la fuente", () => {
        expect(whiteboard).toMatch(/fuente\(\s*"forecastAzure"[\s\S]{0,220}8_000/);
    });

    it("si costFigures degrada, el respaldo conserva el costo del mes", () => {
        // `currentMonth` ya trae su propio fallback a CostSnapshots y se calcula
        // ANTES del Promise.all: devolver ceros acá tiraba un dato que ya estaba
        // en memoria.
        expect(whiteboard).toMatch(/costMtdUSD: Number\(currentMonth\.totalUSD/);
        expect(whiteboard).not.toMatch(/fuente\("costFigures", \{\s*costMtdUSD: 0/);
    });

    it("el ensamblado loguea el monto, no sólo el tiempo", () => {
        // Sin el valor en el log, un $0.00 en pantalla no distingue "Cost
        // Management falló" de "el respaldo filtró mal".
        expect(whiteboard).toMatch(/costMtd=\$\{/);
    });
});

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");
const sin = (p: string) =>
    readFileSync(join(RAIZ, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("la proyección a fin de mes sale de Azure, no de una regla de tres", () => {
    const ruta = sin("src/app/api/intelligence/whiteboard/route.ts");

    // El KPI decía (MTD / díasTranscurridos) * díasDelMes: un número plausible
    // que NO coincide con el que el cliente ve en Cost Management, que es contra
    // el que lo compara.
    it("consulta el pronóstico de Cost Management", () => {
        expect(ruta).toContain("getCostForecast(tenantId");
    });

    it("no cuenta dos veces el día en curso", () => {
        // El pronóstico de Azure arranca HOY y el MTD ya incluye lo de hoy.
        expect(ruta).toMatch(/filter\(\(p\) => p\.date > hoy\)/);
    });

    it("si Azure no responde queda la lineal, no un cero", () => {
        expect(ruta).toContain("forecastLinealUSD");
        expect(ruta).toMatch(/let forecastEomUSD = forecastLinealUSD/);
    });

    it("dice de dónde salió el número", () => {
        expect(ruta).toMatch(/forecastSource: "azure" \| "lineal"/);
    });
});

describe("el gráfico del Resumen Ejecutivo no se reanima en cada render", () => {
    const widget = sin("src/components/dashboard/WhiteboardForecastWidget.tsx");

    // MEJ-02: la animación de Recharts corre sobre requestAnimationFrame y
    // arranca de cero en cada render. Dentro del grid del Resumen Ejecutivo eso
    // se ve como un parpadeo continuo.
    it("todas las series tienen la animación apagada", () => {
        const series = (widget.match(/<Area\b/g) || []).length;
        const apagadas = (widget.match(/isAnimationActive=\{false\}/g) || []).length;
        expect(series).toBeGreaterThan(0);
        expect(apagadas).toBe(series);
    });
});

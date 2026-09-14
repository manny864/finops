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

    // Estuvo DENTRO de `getCostFigures`, o sea bajo el techo de esa fuente: se
    // comía los 25 s, la degradaba entera y se perdía el costo del mes. Como
    // fuente propia, su techo sólo lo afecta a él.
    it("es una fuente del ensamblado, no parte de costFigures", () => {
        expect(ruta).toMatch(/fuente\(\s*"forecastAzure"/);
        const getCostFigures = ruta.slice(ruta.indexOf("async function getCostFigures"), ruta.indexOf("async function getTop5CostGroups"));
        expect(getCostFigures, "getCostFigures no puede llamar a Azure").not.toContain("getCostForecast");
    });

    it("el techo del pronóstico deja esperar a un Azure throttleado", () => {
        // Con 8 s degradaba siempre y el EOM caía a la lineal: 551,87 contra los
        // 800,01 que mostraba el portal.
        expect(ruta).toMatch(/"forecastAzure"[\s\S]{0,220}25_000/);
    });

    it("si Azure no responde queda la lineal, no un cero", () => {
        // `costFigures` siempre trae la lineal; el ensamblado la pisa sólo si la
        // fuente de Azure respondió.
        expect(ruta).toContain("forecastLinealUSD");
        expect(ruta).toMatch(/const forecastEomUSD = forecastLinealUSD/);
        expect(ruta).toMatch(/if \(pronosticoAzure\.length > 0\)/);
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

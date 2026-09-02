import { describe, it, expect } from "vitest";
import { computeWasteMetrics } from "@/app/api/dashboard/summary/route";

const item = (potentialSavings: number, issueType: "cost" | "governance") => ({
    type: "disk", potentialSavings, issueType,
    savingsSource: "cost_management" as const,
});

describe("computeWasteMetrics — MEJ-04", () => {
    // El corazón de la mejora: antes el Whiteboard alimentaba el KPI de
    // desperdicio de zombies con el total, que incluye hallazgos de gobernanza.
    it("separa el desperdicio de costo de los hallazgos de gobernanza", () => {
        const r = computeWasteMetrics([
            item(100, "cost"),
            item(50, "cost"),
            item(30, "governance"),
        ]);
        expect(r.detectedWasteUSD).toBe(180);
        expect(r.zombieMonthlyWasteUSD).toBe(150);
    });

    it("son el mismo número cuando no hay hallazgos de gobernanza", () => {
        const r = computeWasteMetrics([item(40, "cost")]);
        expect(r.detectedWasteUSD).toBe(40);
        expect(r.zombieMonthlyWasteUSD).toBe(40);
    });

    // Un tenant con sólo hallazgos de gobernanza tiene desperdicio detectado
    // pero cero dinero quemado: mostrar 0 en el KPI de zombies es lo correcto.
    it("da 0 de desperdicio de zombies si todo es gobernanza", () => {
        const r = computeWasteMetrics([item(30, "governance"), item(10, "governance")]);
        expect(r.detectedWasteUSD).toBe(40);
        expect(r.zombieMonthlyWasteUSD).toBe(0);
    });

    it("no rompe con una lista vacía ni con savings no numérico", () => {
        expect(computeWasteMetrics([])).toEqual({ detectedWasteUSD: 0, zombieMonthlyWasteUSD: 0 });
        const r = computeWasteMetrics([{ ...item(0, "cost"), potentialSavings: undefined } as any]);
        expect(r.detectedWasteUSD).toBe(0);
    });
});

describe("compatibilidad hacia atrás de la serie histórica", () => {
    // La nota de MEJ-04: los snapshots anteriores no tienen el campo. El lector
    // cae a `totalSavings`, que es de donde salía antes, para no cortar la
    // serie de 12 meses el día del despliegue.
    const readWaste = (payload: any) => Number(payload?.detectedWasteUSD ?? payload?.totalSavings) || 0;

    it("un punto viejo (sin detectedWasteUSD) se sigue leyendo", () => {
        expect(readWaste({ totalSavings: 120 })).toBe(120);
    });

    it("un punto nuevo prefiere la métrica propia", () => {
        expect(readWaste({ totalSavings: 120, detectedWasteUSD: 118 })).toBe(118);
    });

    // `??` y no `||`: un desperdicio de 0 es un dato válido (no queda nada por
    // limpiar) y no debe caer al valor viejo.
    it("un desperdicio de 0 no cae al campo viejo", () => {
        expect(readWaste({ totalSavings: 120, detectedWasteUSD: 0 })).toBe(0);
    });

    it("un punto sin ninguno de los dos da 0 en vez de NaN", () => {
        expect(readWaste({})).toBe(0);
    });

    // El bug real: el snapshot se escribe también cuando la respuesta viene de
    // caché, y una cacheada de antes del cambio no trae los campos nuevos. Si
    // el escritor pusiera `0` en vez de `null`, el `??` no caería a
    // `totalSavings` y el día mostraría $0 teniendo desperdicio real.
    it("un null escrito por el snapshot cae a totalSavings, un 0 NO caería", () => {
        expect(readWaste({ totalSavings: 188.46, detectedWasteUSD: null })).toBe(188.46);
        // Contraste explícito de por qué se escribe null y no 0:
        expect(readWaste({ totalSavings: 188.46, detectedWasteUSD: 0 })).toBe(0);
    });
});

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { zScore, Z_SCORE_MAX, detectAnomalies } from "@/services/anomalyDetectionService";

describe("zScore — desborde de DECIMAL(10,4)", () => {
    it("acota el cociente cuando la desviacion es diminuta pero no cero", () => {
        // El caso real que rompio produccion: una suscripcion que gasta casi lo
        // mismo todos los dias tiene stdDev del orden de 1e-5. Sin acotar, el
        // INSERT muere con "Out of range value for column 'z_score'" y se lleva
        // el tenant entero de la corrida.
        const z = zScore(100, 10, 0.00002);
        expect(z).toBe(Z_SCORE_MAX);
        // Lo que importa: entra en DECIMAL(10,4).
        expect(Math.abs(z)).toBeLessThan(1_000_000);
    });

    it("los infinitos y el NaN salen acotados", () => {
        expect(zScore(100, 10, Number.MIN_VALUE)).toBe(Z_SCORE_MAX);
        expect(zScore(1, 10, Number.MIN_VALUE)).toBe(-Z_SCORE_MAX);
        // NaN no compara contra ningun umbral: sin este 0 explicito se colaria
        // como "sin anomalia" sin que nada avise.
        expect(zScore(NaN, 10, 2)).toBe(0);
        expect(zScore(100, 10, NaN)).toBe(0);
        expect(zScore(100, 10, 0)).toBe(0);
    });

    it("no toca los valores normales", () => {
        expect(zScore(30, 10, 5)).toBe(4);
        expect(zScore(0, 10, 5)).toBe(-2);
    });

    it("la anomalia sobre una serie plana se sigue detectando, no se descarta", () => {
        // Recortar y no filtrar: un salto sobre una serie plana ES una anomalia
        // real, y perderla seria peor que reportarla con el numero tapado.
        const found = detectAnomalies(
            [{ date: "2026-09-01", amount: 100 }] as any,
            10, 0.00002, "sub-1", 2.5
        );
        expect(found).toHaveLength(1);
        expect(found[0].z_score).toBe(Z_SCORE_MAX);
    });
});

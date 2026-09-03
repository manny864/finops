// @vitest-environment node
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";

/**
 * Reproduce el guard de CurrencyProvider.toDecimal sin montar React.
 *
 * El bug: `new Decimal(undefined)` lanza `[DecimalError] Invalid argument`, y
 * como `format()` corre en render, un solo campo faltante en una respuesta de
 * API tumbaba el árbol de React entero — la página quedaba en blanco. Pasó en
 * /intelligence/consumo-y-presupuesto/por-categoria.
 */
const toDecimal = (amountUSD: unknown): Decimal => {
    const n = typeof amountUSD === "string" ? Number(amountUSD) : amountUSD;
    if (typeof n !== "number" || !Number.isFinite(n)) return new Decimal(0);
    return new Decimal(n);
};

describe("CurrencyProvider — un importe faltante no debe romper el render", () => {
    it("undefined y null dan 0 en vez de lanzar", () => {
        expect(toDecimal(undefined).toNumber()).toBe(0);
        expect(toDecimal(null).toNumber()).toBe(0);
    });

    it("NaN e Infinity dan 0: Decimal los acepta pero rompen el formateo después", () => {
        expect(toDecimal(NaN).toNumber()).toBe(0);
        expect(toDecimal(Infinity).toNumber()).toBe(0);
    });

    it("un string no numérico da 0 en vez de lanzar", () => {
        expect(toDecimal("").toNumber()).toBe(0);
        expect(toDecimal("N/A").toNumber()).toBe(0);
    });

    it("los valores válidos siguen intactos, incluido el 0 y los negativos", () => {
        expect(toDecimal(184.51).toNumber()).toBe(184.51);
        expect(toDecimal("42.75").toNumber()).toBe(42.75);
        expect(toDecimal(0).toNumber()).toBe(0);
        expect(toDecimal(-13.2).toNumber()).toBe(-13.2);
    });

    // El motivo del guard: sin él, esto es lo que pasaba.
    it("confirma que new Decimal(undefined) sí lanza", () => {
        expect(() => new Decimal(undefined as any)).toThrow(/Invalid argument/);
    });
});

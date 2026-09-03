// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parsePaddleUnitPrice } from "@/services/paddlePrices.service";

/**
 * `unit_price.amount` viene de Paddle como string en la denominación MÍNIMA y,
 * según su propia doc, "debe ser un entero válido" ("10 USD = 1000").
 *
 * Estos tests existen por una razón concreta: en este camino, un parseo
 * permisivo no lanza nada, devuelve un precio equivocado y el error se ve
 * recién en la factura del cliente. Es preferible `null` --que hace caer al
 * catálogo, un número viejo pero no inventado-- antes que un número plausible
 * y falso.
 */
describe("parsePaddleUnitPrice", () => {
    it("convierte los centavos al monto real", () => {
        expect(parsePaddleUnitPrice({ amount: "29999", currency_code: "USD" })).toEqual({
            amount: 299.99,
            currency: "USD",
        });
        expect(parsePaddleUnitPrice({ amount: "316788", currency_code: "USD" })).toEqual({
            amount: 3167.88,
            currency: "USD",
        });
        expect(parsePaddleUnitPrice({ amount: "1055988", currency_code: "USD" })).toEqual({
            amount: 10559.88,
            currency: "USD",
        });
    });

    // En estas divisas la denominación mínima ES la unidad. Dividir por 100
    // haría que 1000 JPY se muestren como 10.
    it("no divide las divisas sin decimales", () => {
        expect(parsePaddleUnitPrice({ amount: "1000", currency_code: "JPY" })).toEqual({
            amount: 1000,
            currency: "JPY",
        });
        expect(parsePaddleUnitPrice({ amount: "45000", currency_code: "clp" })).toEqual({
            amount: 45000,
            currency: "CLP",
        });
    });

    /**
     * El caso que motiva el regex. Si Paddle devolviera el monto ya en unidades
     * mayores, dividir por 100 daría 2.9999 — un precio 100 veces menor, sin
     * ninguna excepción y con pinta de número válido.
     */
    it("rechaza un monto con decimales en vez de dividirlo", () => {
        expect(parsePaddleUnitPrice({ amount: "299.99", currency_code: "USD" })).toBeNull();
    });

    it("rechaza formas inesperadas en lugar de adivinar", () => {
        expect(parsePaddleUnitPrice(null)).toBeNull();
        expect(parsePaddleUnitPrice(undefined)).toBeNull();
        expect(parsePaddleUnitPrice("29999")).toBeNull();
        expect(parsePaddleUnitPrice({})).toBeNull();
        // amount numérico: Paddle lo manda como string, un number es otra API
        expect(parsePaddleUnitPrice({ amount: 29999, currency_code: "USD" })).toBeNull();
        expect(parsePaddleUnitPrice({ amount: "29999" })).toBeNull();
        expect(parsePaddleUnitPrice({ amount: "29999", currency_code: "DOLARES" })).toBeNull();
        expect(parsePaddleUnitPrice({ amount: "", currency_code: "USD" })).toBeNull();
        expect(parsePaddleUnitPrice({ amount: "-29999", currency_code: "USD" })).toBeNull();
    });

    it("el cero es un monto válido (plan gratuito), no una forma inválida", () => {
        expect(parsePaddleUnitPrice({ amount: "0", currency_code: "USD" })).toEqual({
            amount: 0,
            currency: "USD",
        });
    });
});

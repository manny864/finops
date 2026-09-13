// @vitest-environment node
import { describe, it, expect } from "vitest";
import { montoLegible } from "@/components/admin/ChangePlanModal";

/**
 * Camino de dinero: es el numero que el modal le promete al cliente antes de
 * confirmar el cambio de plan, y tiene que coincidir con lo que Paddle cobra.
 */
describe("el prorrateo que muestra el modal", () => {
    it("convierte la denominacion minima de Paddle", () => {
        // Paddle: "10 USD = 1000". 12345 minimos = 123,45.
        expect(montoLegible("12345", "USD", "en-US")).toBe("$123.45");
    });

    // Dividir siempre por 100 seria un error de 100x en una divisa sin decimales.
    it("respeta las divisas sin decimales", () => {
        expect(montoLegible("1000", "JPY", "en-US")).toBe("¥1,000");
    });

    it("muestra el credito en positivo: el signo lo pone el texto", () => {
        expect(montoLegible("-5000", "USD", "en-US")).toBe("$50.00");
    });

    it("sin monto no inventa un cero", () => {
        expect(montoLegible(null, "USD", "en-US")).toBeNull();
        expect(montoLegible("", "USD", "en-US")).toBeNull();
        expect(montoLegible("no-es-un-numero", "USD", "en-US")).toBeNull();
    });
});

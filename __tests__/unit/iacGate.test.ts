// @vitest-environment node
import { describe, it, expect } from "vitest";
import { contextoDePresupuesto, evaluarGate, type FilaGate } from "@/services/iacGate.service";

/**
 * La regla que decide si se rompe el build de un equipo: tiene que probarse sin
 * base de datos y en los bordes, que es donde un Budget Gate se equivoca.
 */
const fila = (usd: number | null, pct: number | null = null, centro: string | null = null): FilaGate =>
    ({ threshold_usd: usd, threshold_pct_of_remaining: pct, cost_center_name: centro });
const ctx = (mensual: number, gastado: number, delta: number) => contextoDePresupuesto({ centro: "C", mensual, gastado }, delta);

describe("contextoDePresupuesto", () => {
    it("calcula lo que queda y cuánto pesa el delta", () => {
        expect(ctx(5000, 1000, 500)).toEqual({
            cost_center: "C", monthly_usd: 5000, spent_usd: 1000, remaining_usd: 4000,
            delta_pct_of_budget: 10, delta_pct_of_remaining: 12.5,
        });
    });

    it("un centro pasado de presupuesto tiene restante negativo y no inventa un porcentaje", () => {
        const c = ctx(1000, 1500, 100);
        expect(c.remaining_usd).toBe(-500);
        expect(c.delta_pct_of_remaining).toBeNull();
    });

    it("un presupuesto en 0 no divide por cero", () => {
        expect(ctx(0, 0, 100).delta_pct_of_budget).toBeNull();
    });

    it("un PR que ahorra da porcentajes negativos", () => {
        expect(ctx(1000, 0, -100).delta_pct_of_budget).toBe(-10);
    });
});

describe("evaluarGate", () => {
    it("sin fila o sin ningún umbral no se evalúa", () => {
        expect(evaluarGate(null, 500, null).status).toBe("NOT_EVALUATED");
        expect(evaluarGate(fila(null, null, "C"), 500, ctx(1000, 0, 500)).status).toBe("NOT_EVALUATED");
    });

    it("por monto: el borde exacto pasa, un centavo más no", () => {
        expect(evaluarGate(fila(100), 100, null).status).toBe("OK");
        expect(evaluarGate(fila(100), 100.01, null)).toMatchObject({ status: "EXCEEDED", reason: "usd" });
    });

    it("un PR que ahorra nunca dispara el gate, ni con umbral 0", () => {
        expect(evaluarGate(fila(0), -50, null).status).toBe("OK");
        expect(evaluarGate(fila(0), 0, null).status).toBe("OK");
        expect(evaluarGate(fila(0), 0.01, null).status).toBe("EXCEEDED");
    });

    it("por porcentaje: se mide contra lo que queda", () => {
        const c = ctx(5000, 1000, 2000); // quedan 4000
        expect(evaluarGate(fila(null, 50), 2000, c).status).toBe("OK");        // 50% de 4000 = 2000: borde
        expect(evaluarGate(fila(null, 50), 2000.01, c)).toMatchObject({ status: "EXCEEDED", reason: "pct" });
    });

    it("sin nada que quede, cualquier aumento supera el porcentaje y un ahorro no", () => {
        const c = ctx(1000, 1000, 10);
        expect(evaluarGate(fila(null, 100), 10, c)).toMatchObject({ status: "EXCEEDED", reason: "pct" });
        expect(evaluarGate(fila(null, 100), -10, c).status).toBe("OK");
        expect(evaluarGate(fila(null, 100), 0, c).status).toBe("OK");
    });

    it("sin presupuesto el porcentaje no se evalúa; si hay monto, manda el monto", () => {
        expect(evaluarGate(fila(null, 50), 9999, null).status).toBe("NOT_EVALUATED");
        expect(evaluarGate(fila(100, 50), 50, null).status).toBe("OK");
        expect(evaluarGate(fila(100, 50), 500, null)).toMatchObject({ status: "EXCEEDED", reason: "usd" });
    });

    it("con monto y porcentaje alcanza con que falle uno, y el monto se informa primero", () => {
        const c = ctx(5000, 1000, 3000);
        expect(evaluarGate(fila(5000, 50), 3000, c)).toMatchObject({ status: "EXCEEDED", reason: "pct" });
        expect(evaluarGate(fila(10, 90), 3000, c)).toMatchObject({ status: "EXCEEDED", reason: "usd" });
        expect(evaluarGate(fila(10, 10), 3000, c)).toMatchObject({ status: "EXCEEDED", reason: "usd" });
    });

    it("tolera valores que MySQL devuelve como texto o basura", () => {
        expect(evaluarGate({ threshold_usd: "100.0000" as any, threshold_pct_of_remaining: null, cost_center_name: null }, 50, null).status).toBe("OK");
        expect(evaluarGate({ threshold_usd: "abc" as any, threshold_pct_of_remaining: null, cost_center_name: null }, 50, null).status).toBe("NOT_EVALUATED");
    });
});

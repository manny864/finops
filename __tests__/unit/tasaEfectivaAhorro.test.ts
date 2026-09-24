// @vitest-environment node
import { describe, it, expect } from "vitest";
import { tasaEfectivaDeAhorro } from "@/services/savingsRate.service";

describe("tasaEfectivaDeAhorro (ESR)", () => {
    it("mide el ahorro contra el precio de lista", () => {
        const r = tasaEfectivaDeAhorro({
            listCost: 1000, effectiveCost: 750, gastoEvaluado: 750, gastoTotal: 750,
        });
        expect(r.esr).toBe(25);
        expect(r.ahorro).toBe(250);
        expect(r.cobertura).toBe(100);
    });

    it("sin precio de lista devuelve null y NO 0%", () => {
        // 0% es una afirmación sobre la cartera: "no estás ahorrando nada".
        // Es justo lo que decía el export antes de esta mejora, con ListCost
        // copiado de BilledCost. null dice "no lo sé", que es lo único cierto.
        const r = tasaEfectivaDeAhorro({
            listCost: 0, effectiveCost: 0, gastoEvaluado: 0, gastoTotal: 5000,
        });
        expect(r.esr).toBeNull();
        expect(r.cobertura).toBe(0);
        expect(r.gastoTotal).toBe(5000);
    });

    it("informa sobre qué parte del gasto se calculó", () => {
        // El número sale del 20% de la factura; sin este dato se lee como si
        // cubriera toda.
        const r = tasaEfectivaDeAhorro({
            listCost: 1000, effectiveCost: 600, gastoEvaluado: 600, gastoTotal: 3000,
        });
        expect(r.esr).toBe(40);
        expect(r.cobertura).toBe(20);
    });

    it("el gasto sin precio de lista no diluye la tasa", () => {
        // Las dos carteras ahorran lo mismo sobre lo medible; la segunda sólo
        // tiene más gasto sin valorizar. El ESR tiene que dar igual y lo que
        // cambia es la cobertura.
        const a = tasaEfectivaDeAhorro({ listCost: 1000, effectiveCost: 700, gastoEvaluado: 700, gastoTotal: 700 });
        const b = tasaEfectivaDeAhorro({ listCost: 1000, effectiveCost: 700, gastoEvaluado: 700, gastoTotal: 9000 });
        expect(a.esr).toBe(b.esr);
        expect(a.cobertura).toBe(100);
        expect(b.cobertura).toBe(7.78);
    });

    it("no recorta un ESR negativo", () => {
        // Pagar por encima del precio de lista es señal de datos mal cargados.
        // Mostrar 0% lo escondería.
        const r = tasaEfectivaDeAhorro({ listCost: 100, effectiveCost: 120, gastoEvaluado: 120, gastoTotal: 120 });
        expect(r.esr).toBe(-20);
    });

    it("no se rompe sin datos", () => {
        const r = tasaEfectivaDeAhorro({ listCost: 0, effectiveCost: 0, gastoEvaluado: 0, gastoTotal: 0 });
        expect(r.esr).toBeNull();
        expect(r.cobertura).toBe(0);
        expect(r.ahorro).toBe(0);
    });
});

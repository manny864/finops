// @vitest-environment node
/**
 * MEJ-36 — el año fiscal del tenant y el arrastre de presupuesto.
 *
 * El caso que motivó esto: con el ejercicio arrancando en abril, los acumulados
 * anuales de la plataforma estaban corridos tres meses y nada lo decía. El
 * criterio de aceptación lo fija en una frase — "con año fiscal en abril, el
 * acumulado anual de mayo cuenta DOS meses y no cinco"— y ese es el primer test.
 */
import { describe, it, expect } from "vitest";
import {
    rangoDelAnioFiscal, rangoDelAnioFiscalAnterior, arrastreDelMes, mesFiscalValido,
} from "@/lib/fiscalYear";

const el = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("rangoDelAnioFiscal", () => {
    it("con ejercicio en abril, el acumulado de mayo cuenta dos meses y no cinco", () => {
        const r = rangoDelAnioFiscal(4, el("2026-05-15"));
        expect(r.start).toBe("2026-04-01");
        expect(r.end).toBe("2027-03-31");
        // Del 1 de abril al 15 de mayo: 45 días, no los 135 que daría enero.
        expect(r.diasTranscurridos).toBe(45);
    });

    it("antes del mes de inicio, el ejercicio vigente es el que arrancó el año pasado", () => {
        // 15 de febrero con ejercicio en abril: estamos en el que empezó en 2025.
        const r = rangoDelAnioFiscal(4, el("2026-02-15"));
        expect(r.start).toBe("2025-04-01");
        expect(r.end).toBe("2026-03-31");
        expect(r.anio).toBe(2025);
    });

    it("enero se comporta exactamente como antes", () => {
        // El criterio 1 al revés: sin configurar nada, nada cambia.
        const r = rangoDelAnioFiscal(1, el("2026-09-26"));
        expect(r.start).toBe("2026-01-01");
        expect(r.end).toBe("2026-12-31");
        expect(r.anio).toBe(2026);
    });

    it("el ejercicio bisiesto dura 366 días", () => {
        // Arranca en marzo de 2027 y termina en febrero de 2028, que es bisiesto.
        expect(rangoDelAnioFiscal(3, el("2027-06-01")).diasTotales).toBe(366);
        expect(rangoDelAnioFiscal(3, el("2027-06-01")).end).toBe("2028-02-29");
    });

    it("el anterior es el mismo tramo corrido un año", () => {
        const a = rangoDelAnioFiscalAnterior(4, el("2026-05-15"));
        expect(a.start).toBe("2025-04-01");
        expect(a.end).toBe("2026-03-31");
    });

    it("un mes basura cae a enero en vez de reventar", () => {
        // Llega de la base y de la UI: mejor el comportamiento de siempre que un
        // rango inventado.
        for (const malo of [0, 13, -1, null, undefined, "abril", NaN]) {
            expect(mesFiscalValido(malo)).toBe(1);
        }
        expect(rangoDelAnioFiscal(99 as number, el("2026-05-15")).start).toBe("2026-01-01");
    });

    it("el primer día del ejercicio cuenta como un día, no cero", () => {
        // Es el divisor de la proyección: con cero, divide por cero.
        expect(rangoDelAnioFiscal(4, el("2026-04-01")).diasTranscurridos).toBe(1);
    });
});

describe("arrastreDelMes", () => {
    it("apagado, el comportamiento es idéntico al de hoy", () => {
        const r = arrastreDelMes(1000, [100, 200], { habilitado: false });
        expect(r).toEqual({ base: 1000, arrastre: 0, efectivo: 1000 });
    });

    it("lo no gastado se acumula a lo largo del ejercicio", () => {
        // Dos meses gastando 600 de 1000: arrastra 800.
        const r = arrastreDelMes(1000, [600, 600], { habilitado: true });
        expect(r.arrastre).toBe(800);
        expect(r.efectivo).toBe(1800);
    });

    it("un mes en rojo arrastra cero, no negativo", () => {
        // Endeudar al mes siguiente con el sobregiro del anterior es una decisión
        // financiera que nadie tomó.
        const r = arrastreDelMes(1000, [1500], { habilitado: true });
        expect(r.arrastre).toBe(0);
        expect(r.efectivo).toBe(1000);
    });

    it("el rojo no se lleva puesto lo que ya se había arrastrado más de la cuenta", () => {
        // Mes 1 deja 400; mes 2 gasta 2000 contra 1400 disponibles. El siguiente
        // arranca de cero, no de -600.
        const r = arrastreDelMes(1000, [600, 2000], { habilitado: true });
        expect(r.arrastre).toBe(0);
    });

    it("el tope se respeta en cada paso", () => {
        // Tres meses sin gastar nada de 800, con tope de 1000.
        const r = arrastreDelMes(800, [0, 0, 0], { habilitado: true, tope: 1000 });
        expect(r.arrastre).toBe(1000);
    });

    it("sin tope configurado, no hay tope", () => {
        const r = arrastreDelMes(800, [0, 0, 0], { habilitado: true, tope: null });
        expect(r.arrastre).toBe(2400);
    });

    it("el primer mes del ejercicio no arrastra nada", () => {
        expect(arrastreDelMes(1000, [], { habilitado: true }).arrastre).toBe(0);
    });
});

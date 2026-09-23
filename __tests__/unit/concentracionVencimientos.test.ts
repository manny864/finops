// @vitest-environment node
import { describe, it, expect } from "vitest";
import { concentracionDeVencimientos } from "@/services/commitmentRisk.service";

/** Lo mínimo que el cálculo mira de una reserva. */
const reserva = (name: string, expiryDate: string | null, status = "Succeeded") =>
    ({ name, expiryDate, status } as any);

describe("concentracionDeVencimientos", () => {
    it("pondera por valor y no por cantidad de reservas", () => {
        // El caso que justifica la métrica: tres reservas chicas en enero contra
        // una grande en marzo. Contando reservas, enero sería el riesgo; contando
        // valor, marzo se lleva el 70%.
        const r = concentracionDeVencimientos(
            [
                reserva("chica-1", "2027-01-15T00:00:00Z"),
                reserva("chica-2", "2027-01-20T00:00:00Z"),
                reserva("chica-3", "2027-01-25T00:00:00Z"),
                reserva("grande", "2027-03-10T00:00:00Z"),
            ],
            [
                { reservationName: "chica-1", cost: 100 },
                { reservationName: "chica-2", cost: 100 },
                { reservationName: "chica-3", cost: 100 },
                { reservationName: "grande", cost: 700 },
            ],
        );

        expect(r.valorMensualTotal).toBe(1000);
        expect(r.peorMes?.mes).toBe("2027-03");
        expect(r.peorMes?.porcentaje).toBe(70);
        // Enero tiene MÁS reservas y aun así no es el peor mes.
        expect(r.porMes.find((m) => m.mes === "2027-01")?.reservas).toBe(3);
    });

    it("no cuenta como cero lo que no pudo valorizar", () => {
        // Sumar 0 al mes de una reserva sin costo bajaría el porcentaje de
        // concentración: el riesgo se vería más chico de lo que es.
        const r = concentracionDeVencimientos(
            [reserva("conocida", "2027-05-01T00:00:00Z"), reserva("huerfana", "2027-05-02T00:00:00Z")],
            [{ reservationName: "conocida", cost: 500 }],
        );

        expect(r.sinValor).toBe(1);
        expect(r.valorMensualTotal).toBe(500);
        expect(r.peorMes?.porcentaje).toBe(100); // sobre lo que SÍ se pudo valorizar
    });

    it("informa las reservas sin fecha de vencimiento", () => {
        const r = concentracionDeVencimientos(
            [reserva("sin-fecha", null), reserva("fecha-rota", "no-es-fecha")],
            [{ reservationName: "sin-fecha", cost: 10 }, { reservationName: "fecha-rota", cost: 10 }],
        );
        expect(r.sinFecha).toBe(2);
        expect(r.porMes).toEqual([]);
    });

    it("ignora las ya vencidas: el golpe ya pasó", () => {
        const r = concentracionDeVencimientos(
            [reserva("vieja", "2020-01-01T00:00:00Z", "Expired"), reserva("viva", "2027-02-01T00:00:00Z")],
            [{ reservationName: "vieja", cost: 900 }, { reservationName: "viva", cost: 100 }],
        );
        expect(r.valorMensualTotal).toBe(100);
        expect(r.peorMes?.mes).toBe("2027-02");
    });

    it("la ventana de 3 meses es CORRIDA y cruza el fin de año", () => {
        // Un acantilado entre diciembre y enero sigue siendo un acantilado;
        // partirlo por trimestre de calendario lo escondería.
        const r = concentracionDeVencimientos(
            [reserva("a", "2027-12-10T00:00:00Z"), reserva("b", "2028-01-10T00:00:00Z"), reserva("c", "2028-09-01T00:00:00Z")],
            [{ reservationName: "a", cost: 400 }, { reservationName: "b", cost: 400 }, { reservationName: "c", cost: 200 }],
        );
        expect(r.peorVentana3m?.desde).toBe("2027-12");
        expect(r.peorVentana3m?.porcentaje).toBe(80);
    });

    it("no toma como ventana dos meses separados por uno vacío", () => {
        // Enero y abril no son contiguos: la peor ventana de 3 meses no puede
        // sumarlos, o cualquier cartera repartida parecería concentrada.
        const r = concentracionDeVencimientos(
            [reserva("a", "2027-01-10T00:00:00Z"), reserva("b", "2027-04-10T00:00:00Z")],
            [{ reservationName: "a", cost: 500 }, { reservationName: "b", cost: 500 }],
        );
        expect(r.peorVentana3m?.porcentaje).toBe(50);
    });

    it("une los nombres aunque difieran en mayúsculas y espacios", () => {
        // Microsoft.Capacity y Cost Management no siempre los devuelven igual.
        const r = concentracionDeVencimientos(
            [reserva("  Reserva-VM-Prod ", "2027-06-01T00:00:00Z")],
            [{ reservationName: "reserva-vm-prod", cost: 250 }],
        );
        expect(r.sinValor).toBe(0);
        expect(r.valorMensualTotal).toBe(250);
    });

    it("no se rompe sin datos", () => {
        for (const vacio of [null, undefined, []]) {
            const r = concentracionDeVencimientos(vacio as any, []);
            expect(r.valorMensualTotal).toBe(0);
            expect(r.peorMes).toBeNull();
            expect(r.peorVentana3m).toBeNull();
        }
    });
});

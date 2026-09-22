// @vitest-environment node
import { describe, it, expect } from "vitest";
import { precioMensualDesdeUnidad } from "@/services/pricingService";
import { HOURS_PER_MONTH } from "@/lib/aroUtils";

/**
 * El x730 incondicional inflaba 730 veces el costo de todo lo que Azure no
 * cobra por hora. Los valores de abajo NO son inventados: salen de consultar la
 * Retail API el 2026-09-22 (es publica y sin auth), asi que si Azure cambia la
 * unidad de un medidor, este test sigue describiendo lo que habia cuando se
 * escribio.
 *
 *   serviceName eq 'Storage' and armRegionName eq 'eastus'
 *     and priceType eq 'Consumption' and skuName eq 'P10 LRS'
 *   -> { retailPrice: 19.71, unitOfMeasure: "1/Month" }
 */
describe("precioMensualDesdeUnidad", () => {
    it("un disco P10 LRS vale 19,71 por mes y no 14.388", () => {
        expect(precioMensualDesdeUnidad(19.71, "1/Month")).toBeCloseTo(19.71, 4);
        // El bug viejo, explicito, para que se vea la magnitud:
        expect(19.71 * HOURS_PER_MONTH).toBeCloseTo(14388.3, 1);
    });

    it("lo que se cobra por hora si se multiplica por 730", () => {
        // VM Standard_D2s_v3 y una IP publica Standard: las dos "1 Hour".
        expect(precioMensualDesdeUnidad(0.096, "1 Hour")).toBeCloseTo(0.096 * 730, 4);
        expect(precioMensualDesdeUnidad(0.006, "1 Hour")).toBeCloseTo(4.38, 4);
    });

    it("divide por la cantidad cuando la unidad trae mas de una", () => {
        // "100 Hours" a 10 USD = 0,10/hora = 73 al mes.
        expect(precioMensualDesdeUnidad(10, "100 Hours")).toBeCloseTo(73, 4);
    });

    it("convierte unidades diarias", () => {
        expect(precioMensualDesdeUnidad(1, "1 Day")).toBeCloseTo(HOURS_PER_MONTH / 24, 4);
    });

    it("devuelve null cuando la unidad necesita una cantidad que no tenemos", () => {
        // Sin saber cuantos GB o cuantas operaciones, cualquier numero es
        // inventado. Null hace que el llamador use su propia estimacion.
        expect(precioMensualDesdeUnidad(0.02, "1 GB/Month")).toBeNull();
        expect(precioMensualDesdeUnidad(0.0004, "10K")).toBeNull();
        expect(precioMensualDesdeUnidad(1, "1 GB")).toBeNull();
        expect(precioMensualDesdeUnidad(1, "")).toBeNull();
        expect(precioMensualDesdeUnidad(1, null)).toBeNull();
    });

    it("no se rompe con un precio no numerico", () => {
        expect(precioMensualDesdeUnidad(NaN, "1 Hour")).toBeNull();
    });

    it("es indiferente a mayusculas y espacios", () => {
        expect(precioMensualDesdeUnidad(19.71, "  1/MONTH ")).toBeCloseTo(19.71, 4);
        expect(precioMensualDesdeUnidad(2, "1 HOUR")).toBeCloseTo(2 * HOURS_PER_MONTH, 4);
    });
});

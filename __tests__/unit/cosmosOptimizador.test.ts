// @vitest-environment node
import { describe, it, expect } from "vitest";
import { optimizarCosmos, TARIFAS_LISTA, RU_MINIMO } from "@/services/cosmosOptimizer.service";

const base = {
    mode: "manual" as const,
    provisionedRu: 10000,
    avgNormalizedRuPct: 20,
    p95NormalizedRuPct: 40,
    maxNormalizedRuPct: 65,
    totalRequestUnits: 70_000_000,
    diasMedidos: 7,
    dataUsageGb: 100,
};

describe("optimizarCosmos", () => {
    it("el costo del throughput sale de las RU medidas y la tarifa, no de un porcentaje", () => {
        // 10.000 RU/s x 0,008/100 por hora x 730 horas = 584 USD.
        const r = optimizarCosmos(base);
        expect(r.costoThroughputMensual).toBe(584);
        // 100 GB x 0,115 = 11,50. Antes el almacenamiento era "50 GB" fijo.
        expect(r.costoAlmacenamientoMensual).toBe(11.5);
    });

    it("dimensiona por el p95 con margen, no por el promedio", () => {
        // Dimensionar por el promedio (20%) dejaria la base corta en cada pico y
        // el cliente se comeria 429 en produccion.
        const r = optimizarCosmos(base);
        expect(r.ruSugerido).toBe(5000); // 10.000 x 40% x 1,25
        const reducir = r.decisiones.find((d) => d.clave === "reducir_ru_manual");
        expect(reducir?.ruRecomendado).toBe(5000);
        expect(reducir?.ahorroMensualUsd).toBe(292); // la mitad de 584
    });

    it("nunca recomienda por debajo del minimo de Azure", () => {
        const r = optimizarCosmos({ ...base, provisionedRu: 1000, p95NormalizedRuPct: 2 });
        expect(r.ruSugerido).toBe(RU_MINIMO);
    });

    it("no recomienda bajar cuando el p95 ya llena lo aprovisionado", () => {
        const r = optimizarCosmos({ ...base, p95NormalizedRuPct: 90 });
        expect(r.decisiones.find((d) => d.clave === "reducir_ru_manual")).toBeUndefined();
    });

    it("autoscale conviene con uso bajo y NO con uso alto", () => {
        // El umbral no es una constante elegida: sale del cociente de las dos
        // tarifas publicadas (0,012 / 0,008 = 1,5), o sea ~66% de uso medio.
        const bajo = optimizarCosmos({ ...base, avgNormalizedRuPct: 20 });
        expect(bajo.decisiones.some((d) => d.clave === "migrar_a_autoscale")).toBe(true);

        const alto = optimizarCosmos({ ...base, avgNormalizedRuPct: 80, p95NormalizedRuPct: 95 });
        expect(alto.decisiones.some((d) => d.clave === "migrar_a_autoscale")).toBe(false);
    });

    it("autoscale nunca factura menos del 10% del techo", () => {
        // Con 1% de uso medio, el ahorro no puede calcularse como 1%: el piso de
        // facturacion de autoscale es el 10% del maximo configurado.
        const r = optimizarCosmos({ ...base, avgNormalizedRuPct: 1, p95NormalizedRuPct: 3 });
        const auto = r.decisiones.find((d) => d.clave === "migrar_a_autoscale")!;
        // 584 - (584 x 0,10 x 1,5) = 584 - 87,60
        expect(auto.ahorroMensualUsd).toBe(496.4);
    });

    it("serverless se decide con las RU consumidas, no con el aprovisionado", () => {
        // 5.000 RU/s = 292 USD de provisionado. 70M RU en 7 dias = 300M al mes
        // = 75 USD de serverless. Pico 5.000 x 60% = 3.000 RU/s, entra.
        const r = optimizarCosmos({ ...base, provisionedRu: 5000, maxNormalizedRuPct: 60 });
        const sl = r.decisiones.find((d) => d.clave === "migrar_a_serverless")!;
        expect(sl.ahorroMensualUsd).toBe(217);
    });

    it("el techo de serverless se mide contra el PICO REAL, no contra lo aprovisionado", () => {
        // Aprovisionadas 10.000 pero nunca pasa de 1.000: entra en serverless.
        // Mirar el techo configurado la descartaria justo por el defecto que se
        // quiere corregir.
        const holgado = optimizarCosmos({ ...base, provisionedRu: 10000, maxNormalizedRuPct: 10 });
        expect(holgado.decisiones.some((d) => d.clave === "migrar_a_serverless")).toBe(true);

        // Pico 10.000 x 65% = 6.500 RU/s: no entra, aunque el numero cierre.
        // Recomendarla mandaria al cliente a una pared.
        const apretado = optimizarCosmos(base);
        expect(apretado.decisiones.some((d) => d.clave === "migrar_a_serverless")).toBe(false);
    });

    it("sin pico medido no se opina sobre serverless", () => {
        const r = optimizarCosmos({ ...base, provisionedRu: 5000, maxNormalizedRuPct: null });
        expect(r.decisiones.some((d) => d.clave === "migrar_a_serverless")).toBe(false);
    });

    it("sin telemetria no inventa ninguna decision", () => {
        const r = optimizarCosmos({
            mode: "unknown", provisionedRu: null, avgNormalizedRuPct: null,
            p95NormalizedRuPct: null, maxNormalizedRuPct: null, totalRequestUnits: null,
            diasMedidos: 7, dataUsageGb: null,
        });
        expect(r.decisiones).toEqual([]);
        expect(r.costoThroughputMensual).toBeNull();
        expect(r.sinDatos).toBe(true);
    });

    it("las tarifas de respaldo son las verificadas contra la Retail API", () => {
        expect(TARIFAS_LISTA.provisionadoPorRuHora * 100).toBeCloseTo(0.008, 6);
        expect(TARIFAS_LISTA.autoscalePorRuHora * 100).toBeCloseTo(0.012, 6);
        expect(TARIFAS_LISTA.serverlessPorMillonRu).toBe(0.25);
        // 0,115 y no 0: el medidor `Data Stored` de Azure Cosmos DB cotiza cero
        // y el bueno es `General Purpose Storage Data Stored` de Azure DocumentDB.
        expect(TARIFAS_LISTA.almacenamientoPorGbMes).toBe(0.115);
    });
});

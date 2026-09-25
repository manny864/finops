// @vitest-environment node
import { describe, it, expect } from "vitest";
import { percentil95, detectarParticionCaliente, metricasVacias, leerSeries } from "@/services/cosmosMetrics.service";

describe("percentil95", () => {
    it("con pocas muestras devuelve el maximo y no interpola", () => {
        // Interpolar sobre 5 puntos da un numero con mas precision aparente que
        // la que hay. El maximo es conservador y no miente.
        expect(percentil95([10, 20, 30, 40, 50])).toBe(50);
    });

    it("con muestras suficientes deja afuera la cola alta", () => {
        const v = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(percentil95(v)).toBe(95);
    });

    it("sin muestras devuelve null, no cero", () => {
        expect(percentil95([])).toBeNull();
    });
});

describe("detectarParticionCaliente", () => {
    it("una sola particion NUNCA es caliente", () => {
        // Con una sola, el 100% del consumo esta ahi por definicion: no es
        // desbalance, es aritmetica. Marcarla dispararia una alarma en toda
        // coleccion chica.
        const r = detectarParticionCaliente([{ partitionId: "0", avgNormalizedRuPct: 90, maxNormalizedRuPct: 99 }]);
        expect(r.esCaliente).toBe(false);
        expect(r.concentracionPct).toBeNull();
    });

    it("detecta la que concentra el consumo", () => {
        const r = detectarParticionCaliente([
            { partitionId: "0", avgNormalizedRuPct: 80, maxNormalizedRuPct: 100 },
            { partitionId: "1", avgNormalizedRuPct: 5, maxNormalizedRuPct: 9 },
            { partitionId: "2", avgNormalizedRuPct: 5, maxNormalizedRuPct: 8 },
        ]);
        expect(r.esCaliente).toBe(true);
        expect(r.partitionId).toBe("0");
        expect(r.concentracionPct).toBe(88.89);
    });

    it("alto pero parejo NO es hot partition", () => {
        // Tres particiones al 75% es una coleccion al limite de su throughput,
        // que es otro problema: repartir la clave no lo arregla. Marcarlo como
        // hot partition manda a rediseñar el particionado sin motivo.
        const r = detectarParticionCaliente([
            { partitionId: "0", avgNormalizedRuPct: 75, maxNormalizedRuPct: 90 },
            { partitionId: "1", avgNormalizedRuPct: 73, maxNormalizedRuPct: 88 },
            { partitionId: "2", avgNormalizedRuPct: 71, maxNormalizedRuPct: 85 },
        ]);
        expect(r.esCaliente).toBe(false);
    });

    it("no se rompe sin particiones ni con todo en cero", () => {
        expect(detectarParticionCaliente([]).esCaliente).toBe(false);
        expect(
            detectarParticionCaliente([
                { partitionId: "0", avgNormalizedRuPct: 0, maxNormalizedRuPct: 0 },
                { partitionId: "1", avgNormalizedRuPct: 0, maxNormalizedRuPct: 0 },
            ]).esCaliente
        ).toBe(false);
    });
});

describe("metricasVacias", () => {
    it("todo en null y ningun cero disfrazado", () => {
        // Un 0 en throttling se lee como "medido y sano". El default tiene que
        // ser "no sabemos" en los doce campos.
        const m = metricasVacias();
        for (const [clave, valor] of Object.entries(m)) {
            expect(valor, `${clave} deberia ser null`).toBeNull();
        }
    });
});

describe("leerSeries — la forma de la respuesta de Azure Monitor", () => {
    // Fixture con la forma que documenta Azure: value[].name.value para el
    // nombre y timeseries[].data[] con una clave por agregación pedida. Sin
    // esto, un campo mal escrito acá devolvería series vacías y TODO saldría
    // null, que en pantalla se lee igual que "este cliente no tiene datos".
    const respuesta = {
        value: [
            {
                id: "/subscriptions/x/.../providers/Microsoft.Insights/metrics/NormalizedRUConsumption",
                name: { value: "NormalizedRUConsumption", localizedValue: "Normalized RU Consumption" },
                unit: "Percent",
                timeseries: [
                    {
                        metadatavalues: [{ name: { value: "physicalPartitionId" }, value: "0" }],
                        data: [
                            { timeStamp: "2026-09-24T00:00:00Z", average: 12.5, maximum: 40 },
                            { timeStamp: "2026-09-24T01:00:00Z", average: 15.5, maximum: 60 },
                            // Azure omite las claves de los intervalos sin dato:
                            // no vienen en 0, directamente no vienen.
                            { timeStamp: "2026-09-24T02:00:00Z" },
                        ],
                    },
                ],
            },
            {
                name: { value: "ProvisionedThroughput", localizedValue: "Provisioned Throughput" },
                unit: "Count",
                timeseries: [{ metadatavalues: [], data: [{ timeStamp: "2026-09-24T00:00:00Z", maximum: 10000 }] }],
            },
        ],
    };

    it("indexa por el nombre REST de la metrica", () => {
        const series = leerSeries(respuesta);
        expect([...series.keys()].sort()).toEqual(["NormalizedRUConsumption", "ProvisionedThroughput"]);
    });

    it("junta cada agregacion por separado y saltea los intervalos vacios", () => {
        const s = leerSeries(respuesta).get("NormalizedRUConsumption")!;
        expect(s.average).toEqual([12.5, 15.5]);
        expect(s.maximum).toEqual([40, 60]);
        expect(s.total).toEqual([]);
    });

    it("una respuesta vacia o rota no explota", () => {
        expect(leerSeries(null).size).toBe(0);
        expect(leerSeries({ value: [{ timeseries: null }] }).size).toBe(0);
    });
});

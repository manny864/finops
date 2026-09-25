import type { CosmosThroughputMode } from "@/types/cosmosDb";

/**
 * MEJ-18 — las tres decisiones del cockpit de Cosmos: bajar RU/s, pasar a
 * autoscale o pasar a serverless.
 *
 * TODO NÚMERO DE ACÁ SALE DE ALGO MEDIDO O DE UNA TARIFA PUBLICADA. Es la
 * diferencia con lo que había antes, que calculaba el ahorro como
 * `costo * 0.65` con el 0,65 escrito a mano.
 */

/** Mínimo de RU/s que Azure permite aprovisionar en un contenedor. */
export const RU_MINIMO = 400;

/**
 * Tarifas de Cosmos DB, verificadas contra la Retail Prices API el 2026-09-25
 * (eastus, priceType Consumption). Se usan como respaldo cuando la API no
 * responde, y el resultado dice cuál de las dos fuentes se aplicó.
 *
 * CUIDADO CON EL NOMBRE DEL MEDIDOR, que acá vuelve a morder: el medidor
 * `Data Stored` de `Azure Cosmos DB` cotiza **0,00** —es la fila del tramo
 * gratuito—. El almacenamiento transaccional real es
 * `General Purpose Storage Data Stored`, del producto `Azure DocumentDB`.
 * Filtrar sólo por `meterName` habría dado costo de almacenamiento cero.
 */
export const TARIFAS_LISTA: TarifasCosmos = {
    // "100 RU/s" · Azure Cosmos DB · 1/Hour
    provisionadoPorRuHora: 0.008 / 100,
    // "AP1 100 RUs" · Azure Cosmos DB autoscale · 1/Hour (1,5x el provisionado)
    autoscalePorRuHora: 0.012 / 100,
    // "1M RUs" · Azure Cosmos DB serverless
    serverlessPorMillonRu: 0.25,
    // "General Purpose Storage Data Stored" · Azure DocumentDB · 1 GB/Month
    almacenamientoPorGbMes: 0.115,
    fuente: "lista-verificada-2026-09",
};

export interface TarifasCosmos {
    provisionadoPorRuHora: number;
    autoscalePorRuHora: number;
    serverlessPorMillonRu: number;
    almacenamientoPorGbMes: number;
    fuente: "retail-api" | "lista-verificada-2026-09";
}

const HORAS_MES = 730;

export interface EntradaOptimizacion {
    mode: CosmosThroughputMode;
    provisionedRu: number | null;
    avgNormalizedRuPct: number | null;
    p95NormalizedRuPct: number | null;
    maxNormalizedRuPct: number | null;
    /** RU consumidas en la ventana medida. */
    totalRequestUnits: number | null;
    diasMedidos: number;
    dataUsageGb: number | null;
    tarifas?: TarifasCosmos;
}

export type ClaveDecision =
    | "reducir_ru_manual"
    | "migrar_a_autoscale"
    | "migrar_a_serverless";

export interface Decision {
    clave: ClaveDecision;
    /** RU/s sugeridas. null cuando la decisión no es de dimensionamiento. */
    ruRecomendado: number | null;
    ahorroMensualUsd: number;
    /** Qué se comparó, en texto corto, para que el número sea auditable. */
    base: string;
}

export interface ResultadoOptimizacion {
    decisiones: Decision[];
    /** Costo mensual del throughput hoy, a tarifa. null si no se midió RU/s. */
    costoThroughputMensual: number | null;
    costoAlmacenamientoMensual: number | null;
    /** RU/s que cubrirían el p95 con margen. null si no hay p95. */
    ruSugerido: number | null;
    /** Por qué no se pudo decidir, cuando no hay decisiones y tampoco datos. */
    sinDatos: boolean;
}

function redondear2(v: number): number {
    return Math.round(v * 100) / 100;
}

/** Azure aprovisiona de a 100 RU/s; se redondea hacia ARRIBA para no quedar corto. */
function a100(ru: number): number {
    return Math.max(RU_MINIMO, Math.ceil(ru / 100) * 100);
}

/**
 * Margen sobre el p95. 25% es deliberadamente generoso: el costo de quedarse
 * corto —throttling 429 en producción— es mucho mayor que el de dejar algo de
 * RU sin usar, y esta recomendación la va a aplicar alguien que no vio los
 * datos.
 */
export const MARGEN = 1.25;

export function optimizarCosmos(e: EntradaOptimizacion): ResultadoOptimizacion {
    const t = e.tarifas || TARIFAS_LISTA;
    const decisiones: Decision[] = [];

    const almacenamiento =
        e.dataUsageGb !== null && e.dataUsageGb !== undefined
            ? redondear2(e.dataUsageGb * t.almacenamientoPorGbMes)
            : null;

    const ru = e.provisionedRu;
    const p95 = e.p95NormalizedRuPct;
    const avg = e.avgNormalizedRuPct;

    // Sin RU/s aprovisionadas medidas no se puede decidir NADA de
    // dimensionamiento: ni el costo del throughput ni el ahorro de bajarlo.
    const costoThroughput =
        ru !== null && ru > 0 ? redondear2(ru * t.provisionadoPorRuHora * HORAS_MES) : null;

    const ruSugerido = ru !== null && p95 !== null ? a100((ru * p95) / 100 * MARGEN) : null;

    if (ru !== null && costoThroughput !== null && p95 !== null && ruSugerido !== null) {
        // 1) Bajar el aprovisionado. Sólo si sobra de verdad: con el margen ya
        //    aplicado, si el sugerido no baja al menos un escalón no hay nada
        //    que recomendar.
        if (e.mode === "manual" && ruSugerido < ru) {
            const ahorro = redondear2((ru - ruSugerido) * t.provisionadoPorRuHora * HORAS_MES);
            if (ahorro > 0) {
                decisiones.push({
                    clave: "reducir_ru_manual",
                    ruRecomendado: ruSugerido,
                    ahorroMensualUsd: ahorro,
                    base: `p95 ${p95}% de ${ru} RU/s, +25% de margen`,
                });
            }
        }

        // 2) Pasar a autoscale. El autoscale cuesta 1,5x por RU pero factura lo
        //    USADO por hora, así que conviene cuando el consumo medio está por
        //    debajo de ~2/3 del techo. El 1,5 no es una constante elegida: es el
        //    cociente entre las dos tarifas publicadas (0,012 / 0,008).
        //    Se compara contra el aprovisionado ACTUAL, que es lo que se paga
        //    hoy, y no contra el reducido del punto 1: son alternativas.
        if (e.mode === "manual" && avg !== null) {
            const factor = t.autoscalePorRuHora / t.provisionadoPorRuHora;
            // Autoscale nunca factura menos del 10% del techo configurado.
            const fraccionFacturada = Math.max(avg / 100, 0.1);
            const costoAutoscale = redondear2(
                ru * fraccionFacturada * factor * t.provisionadoPorRuHora * HORAS_MES,
            );
            const ahorro = redondear2(costoThroughput - costoAutoscale);
            if (ahorro > 0) {
                decisiones.push({
                    clave: "migrar_a_autoscale",
                    ruRecomendado: a100(ru),
                    ahorroMensualUsd: ahorro,
                    base: `uso medio ${avg}%, autoscale cuesta ${factor}x por RU pero factura lo usado`,
                });
            }
        }
    }

    // 3) Serverless. Se decide con las RU realmente consumidas, extrapoladas al
    //    mes: es el único de los tres que no depende del aprovisionado.
    if (
        e.totalRequestUnits !== null &&
        e.diasMedidos > 0 &&
        costoThroughput !== null &&
        (e.mode === "manual" || e.mode === "autoscale")
    ) {
        const ruMes = (e.totalRequestUnits / e.diasMedidos) * 30;
        const costoServerless = redondear2((ruMes / 1_000_000) * t.serverlessPorMillonRu);
        const ahorro = redondear2(costoThroughput - costoServerless);
        // El techo de serverless es 5.000 RU/s, y se mide contra el PICO REAL
        // —aprovisionado x consumo normalizado máximo—, no contra lo
        // aprovisionado: una cuenta con 10.000 RU/s configuradas que nunca pasa
        // de 2.000 entra en serverless de sobra, y mirar el techo configurado la
        // descartaría justo por el defecto que se quiere corregir.
        // Sin pico medido no se opina: recomendar una migración que después no
        // se puede hacer es peor que no recomendar nada.
        const picoRu = ru !== null && e.maxNormalizedRuPct !== null ? (ru * e.maxNormalizedRuPct) / 100 : null;
        const cabeEnServerless = picoRu !== null && picoRu <= 5000;
        if (ahorro > 0 && cabeEnServerless) {
            decisiones.push({
                clave: "migrar_a_serverless",
                ruRecomendado: null,
                ahorroMensualUsd: ahorro,
                base: `${Math.round(ruMes / 1_000_000)}M RU/mes medidas a ${t.serverlessPorMillonRu} USD por millón; pico ${Math.round(picoRu!)} RU/s`,
            });
        }
    }

    return {
        decisiones: decisiones.sort((a, b) => b.ahorroMensualUsd - a.ahorroMensualUsd),
        costoThroughputMensual: costoThroughput,
        costoAlmacenamientoMensual: almacenamiento,
        ruSugerido,
        sinDatos: ru === null && e.totalRequestUnits === null,
    };
}

/**
 * Tarifas desde la Retail Prices API para la región de la cuenta.
 *
 * Los medidores se eligen por el par (meterName, productName) y NO por el
 * nombre solo: `Data Stored` existe en varios productos y el de `Azure Cosmos
 * DB` cotiza 0,00. Si algo no se encuentra, se cae a `TARIFAS_LISTA` entera y
 * se informa la fuente, en vez de mezclar precios de dos orígenes.
 */
export async function getTarifasCosmos(region: string): Promise<TarifasCosmos> {
    const url =
        "https://prices.azure.com/api/retail/prices?$filter=" +
        encodeURIComponent(
            `serviceName eq 'Azure Cosmos DB' and armRegionName eq '${region}' and priceType eq 'Consumption'`,
        );
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return TARIFAS_LISTA;
        const items: any[] = (await r.json())?.Items || [];
        const buscar = (meterName: string, productName: string) =>
            items.find((i) => i?.meterName === meterName && i?.productName === productName)?.retailPrice;

        const prov = buscar("100 RU/s", "Azure Cosmos DB");
        const auto = buscar("AP1 100 RUs", "Azure Cosmos DB autoscale");
        const serverless = buscar("1M RUs", "Azure Cosmos DB serverless");
        const almacenamiento = buscar("General Purpose Storage Data Stored", "Azure DocumentDB");

        const completo = [prov, auto, serverless, almacenamiento].every(
            (v) => typeof v === "number" && v > 0,
        );
        if (!completo) return TARIFAS_LISTA;

        return {
            provisionadoPorRuHora: prov / 100,
            autoscalePorRuHora: auto / 100,
            serverlessPorMillonRu: serverless,
            almacenamientoPorGbMes: almacenamiento,
            fuente: "retail-api",
        };
    } catch {
        return TARIFAS_LISTA;
    }
}

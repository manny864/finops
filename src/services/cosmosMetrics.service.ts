import { MonitorClient } from "@azure/arm-monitor";
import type { TokenCredential } from "@azure/identity";

/**
 * MEJ-18 — telemetría REAL de Cosmos DB desde Azure Monitor.
 *
 * Por qué existe: el tablero de Cosmos armaba su bloque `metrics` con
 * constantes escritas en el código —35% de RU normalizada, 0% de throttling,
 * 100.000 requests, 4.000 RU/s aprovisionadas, 50 GB de datos— para CUALQUIER
 * cuenta de CUALQUIER cliente. No se llamaba a Azure Monitor en ningún momento;
 * la lista `COSMOS_METRICS` de la ruta era código muerto. El costo sí era real
 * (sale de Cost Management), así que la pantalla mezclaba un número verdadero
 * con seis inventados y no había forma de distinguirlos mirándola.
 *
 * NOMBRES VERIFICADOS en learn.microsoft.com, "Supported metrics for
 * Microsoft.DocumentDB/DatabaseAccounts" (2026-09-24). Importa porque un nombre
 * de métrica equivocado en Azure devuelve vacío, no un error. De paso, cuatro
 * de los once nombres de aquella constante muerta NO existen para este tipo de
 * recurso: `ThrottledRequests`, `CpuPercent`, `MemoryPercent` y `DiskPercent`.
 *
 * NULL CUANDO NO SE PUDO MEDIR. Ninguna función de acá inventa un número de
 * reemplazo: si Azure no devuelve la serie, el campo va null y la pantalla lo
 * dice. Es la diferencia entre "esta cuenta no tiene throttling" y "no sabemos
 * si tiene throttling", que para quien decide sobre una factura no es lo mismo.
 */

export interface MetricasCosmos {
    /** Media del consumo normalizado de RU (%), sobre muestras horarias. */
    avgNormalizedRuPct: number | null;
    /**
     * p95 del consumo normalizado (%). Es el p95 de los MÁXIMOS horarios, no de
     * las muestras crudas: Azure Monitor no expone percentiles para esta
     * métrica. Queda por encima de la media y por debajo del pico absoluto, que
     * es lo que se quiere para dimensionar.
     */
    p95NormalizedRuPct: number | null;
    /** Pico absoluto del período (%). 100 sostenido = throttling seguro. */
    maxNormalizedRuPct: number | null;
    /** RU/s aprovisionadas. */
    provisionedRu: number | null;
    /**
     * RU/s máximas de autoscale. Su PRESENCIA es lo que distingue autoscale de
     * manual sin pedir nada más: Azure sólo emite esta métrica para contenedores
     * en autoscale. Antes el modo se asumía siempre "autoscale", con lo cual la
     * regla de "manual sobredimensionado" no podía dispararse nunca con datos
     * reales.
     */
    autoscaleMaxRu: number | null;
    /** RU consumidas en el período (suma). */
    totalRequestUnits: number | null;
    totalRequests: number | null;
    /** Requests con StatusCode 429. */
    throttledRequests: number | null;
    /** % de 429 sobre el total. null si no se pudo medir alguno de los dos. */
    throttling429Rate: number | null;
    serverLatencyMs: number | null;
    dataUsageGb: number | null;
    indexUsageGb: number | null;
}

export interface ParticionCosmos {
    partitionId: string;
    avgNormalizedRuPct: number;
    maxNormalizedRuPct: number;
}

const GB = 1024 ** 3;
export const VENTANA_DIAS = 7;

export function metricasVacias(): MetricasCosmos {
    return {
        avgNormalizedRuPct: null, p95NormalizedRuPct: null, maxNormalizedRuPct: null,
        provisionedRu: null, autoscaleMaxRu: null, totalRequestUnits: null,
        totalRequests: null, throttledRequests: null, throttling429Rate: null,
        serverLatencyMs: null, dataUsageGb: null, indexUsageGb: null,
    };
}

function promedio(v: number[]): number | null {
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** p95 por rango: con menos de 20 muestras devuelve el máximo, que es más honesto que interpolar. */
export function percentil95(v: number[]): number | null {
    if (v.length === 0) return null;
    const orden = [...v].sort((a, b) => a - b);
    if (orden.length < 20) return orden[orden.length - 1];
    return orden[Math.min(orden.length - 1, Math.ceil(orden.length * 0.95) - 1)];
}

function redondear(v: number | null, dec = 2): number | null {
    if (v === null || !Number.isFinite(v)) return null;
    const f = 10 ** dec;
    return Math.round(v * f) / f;
}

type Serie = { average: number[]; maximum: number[]; total: number[]; count: number[] };

/**
 * Aplana la respuesta de Azure Monitor a series por nombre de métrica.
 *
 * Exportada a propósito: es el único punto donde un campo mal escrito NO
 * rompería nada visible —devolvería series vacías y todo saldría null, que se
 * lee igual que "este cliente no tiene datos"—. El test la ejerce contra una
 * respuesta con la forma que documenta Azure.
 */
export function leerSeries(respuesta: any): Map<string, Serie> {
    const salida = new Map<string, Serie>();
    for (const metrica of respuesta?.value || []) {
        const nombre = String(metrica?.name?.value || "");
        if (!nombre) continue;
        const s: Serie = salida.get(nombre) || { average: [], maximum: [], total: [], count: [] };
        for (const ts of metrica?.timeseries || []) {
            for (const punto of ts?.data || []) {
                for (const k of ["average", "maximum", "total", "count"] as const) {
                    const v = punto?.[k];
                    if (typeof v === "number" && Number.isFinite(v)) s[k].push(v);
                }
            }
        }
        salida.set(nombre, s);
    }
    return salida;
}

function ventana(dias = VENTANA_DIAS): string {
    const fin = new Date();
    const inicio = new Date(fin.getTime() - dias * 24 * 60 * 60 * 1000);
    return `${inicio.toISOString()}/${fin.toISOString()}`;
}

/**
 * Las llamadas van separadas por agregación y no todas juntas: Azure Monitor
 * rechaza el pedido ENTERO con 400 si se le pide una agregación que alguna de
 * las métricas del lote no soporta (`ProvisionedThroughput` sólo admite
 * Maximum, `TotalRequests` sólo Count). Agrupadas por agregación, cada lote es
 * válido y un fallo aislado no se lleva puesto al resto.
 */
export async function getCosmosAccountMetrics(
    credential: TokenCredential,
    subscriptionId: string,
    resourceId: string,
    dias = VENTANA_DIAS,
): Promise<MetricasCosmos> {
    const cliente = new MonitorClient(credential, subscriptionId);
    const timespan = ventana(dias);
    const base = { timespan, interval: "PT1H" };

    const pedir = (metricnames: string, aggregation: string, filter?: string) =>
        cliente.metrics.list(resourceId, { ...base, metricnames, aggregation, ...(filter ? { filter } : {}) });

    const [consumo, techos, unidades, pedidos, throttled, almacenamiento, latencia] = await Promise.allSettled([
        pedir("NormalizedRUConsumption", "Average,Maximum"),
        pedir("ProvisionedThroughput,AutoscaleMaxThroughput", "Maximum"),
        pedir("TotalRequestUnits", "Total"),
        pedir("TotalRequests", "Count"),
        // El 429 no tiene metrica propia: es TotalRequests filtrado por
        // StatusCode. `ThrottledRequests` no existe para databaseAccounts.
        pedir("TotalRequests", "Count", "StatusCode eq '429'"),
        pedir("DataUsage,IndexUsage", "Average"),
        pedir("ServerSideLatency", "Average"),
    ]);

    const serie = (r: PromiseSettledResult<any>, nombre: string): Serie | null =>
        r.status === "fulfilled" ? leerSeries(r.value).get(nombre) || null : null;

    const ru = serie(consumo, "NormalizedRUConsumption");
    const prov = serie(techos, "ProvisionedThroughput");
    const auto = serie(techos, "AutoscaleMaxThroughput");
    const tru = serie(unidades, "TotalRequestUnits");
    const total = serie(pedidos, "TotalRequests");
    const t429 = serie(throttled, "TotalRequests");
    const datos = serie(almacenamiento, "DataUsage");
    const indice = serie(almacenamiento, "IndexUsage");
    const lat = serie(latencia, "ServerSideLatency");

    const suma = (s: Serie | null, k: keyof Serie) =>
        s && s[k].length ? s[k].reduce((a, b) => a + b, 0) : null;
    const maximo = (s: Serie | null, k: keyof Serie) =>
        s && s[k].length ? Math.max(...s[k]) : null;

    const totalRequests = suma(total, "count");
    const throttledRequests = suma(t429, "count");

    return {
        avgNormalizedRuPct: redondear(promedio(ru?.average || [])),
        p95NormalizedRuPct: redondear(percentil95(ru?.maximum || [])),
        maxNormalizedRuPct: redondear(maximo(ru, "maximum")),
        // Maximo y no promedio: el aprovisionado es un techo configurado, no una
        // medicion. Si cambio a mitad de semana interesa el mayor.
        provisionedRu: redondear(maximo(prov, "maximum"), 0),
        autoscaleMaxRu: redondear(maximo(auto, "maximum"), 0),
        totalRequestUnits: redondear(suma(tru, "total"), 0),
        totalRequests: redondear(totalRequests, 0),
        throttledRequests: redondear(throttledRequests, 0),
        throttling429Rate:
            totalRequests !== null && throttledRequests !== null && totalRequests > 0
                ? redondear((throttledRequests / totalRequests) * 100)
                : totalRequests === 0
                ? 0
                : null,
        serverLatencyMs: redondear(promedio(lat?.average || [])),
        dataUsageGb: redondear((promedio(datos?.average || []) ?? NaN) / GB),
        indexUsageGb: redondear((promedio(indice?.average || []) ?? NaN) / GB),
    };
}

/**
 * Consumo normalizado por partición física, que es la señal de hot partition.
 *
 * Se usa `NormalizedRUConsumption` dividida por `PhysicalPartitionId` y NO
 * `PartitionKeyStatistics`, que es lo que pedía la propuesta original: esa no es
 * una métrica sino una categoría de log de diagnóstico, y exige que el cliente
 * tenga configurado el diagnostic setting hacia Log Analytics. Con la métrica no
 * hace falta que el cliente haya configurado nada.
 */
export async function getCosmosPartitionSkew(
    credential: TokenCredential,
    subscriptionId: string,
    resourceId: string,
    dias = VENTANA_DIAS,
): Promise<ParticionCosmos[]> {
    const cliente = new MonitorClient(credential, subscriptionId);
    try {
        const r = await cliente.metrics.list(resourceId, {
            timespan: ventana(dias),
            interval: "PT1H",
            metricnames: "NormalizedRUConsumption",
            aggregation: "Average,Maximum",
            // `*` pide el desglose por esa dimension en vez de un valor puntual.
            filter: "PhysicalPartitionId eq '*'",
        });

        const particiones: ParticionCosmos[] = [];
        for (const metrica of r?.value || []) {
            for (const ts of metrica?.timeseries || []) {
                const id = (ts?.metadatavalues || []).find(
                    (m: any) => String(m?.name?.value || "").toLowerCase() === "physicalpartitionid",
                )?.value;
                if (!id) continue;
                const medias: number[] = [];
                const picos: number[] = [];
                for (const punto of ts?.data || []) {
                    if (typeof punto?.average === "number") medias.push(punto.average);
                    if (typeof punto?.maximum === "number") picos.push(punto.maximum);
                }
                if (medias.length === 0 && picos.length === 0) continue;
                particiones.push({
                    partitionId: String(id),
                    avgNormalizedRuPct: redondear(promedio(medias)) ?? 0,
                    maxNormalizedRuPct: redondear(picos.length ? Math.max(...picos) : null) ?? 0,
                });
            }
        }
        return particiones.sort((a, b) => b.maxNormalizedRuPct - a.maxNormalizedRuPct);
    } catch {
        // Sin desglose por particion no se puede opinar sobre hot partitions, y
        // eso es distinto de "esta balanceada": el llamador recibe [] y no
        // dibuja el diagnostico.
        return [];
    }
}

/**
 * ¿Hay una partición caliente? Sólo se afirma con al menos dos particiones: con
 * una sola, el 100% del consumo está ahí por definición y no es un desbalance.
 *
 * El umbral es sobre el REPARTO del consumo, no sobre el consumo absoluto: una
 * partición al 80% con las otras al 75% está sana; una al 80% con las otras al
 * 5% es el caso que cuesta plata, porque el throughput se reparte en partes
 * iguales entre particiones y la caliente tira 429 mientras las demás sobran.
 */
export function detectarParticionCaliente(
    particiones: ParticionCosmos[],
    umbralPct = 70,
): { esCaliente: boolean; partitionId: string | null; concentracionPct: number | null } {
    if (particiones.length < 2) return { esCaliente: false, partitionId: null, concentracionPct: null };
    const total = particiones.reduce((a, p) => a + p.avgNormalizedRuPct, 0);
    if (total <= 0) return { esCaliente: false, partitionId: null, concentracionPct: null };
    const peor = particiones.reduce((a, b) => (b.avgNormalizedRuPct > a.avgNormalizedRuPct ? b : a));
    const concentracion = Math.round((peor.avgNormalizedRuPct / total) * 10000) / 100;
    return {
        esCaliente: concentracion >= umbralPct,
        partitionId: peor.partitionId,
        concentracionPct: concentracion,
    };
}

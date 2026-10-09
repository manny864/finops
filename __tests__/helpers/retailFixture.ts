import { readFileSync } from "node:fs";
import { join } from "node:path";
import { precioMensualDesdeUnidad } from "@/services/pricingService";
import type { ItemRetail } from "@/services/pricingService";
import type { Componente } from "@/services/iacCostCatalog";
import type { FuncionPrecio } from "@/services/iacCostEstimator.service";

/**
 * Respuestas REALES de la Retail API capturadas el 2026-10-08 (priceType
 * Consumption), una entrada por consulta. Permite correr el catálogo completo —
 * incluida la elección del medidor, que es donde se equivoca en silencio— sin
 * red y de forma determinista. El test opt-in `iacCostCatalogLive.test.ts`
 * vuelve a preguntarle a la API y avisa si Azure cambió algún nombre.
 */
const DATOS: { consultas: Record<string, ItemRetail[]> } = JSON.parse(
    readFileSync(join(process.cwd(), "__tests__/fixtures/retail-prices-2026-10-08.json"), "utf8")
);

export function claveDeConsulta(c: Componente["consulta"]): string {
    return [c.serviceName, c.region, c.filtro?.campo ?? "", c.filtro?.valor ?? ""].join("|");
}

/** Las consultas que el fixture sabe contestar. */
export const CONSULTAS_CAPTURADAS = Object.keys(DATOS.consultas);

/**
 * Un `fetch` que contesta como la Retail API real sobre el fixture: filtra por el
 * campo que dice el `$filter` (`skuName` o `armSkuName`) y, cuando nada coincide,
 * responde 200 con `Items: []` y no un error. Ese silencio es lo que esconde pasar
 * un `armSkuName` como `skuName` (medido el 2026-10-09). Devuelve las filas en el
 * orden capturado; los tests que necesitan otro lo cambian ellos.
 */
export function fetchDeFixture(): typeof fetch {
    return (async (input: RequestInfo | URL) => {
        const filtro = decodeURIComponent(String(input).split("$filter=")[1] ?? "");
        const valor = (campo: string) => filtro.match(new RegExp(`(?:^| )${campo} eq '([^']*)'`))?.[1] ?? "";
        const sku = filtro.match(/(?:^| )(armSkuName|skuName) eq '([^']*)'/);
        const clave = [valor("serviceName"), valor("armRegionName"), sku?.[1] ?? "", sku?.[2] ?? ""].join("|");
        return { ok: true, status: 200, json: async () => ({ Items: DATOS.consultas[clave] ?? [], NextPageLink: null }) } as Response;
    }) as typeof fetch;
}

export const precioDeFixture: FuncionPrecio = async (c) => {
    const items = DATOS.consultas[claveDeConsulta(c.consulta)];
    // Una consulta fuera del fixture es un error del test, no "sin precio": se
    // distingue para no esconder un mapeo nuevo sin capturar.
    if (!items) throw new Error(`El fixture no tiene la consulta ${claveDeConsulta(c.consulta)}`);
    const item = c.elegir(items);
    if (!item) return { ok: false, motivo: "sin-precio" };
    const mensual = precioMensualDesdeUnidad(item.retailPrice, item.unitOfMeasure);
    return mensual === null ? { ok: false, motivo: "sin-precio" } : { ok: true, mensual };
};

/**
 * La API no garantiza el orden de las filas: este fetch contesta lo mismo que `f` con las
 * filas invertidas. Sirve para probar que un precio no depende de cuál viene primero
 * (`skuName eq 'Standard'` trae la IP pública y el Public IP Prefix, y el segundo puede ir antes).
 */
export function conOrdenInvertido(f: typeof fetch): typeof fetch {
    return (async (url: RequestInfo | URL, init?: RequestInit) => {
        const j = await (await f(url, init)).json();
        return { ok: true, status: 200, json: async () => ({ ...j, Items: [...j.Items].reverse() }) } as Response;
    }) as typeof fetch;
}

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

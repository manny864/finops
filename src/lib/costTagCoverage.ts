import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";

/**
 * MEJ-30 paso 3: ¿el costo de este período trae etiquetas reales, o hay que
 * seguir aproximando por Resource Group?
 *
 * EL PROBLEMA DE FONDO
 * Una fila con `Tags` en NULL es ambigua: puede ser un recurso genuinamente sin
 * etiquetar, o una fila que nunca tuvo la oportunidad de traerlas. Si se
 * confunden, un Cost Group por etiqueta devuelve $0.00 y parece un dato
 * cuando es un hueco.
 *
 * LA SEÑAL QUE LOS DISTINGUE
 * Sólo hay dos escritores de `CostSnapshots`:
 *  - `costExportIngestionService` (export FOCUS): escribe `Tags` Y `ResourceId`.
 *  - `insertCostSnapshotRow` (sync diario vía Cost Management): no escribe
 *    ninguna de las dos -- agrega por ServiceName/ResourceGroupName y nunca
 *    pide etiquetas.
 *
 * Entonces `ResourceId IS NOT NULL OR Tags IS NOT NULL` es procedencia: la fila
 * vino del camino que SÍ carga etiquetas. Si vino de ahí y `Tags` está en NULL,
 * el recurso está genuinamente sin etiquetar y $0.00 es la respuesta correcta.
 *
 * Se mide sobre el COSTO y no sobre la cantidad de filas: 10 filas sin
 * procedencia que valen $3 no invalidan el período, pero una que vale el 80%
 * del gasto sí.
 */
export interface TagCoverage {
  /** Costo del período cuyas filas vienen del camino que carga etiquetas. */
  costWithProvenance: number;
  costTotal: number;
  /** `true` sólo si TODO el costo del período tiene procedencia de etiquetas. */
  isExact: boolean;
}

/**
 * Decide si el período se puede tratar como exacto. Separada de la consulta
 * para poder probar el criterio sin base de datos.
 *
 * El umbral es "no queda nada sin procedencia", no un porcentaje: cualquier
 * costo sin procedencia es costo que el predicado exacto NO puede ver, así que
 * el resultado sería una sub-cuenta silenciosa. Un tenant a mitad de migración
 * (parte del mes por sync, parte por export) cae a aproximado, que es lo
 * correcto -- el OR con Resource Groups cubre justamente ese tramo.
 */
export function decideTagExactness(costWithProvenance: number, costTotal: number): boolean {
  if (costTotal <= 0) return false; // Sin gasto no hay nada que declarar exacto.
  // Tolerancia de centavo: los costos son DECIMAL(12,4) y la suma de dos
  // COALESCE distintos puede diferir en el último decimal sin que falte una fila.
  return costTotal - costWithProvenance < 0.01;
}

/**
 * Cobertura de etiquetas del período. `start`/`end` en formato `YYYY-MM-DD`.
 */
export async function getTagCoverage(tenantId: string, start: string, end: string): Promise<TagCoverage> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS costTotal,
       SUM(CASE WHEN ResourceId IS NOT NULL OR Tags IS NOT NULL
                THEN COALESCE(EffectiveCost, BilledCost, cost_usd, 0) ELSE 0 END) AS costWithProvenance
     FROM CostSnapshots
     WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ?`,
    [tenantId, start, end]
  );
  const costTotal = Number(rows[0]?.costTotal) || 0;
  const costWithProvenance = Number(rows[0]?.costWithProvenance) || 0;
  return { costTotal, costWithProvenance, isExact: decideTagExactness(costWithProvenance, costTotal) };
}

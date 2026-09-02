import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";

/**
 * MEJ-30 paso 2: qué claves de etiqueta hay que ir a buscar a Cost Management
 * para un tenant, y si vale la pena hacerlo.
 *
 * Cada clave cuesta una consulta por scope, así que el conjunto se acota a lo
 * que alguna regla usa DE VERDAD: las de sus Cost Groups por etiqueta, más
 * `CostCenter`, que es la que alimenta el reparto por centro de costo y el
 * "Top 5" del White Board. Pedir todas las etiquetas del tenant multiplicaría
 * las llamadas sin que nadie las consulte.
 */
export const ALWAYS_TRACKED_TAG_KEY = "CostCenter";

/** Tope de claves por corrida. Cada una es `1 × scopes` consultas más al día;
 *  sin tope, un tenant con 30 Cost Groups por etiqueta multiplicaría por 30 su
 *  cuota de Cost Management y se llevaría puesto el resto del sync. */
export const MAX_TAG_KEYS_PER_RUN = 5;

export async function getTagKeysToFetch(tenantId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT match_tag_key FROM CostGroups
     WHERE tenant_id = ? AND match_tag_key IS NOT NULL AND match_tag_key <> ''`,
    [tenantId]
  );
  const keys = new Set<string>([ALWAYS_TRACKED_TAG_KEY]);
  for (const r of rows) keys.add(String(r.match_tag_key));
  return Array.from(keys).slice(0, MAX_TAG_KEYS_PER_RUN);
}

/**
 * `true` si el tenant ya recibe etiquetas por el export FOCUS, que es el
 * camino exacto y gratis (no suma llamadas a Azure). En ese caso el paso 2
 * sobra: es el criterio de aceptación 3 de MEJ-30 -- "la cantidad de consultas
 * a Cost Management por ciclo no aumenta para los tenants con export".
 *
 * Se mira una ventana reciente y no la tabla entera: un tenant que tuvo export
 * el año pasado y hoy no, necesita el fetch igual.
 */
export async function hasRecentExportTagData(tenantId: string, days = 7): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM CostSnapshots
     WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND (Tags IS NOT NULL OR ResourceId IS NOT NULL)
     LIMIT 1`,
    [tenantId, days]
  );
  return rows.length > 0;
}

import pool from "@/modules/storage/db";

/**
 * Deja un renglón en `AuditTrailLogs` (la bitácora de acciones: `getAuditTrailLogs` la lee y la pantalla de auditoría la muestra).
 * El texto completo va en `metadata_json.descripcion`; `resource_target_name` lleva sólo el principio (la columna es de 255).
 *
 * Antes esto escribía en `SecurityAuditTrail`, una tabla que NO tiene DDL en ninguna migración: cada INSERT fallaba, el catch lo
 * tragaba y los reembolsos, las cancelaciones y su solicitud no dejaban rastro. Lo mostró correr el flujo contra un MySQL real.
 *
 * Best-effort: la auditoría nunca tira abajo la operación que registra, pero un fallo queda en el log.
 */
export async function registrarAuditoria(tenantId: string, evento: string, actor: string, descripcion: string): Promise<void> {
  try {
    await pool.query(
      "INSERT INTO AuditTrailLogs (tenant_id, user_email, action_type, resource_target_name, status, metadata_json) VALUES (?, ?, ?, ?, 'SUCCESS', ?)",
      [tenantId, actor, evento, descripcion.slice(0, 255), JSON.stringify({ descripcion })]
    );
  } catch (e) {
    console.warn("[Audit] No se pudo escribir la auditoría:", (e as Error)?.message);
  }
}

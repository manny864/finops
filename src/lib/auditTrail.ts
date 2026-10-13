import pool from "@/modules/storage/db";

/**
 * Deja un renglón en `SecurityAuditTrail`. Best-effort: la auditoría nunca tira abajo la operación que registra (reembolsos,
 * cancelaciones), pero un fallo queda en el log para que no se pierda en silencio.
 */
export async function registrarAuditoria(tenantId: string, evento: string, actor: string, descripcion: string): Promise<void> {
  try {
    await pool.query("INSERT INTO SecurityAuditTrail (tenant_id, event_type, user_email, description) VALUES (?, ?, ?, ?)", [tenantId, evento, actor, descripcion]);
  } catch (e) {
    console.warn("[Audit] No se pudo escribir la auditoría:", (e as Error)?.message);
  }
}

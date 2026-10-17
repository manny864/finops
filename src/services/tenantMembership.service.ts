import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getUserLimit } from "@/lib/tierLogic";

/**
 * STRIDE-03 — alta de miembros de un tenant. ÚNICO punto de admisión: lo usan el login (`/api/onboard`) y el guard
 * (`requireTenantAccess`) cuando un usuario del directorio todavía no tiene fila en `Users`.
 *
 * Debe llamarse DENTRO de una transacción del llamador (`connection.beginTransaction()`): bloquea la fila del tenant
 * con `FOR UPDATE` para que dos altas simultáneas no superen el límite del plan.
 *
 * Dos modos, porque no son lo mismo:
 *  - `login`: lo que ya hacía /api/onboard. El primer usuario del tenant queda Owner, los siguientes Reader.
 *  - `peticion`: el guard. Nunca crea Owner ni SuperAdmin; si el tenant no tiene ningún usuario no admite a nadie por
 *    esta vía (el primero tiene que pasar por el login, que le da el Owner), y si no hay suscripción o cupo, no admite.
 */
export type ModoDeAlta = "login" | "peticion";

export type ResultadoDeAlta =
  | { resultado: "creado" | "existente"; rol: string; esNuevo: boolean }
  | { resultado: "sin-tenant" | "sin-duenio" }
  | { resultado: "sin-cupo"; tier: string; limite: number };

export async function altaDeMiembro(
  connection: PoolConnection,
  miembro: { tenantId: string; entraOid: string; email: string },
  opciones: { modo: ModoDeAlta; systemRole?: string },
): Promise<ResultadoDeAlta> {
  const { tenantId, entraOid, email } = miembro;
  const systemRole = opciones.modo === "peticion" ? "USER" : (opciones.systemRole ?? "USER");

  // Serializa las altas del tenant: sin esto, dos usuarios nuevos a la vez leen el mismo conteo y superan el cupo.
  const [tenantRows] = await connection.query<RowDataPacket[]>(
    "SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1 FOR UPDATE",
    [tenantId],
  );
  if (!tenantRows || tenantRows.length === 0) return { resultado: "sin-tenant" };
  const tier = String(tenantRows[0].tier || "Professional");

  const [existentes] = await connection.query<RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM Users WHERE tenant_id = ? AND (entra_oid IS NULL OR entra_oid <> ?)",
    [tenantId, entraOid],
  );
  const otros = Number(existentes?.[0]?.cnt ?? 0);
  if (opciones.modo === "peticion" && otros === 0) return { resultado: "sin-duenio" };

  // El primer usuario del tenant es su creador -> Owner; los siguientes entran como Reader y un Admin/Owner los
  // promueve desde /admin/users (ver docs/roles-y-permisos.md).
  const rol = opciones.modo === "login" && otros === 0 ? "Owner" : "Reader";

  const [yaEstaba] = await connection.query<RowDataPacket[]>(
    "SELECT 1 FROM Users WHERE tenant_id = ? AND entra_oid = ? LIMIT 1",
    [tenantId, entraOid],
  );
  const esNuevo = !yaEstaba || yaEstaba.length === 0;

  // Límite de usuarios por plan: sólo bloquea altas NUEVAS; quien ya está provisionado sigue entrando aunque el tenant
  // esté hoy en o sobre el límite (p. ej. tras un downgrade).
  if (esNuevo && systemRole !== "SUPERADMIN") {
    const limite = getUserLimit(tier);
    if (Number.isFinite(limite) && otros + 1 > limite) return { resultado: "sin-cupo", tier, limite };
  }

  // No escala el rol si ya existía: preserva el que tenga.
  await connection.query(
    `INSERT INTO Users (entra_oid, tenant_id, email, role, system_role)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email)`,
    [entraOid, tenantId, email, rol, systemRole],
  );
  return { resultado: esNuevo ? "creado" : "existente", rol, esNuevo };
}

/**
 * `altaDeMiembro` dentro de su propia transacción, para los llamadores que no tienen una abierta (el guard y
 * `GET /api/tenants`). Confirma sólo si el miembro quedó admitido; en cualquier otro resultado o error, revierte.
 */
export async function altaDeMiembroTransaccional(
  pool: { getConnection(): Promise<PoolConnection> },
  miembro: { tenantId: string; entraOid: string; email: string },
  opciones: { modo: ModoDeAlta; systemRole?: string },
): Promise<ResultadoDeAlta> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const alta = await altaDeMiembro(connection, miembro, opciones);
    if (alta.resultado === "creado" || alta.resultado === "existente") await connection.commit();
    else await connection.rollback();
    return alta;
  } catch (e) {
    try { await connection.rollback(); } catch { /* ya revertida */ }
    throw e;
  } finally {
    connection.release();
  }
}

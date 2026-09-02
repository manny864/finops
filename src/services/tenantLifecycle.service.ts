import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";

/**
 * MEJ-12: el único punto por donde debe pasar un cambio de ciclo de vida de un
 * tenant.
 *
 * POR QUÉ EXISTE
 * Había 17 `UPDATE Tenants SET subscription_status = ...` repartidos entre
 * webhooks, crons, rutas de admin y servicios. Cada uno escribía el estado y
 * nada más: ninguno dejaba registro de CUÁNDO ni POR QUÉ. Estampar las fechas
 * en los 17 sería 17 oportunidades de olvidarse una; concentrarlo acá hace que
 * el registro sea consecuencia de cambiar el estado, no un paso aparte que hay
 * que acordarse de hacer.
 */

export type LifecycleEventType = "ACTIVATED" | "SUSPENDED" | "REACTIVATED" | "CANCELED" | "EXPIRED";

export type CancellationReason =
  | "voluntary_churn"
  | "payment_delinquency"
  | "contract_expired"
  | "admin_deprovisioning";

export interface LifecycleTransitionOptions {
  /** Email del SuperAdmin, o el origen automático ('paddle-webhook', etc.). */
  actor?: string;
  reason?: CancellationReason;
  metadata?: Record<string, unknown>;
}

/**
 * Qué implica cada evento: a qué estado lleva y qué fecha estampa.
 *
 * `EXPIRED` también estampa `canceled_at`: para el cálculo de churn el fin de
 * un contrato es una baja igual que una cancelación voluntaria, y sin fecha no
 * entraría en ninguna cohorte. El motivo lo distingue.
 */
const TRANSITIONS: Record<LifecycleEventType, {
  status: string;
  stamp: "activated_at" | "suspended_at" | "canceled_at";
  clears: string[];
  defaultReason?: CancellationReason;
}> = {
  ACTIVATED:   { status: "ACTIVE",   stamp: "activated_at", clears: ["suspended_at", "canceled_at", "cancellation_reason"] },
  // Reactivar arranca un período nuevo, así que vuelve a estampar el alta y
  // limpia la baja: el estado actual describe el período vigente. Los períodos
  // anteriores siguen enteros en TenantLifecycleEvents.
  REACTIVATED: { status: "ACTIVE",   stamp: "activated_at", clears: ["suspended_at", "canceled_at", "cancellation_reason"] },
  SUSPENDED:   { status: "PAST_DUE", stamp: "suspended_at", clears: [] },
  CANCELED:    { status: "CANCELED", stamp: "canceled_at",  clears: [], defaultReason: "voluntary_churn" },
  EXPIRED:     { status: "EXPIRED",  stamp: "canceled_at",  clears: [], defaultReason: "contract_expired" },
};

/**
 * Aplica la transición: cambia el estado, estampa la fecha y agrega el evento
 * al historial, todo en una transacción.
 *
 * La transacción no es ceremonia: si el UPDATE entrara y el INSERT no, quedaría
 * un cambio de estado sin registro — exactamente lo que el historial existe
 * para impedir.
 *
 * Devuelve `false` si no hizo nada por ser una repetición (ver más abajo).
 */
export async function recordTenantLifecycleTransition(
  tenantId: string,
  eventType: LifecycleEventType,
  options: LifecycleTransitionOptions = {}
): Promise<boolean> {
  const t = TRANSITIONS[eventType];
  if (!t) throw new Error(`Evento de ciclo de vida desconocido: ${eventType}`);

  const actor = options.actor || "system";
  const reason = options.reason ?? t.defaultReason ?? null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [current] = await conn.query<RowDataPacket[]>(
      "SELECT subscription_status FROM Tenants WHERE tenant_id = ? FOR UPDATE",
      [tenantId]
    );
    if (!current[0]) {
      // No se lanza: los webhooks de Paddle y del Marketplace pueden traer un
      // tenant que no existe acá (una suscripción de otro entorno que comparte
      // la cuenta de facturación). Si esto tirara 500, el proveedor
      // reintentaría para siempre un evento que nunca va a poder aplicarse.
      // Un fallo REAL de base sí propaga y provoca el reintento, que es lo que
      // se quiere.
      await conn.rollback();
      console.warn(`[lifecycle] ${eventType} para un tenant inexistente: ${tenantId} — se ignora`);
      return false;
    }
    const previousStatus: string = current[0].subscription_status;

    // Idempotencia ante reentrega de webhooks: Paddle y el Marketplace pueden
    // repetir el mismo evento. Se descarta sólo si el tenant YA está en el
    // estado destino Y el último evento registrado es de este mismo tipo, para
    // no suprimir un ciclo real (baja -> alta -> baja).
    if (previousStatus === t.status) {
      const [last] = await conn.query<RowDataPacket[]>(
        "SELECT event_type FROM TenantLifecycleEvents WHERE tenant_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1",
        [tenantId]
      );
      if (last[0]?.event_type === eventType) {
        await conn.rollback();
        return false;
      }
    }

    const clears = t.clears.map((c) => `${c} = NULL`).join(", ");
    await conn.query(
      `UPDATE Tenants
          SET subscription_status = ?,
              ${t.stamp} = NOW()
              ${eventType === "CANCELED" || eventType === "EXPIRED" ? ", cancellation_reason = ?" : ""}
              ${clears ? `, ${clears}` : ""}
        WHERE tenant_id = ?`,
      eventType === "CANCELED" || eventType === "EXPIRED"
        ? [t.status, reason, tenantId]
        : [t.status, tenantId]
    );

    await conn.query(
      `INSERT INTO TenantLifecycleEvents
         (tenant_id, event_type, occurred_at, actor, reason, previous_status, new_status, metadata)
       VALUES (?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [
        tenantId,
        eventType,
        actor,
        reason,
        previousStatus,
        t.status,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

export interface TenantLifecycleEvent {
  id: number;
  tenantId: string;
  eventType: LifecycleEventType;
  occurredAt: string;
  actor: string;
  reason: CancellationReason | null;
  previousStatus: string | null;
  newStatus: string | null;
}

/** Historial completo de un tenant, del más reciente al más antiguo. */
export async function getTenantLifecycleHistory(tenantId: string): Promise<TenantLifecycleEvent[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, tenant_id, event_type, occurred_at, actor, reason, previous_status, new_status
       FROM TenantLifecycleEvents
      WHERE tenant_id = ?
      ORDER BY occurred_at DESC, id DESC`,
    [tenantId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    tenantId: String(r.tenant_id),
    eventType: r.event_type as LifecycleEventType,
    occurredAt: new Date(r.occurred_at).toISOString(),
    actor: String(r.actor),
    reason: r.reason as CancellationReason | null,
    previousStatus: r.previous_status,
    newStatus: r.new_status,
  }));
}

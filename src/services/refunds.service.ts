import pool from "@/modules/storage/db";
import { getPaddleBaseUrl } from "@/lib/paddleTierMap";
import { cancelarSuscripcion } from "@/lib/paddleSubscriptions";

/**
 * Reembolsos TOTALES de un cobro de Paddle.
 *
 * Quién los pide: el SuperAdmin (sin ventana) o un Admin/Owner del tenant (dentro de `VENTANA_REEMBOLSO_DIAS` desde el cobro).
 * Los parciales se hacen en el panel de Paddle: la comisión se calculó sobre el cobro entero y prorratearla es una decisión
 * contable (ver `handleAdjustment` en el webhook).
 *
 * Esta pieza sólo PIDE el reembolso a Paddle (`POST /adjustments`,
 * https://developer.paddle.com/api-reference/adjustments/create-adjustment; requiere `adjustment.write`). Los EFECTOS en la
 * plataforma (marcar el cobro, revocar el módulo, cortar el acceso, revertir comisiones) los aplica el webhook cuando Paddle
 * lo APRUEBA (`aplicarReembolsoAprobado`): en vivo la mayoría de los reembolsos nacen `pending_approval` y puede rechazarlos, y
 * así también quedan cubiertos los que se hacen desde el panel de Paddle sin pasar por acá.
 *
 * Estado del cobro en `BillingTransactions.status`: `completed` → `refund_pending` (pedido) → `refunded` (aprobado) o de vuelta a
 * `completed` (rechazado). No hay tabla nueva: el pedido y el efecto quedan en `SecurityAuditTrail`.
 */
export const VENTANA_REEMBOLSO_DIAS = 14;

export type MotivoNoReembolsable = "ya-reembolsado" | "en-proceso" | "fuera-de-ventana" | "no-cobrado";

export interface CobroReembolsable {
  transactionId: string;
  subscriptionId: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  billedAt: string | null;
  /** Add-on acreditado por este cobro, si lo hubo. */
  addonKey: string | null;
  reembolsable: boolean;
  motivo?: MotivoNoReembolsable;
}

function errorHttp(mensaje: string, status: number): Error {
  return Object.assign(new Error(mensaje), { status });
}

const MS_DIA = 86_400_000;

function motivoNoReembolsable(status: string, billedAt: Date | null, esSuperAdmin: boolean, ahora: number): MotivoNoReembolsable | undefined {
  if (status === "refunded") return "ya-reembolsado";
  if (status === "refund_pending") return "en-proceso";
  if (status !== "completed") return "no-cobrado";
  if (!esSuperAdmin && (!billedAt || ahora - billedAt.getTime() > VENTANA_REEMBOLSO_DIAS * MS_DIA)) return "fuera-de-ventana";
  return undefined;
}

export async function listarCobros(tenantId: string, esSuperAdmin: boolean): Promise<CobroReembolsable[]> {
  const [rows]: any = await pool.query(
    `SELECT bt.paddle_transaction_id AS transactionId, bt.paddle_subscription_id AS subscriptionId, bt.amount, bt.currency,
            bt.status, bt.billed_at AS billedAt,
            (SELECT a.addon_key FROM TenantAddons a WHERE a.tenant_id = bt.tenant_id AND a.paddle_transaction_id = bt.paddle_transaction_id LIMIT 1) AS addonKey
       FROM BillingTransactions bt
      WHERE bt.tenant_id = ? AND bt.paddle_transaction_id IS NOT NULL AND bt.status IN ('completed', 'refund_pending', 'refunded')
      ORDER BY bt.billed_at DESC, bt.id DESC
      LIMIT 50`,
    [tenantId]
  );
  const ahora = Date.now();
  return (Array.isArray(rows) ? rows : []).map((r: any) => {
    const billedAt = r.billedAt ? new Date(r.billedAt) : null;
    const motivo = motivoNoReembolsable(r.status, billedAt, esSuperAdmin, ahora);
    return {
      transactionId: r.transactionId,
      subscriptionId: r.subscriptionId ?? null,
      amount: r.amount ?? null,
      currency: r.currency ?? null,
      status: r.status,
      billedAt: billedAt ? billedAt.toISOString() : null,
      addonKey: r.addonKey ?? null,
      reembolsable: !motivo,
      ...(motivo ? { motivo } : {}),
    };
  });
}

export interface PedidoReembolso {
  tenantId: string;
  transactionId: string;
  reason: string;
  email: string;
  esSuperAdmin: boolean;
}

/** Pide a Paddle el reembolso total del cobro. Devuelve el ajuste creado; los efectos llegan por webhook. */
export async function solicitarReembolso(p: PedidoReembolso): Promise<{ adjustmentId: string; status: string }> {
  const motivo = p.reason.trim();
  if (motivo.length < 5) throw errorHttp("Indicá el motivo del reembolso (al menos 5 caracteres).", 400);
  if (motivo.length > 500) throw errorHttp("El motivo no puede pasar de 500 caracteres.", 400);

  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw errorHttp("Falta PADDLE_API_KEY en este entorno: no se puede pedir el reembolso a Paddle.", 500);

  // El cobro tiene que ser de ESTE tenant: `tenant_id` va en el WHERE, así que pedir el reembolso de un cobro ajeno da 404.
  const [rows]: any = await pool.query(
    "SELECT id, status, billed_at FROM BillingTransactions WHERE tenant_id = ? AND paddle_transaction_id = ? LIMIT 1",
    [p.tenantId, p.transactionId]
  );
  const cobro = Array.isArray(rows) ? rows[0] : null;
  if (!cobro) throw errorHttp("No se encontró ese cobro en el tenant.", 404);

  const razon = motivoNoReembolsable(cobro.status, cobro.billed_at ? new Date(cobro.billed_at) : null, p.esSuperAdmin, Date.now());
  if (razon === "ya-reembolsado") throw errorHttp("Ese cobro ya fue reembolsado.", 409);
  if (razon === "en-proceso") throw errorHttp("Ese cobro ya tiene un reembolso en proceso.", 409);
  if (razon === "no-cobrado") throw errorHttp("Sólo se reembolsan cobros completados.", 409);
  if (razon === "fuera-de-ventana") {
    throw errorHttp(`Pasaron más de ${VENTANA_REEMBOLSO_DIAS} días desde el cobro: pedile el reembolso a soporte.`, 403);
  }

  // Reserva atómica: dos pedidos a la vez no mandan dos reembolsos a Paddle.
  const [reserva]: any = await pool.query(
    "UPDATE BillingTransactions SET status = 'refund_pending' WHERE id = ? AND status = 'completed'",
    [cobro.id]
  );
  if (!reserva?.affectedRows) throw errorHttp("Ese cobro ya tiene un reembolso en proceso.", 409);

  const liberar = () => pool.query("UPDATE BillingTransactions SET status = 'completed' WHERE id = ? AND status = 'refund_pending'", [cobro.id]);

  let res: Response;
  try {
    res = await fetch(`${getPaddleBaseUrl()}/adjustments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "refund",
        type: "full",
        transaction_id: p.transactionId,
        reason: `[${p.email}] ${motivo}`,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    await liberar();
    throw errorHttp(`No se pudo contactar a Paddle: ${(e as Error)?.message || "error de red"}. Reintentá en un momento.`, 502);
  }

  if (!res.ok) {
    await liberar();
    const cuerpo: any = await res.json().catch(() => ({}));
    console.error("[Refunds] Paddle rechazó el reembolso:", res.status, cuerpo?.error?.code, cuerpo?.error?.detail);
    const detalle = cuerpo?.error?.detail || cuerpo?.error?.code;
    throw errorHttp(detalle ? `Paddle rechazó el reembolso: ${detalle}` : `Paddle rechazó el reembolso (HTTP ${res.status}).`, 502);
  }

  const data: any = await res.json();
  const adjustmentId: string = data?.data?.id;
  const status: string = data?.data?.status ?? "pending_approval";
  await auditar(p.tenantId, "REFUND_REQUESTED", p.email, `Reembolso total pedido: txn ${p.transactionId}, ajuste ${adjustmentId} (${status}). Motivo: ${motivo}`);
  return { adjustmentId, status };
}

/** Paddle rechazó un reembolso pendiente: el cobro vuelve a estar disponible. Idempotente. */
export async function liberarReembolsoRechazado(transactionId: string): Promise<void> {
  await pool.query("UPDATE BillingTransactions SET status = 'completed' WHERE paddle_transaction_id = ? AND status = 'refund_pending'", [transactionId]);
}

export interface EfectosReembolso {
  aplicado: boolean;
  addonRevocado: boolean;
  accesoCortado: boolean;
}

/**
 * Paddle APROBÓ un reembolso (o un contracargo) TOTAL: lo que el cliente ya no pagó deja de tenerse.
 *  - el cobro queda `refunded`;
 *  - si ese cobro acreditó un módulo, la fila de `TenantAddons` pasa a `cancelled` y, si era recurrente, se cancela su suscripción
 *    en Paddle (si no, el mes siguiente se cobra y el renovado vuelve a acreditar el módulo);
 *  - si es el ÚLTIMO cobro del plan del tenant, se corta el acceso ahora (`access_until = NOW()`) y se cancela la suscripción en
 *    Paddle (el `subscription.canceled` posterior deja el estado y la baja en el historial). Un cobro ANTERIOR no corta nada: ya
 *    se usó, y el período vigente sigue pago.
 *
 * Idempotente: `created` y `updated` del mismo ajuste, y los reintentos de Paddle, dan el mismo resultado. Si la cancelación en
 * Paddle falla por red o con 5xx, LANZA para que el webhook conteste 500 y Paddle reintente: el acceso ya quedó cortado y sin la
 * cancelación el cliente seguiría pagando. Un rechazo 4xx (ya estaba cancelada) se registra y se sigue.
 */
export async function aplicarReembolsoAprobado(transactionId: string): Promise<EfectosReembolso> {
  const [rows]: any = await pool.query(
    "SELECT tenant_id, paddle_subscription_id FROM BillingTransactions WHERE paddle_transaction_id = ? LIMIT 1",
    [transactionId]
  );
  const cobro = Array.isArray(rows) ? rows[0] : null;
  if (!cobro) {
    console.warn(`[Refunds] Reembolso aprobado de la txn ${transactionId}, que no está en BillingTransactions: no hay nada que aplicar.`);
    return { aplicado: false, addonRevocado: false, accesoCortado: false };
  }
  const tenantId: string = cobro.tenant_id;
  const subscriptionId: string | null = cobro.paddle_subscription_id ?? null;

  await pool.query("UPDATE BillingTransactions SET status = 'refunded' WHERE paddle_transaction_id = ?", [transactionId]);

  // Módulo del marketplace acreditado por este cobro.
  const [modulos]: any = await pool.query(
    "SELECT id, addon_key, addon_type FROM TenantAddons WHERE tenant_id = ? AND paddle_transaction_id = ? AND status = 'active'",
    [tenantId, transactionId]
  );
  const addons = Array.isArray(modulos) ? modulos : [];
  // Primero la cancelación en Paddle y DESPUÉS la fila: si Paddle falla y el webhook se reintenta, la fila sigue `active` y el
  // reintento vuelve a encontrar el módulo y a cancelar; al revés, el reintento no vería nada y la suscripción seguiría cobrando.
  if (addons.some((a: any) => a.addon_type === "recurring") && subscriptionId) {
    await cancelarOFallar(subscriptionId, "módulo recurrente reembolsado");
  }
  if (addons.length > 0) {
    await pool.query("UPDATE TenantAddons SET status = 'cancelled' WHERE tenant_id = ? AND paddle_transaction_id = ? AND status = 'active'", [tenantId, transactionId]);
  }
  const addonRevocado = addons.length > 0;

  // Plan: el último cobro de la suscripción que figura como la del tenant.
  let accesoCortado = false;
  if (subscriptionId && !addonRevocado) {
    const [plan]: any = await pool.query("SELECT 1 FROM Tenants WHERE tenant_id = ? AND paddle_subscription_id = ? LIMIT 1", [tenantId, subscriptionId]);
    if (Array.isArray(plan) && plan.length > 0) {
      const [ultimo]: any = await pool.query(
        `SELECT paddle_transaction_id FROM BillingTransactions
          WHERE paddle_subscription_id = ? AND status IN ('completed', 'refund_pending', 'refunded')
          ORDER BY billed_at DESC, id DESC LIMIT 1`,
        [subscriptionId]
      );
      if (Array.isArray(ultimo) && ultimo[0]?.paddle_transaction_id === transactionId) {
        await pool.query("UPDATE Tenants SET access_until = NOW() WHERE tenant_id = ?", [tenantId]);
        await cancelarOFallar(subscriptionId, "plan reembolsado");
        accesoCortado = true;
      }
    }
  }

  await auditar(
    tenantId,
    "REFUND_APPLIED",
    "paddle-webhook",
    `Reembolso aprobado de la txn ${transactionId}: cobro marcado reembolsado${addonRevocado ? "; módulo revocado" : ""}${accesoCortado ? "; acceso cortado y suscripción cancelada" : ""}.`
  );
  return { aplicado: true, addonRevocado, accesoCortado };
}

async function cancelarOFallar(subscriptionId: string, motivo: string): Promise<void> {
  const r = await cancelarSuscripcion(subscriptionId, "immediately");
  if (r.ok) return;
  if (r.status >= 500) throw new Error(`Paddle no pudo cancelar ${subscriptionId} (${motivo}): HTTP ${r.status}`);
  // 4xx: lo habitual es que ya estuviera cancelada. Queda registrado por si no lo era.
  console.warn(`[Refunds] Paddle rechazó cancelar ${subscriptionId} (${motivo}): ${r.status} ${r.code ?? ""} ${r.detail ?? ""}`);
}

async function auditar(tenantId: string, evento: string, actor: string, descripcion: string): Promise<void> {
  try {
    await pool.query("INSERT INTO SecurityAuditTrail (tenant_id, event_type, user_email, description) VALUES (?, ?, ?, ?)", [tenantId, evento, actor, descripcion]);
  } catch (e) {
    console.warn("[Refunds] No se pudo escribir la auditoría:", (e as Error)?.message);
  }
}

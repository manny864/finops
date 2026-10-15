import { NextResponse } from "next/server";
import type { PoolConnection } from "mysql2/promise";
import pool from "@/modules/storage/db";

/**
 * PERIM-08: inbox durable y orden de eventos para los webhooks de Paddle y Azure Marketplace.
 *
 * Cada entrega autenticada pasa por `processWebhookOnce`, que en UNA transacción:
 *  1. bloquea (FOR UPDATE) el cursor del recurso: las entregas concurrentes del mismo
 *     recurso se serializan;
 *  2. si el evento ya está en el inbox, responde 200 sin volver a aplicarlo;
 *  3. si `enforceOrder` y el evento es más viejo que el último aplicado, lo registra como
 *     `stale` y responde 200: un evento atrasado no revierte un estado más nuevo (si se
 *     pasó `onStale`, corre ese efecto mínimo en lugar del handler);
 *  4. si no, corre el handler y, sólo si respondió 2xx, registra el evento y avanza el cursor.
 *     Si el handler falla, rollback: no queda nada registrado y el proveedor reintenta.
 *
 * Un timestamp IGUAL al último aplicado no es "viejo": se aplica (orden de llegada). Los
 * eventos de Paddle de suscripción traen el estado completo, así que el último que llega en
 * el mismo milisegundo es la foto vigente. Nunca se desempata por el ID: son aleatorios.
 *
 * Los efectos del handler usan sus propias conexiones (no participan de esta transacción).
 * Si el commit falla DESPUÉS de aplicarlos, se responde 503 y el reintento los vuelve a
 * aplicar: por eso los handlers tienen que ser idempotentes (fijan estado, insertan con
 * claves únicas). Nunca se responde 200 sin haber registrado el evento.
 */
export type WebhookProvider = "paddle" | "azure";

export interface InboxEvent {
  provider: WebhookProvider;
  /** ID del evento según el proveedor (Paddle `event_id`, Marketplace operation `id`). */
  eventId: string;
  eventType: string;
  /** Recurso y ámbito que ordena el evento (ej. `sub:<id>`, `sub:<id>:status`). */
  cursorKey: string;
  /** Momento autenticado del evento. null: no se ordena ni avanza el cursor. */
  occurredAt: Date | null;
  /**
   * true: si es más viejo que el último aplicado, se descarta.
   * false: se aplica siempre (bajas, que son irreversibles), pero igual avanza el cursor.
   */
  enforceOrder: boolean;
}

const EVENT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const CURSOR_KEY = /^[\x21-\x7e]{1,191}$/;
const EVENT_TYPE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function inboxUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Unable to accept event" },
    { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } },
  );
}

function errorCategory(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : "UnknownError";
}

async function safeRollback(conn: PoolConnection): Promise<void> {
  try {
    await conn.rollback();
  } catch {
    // La conexión se libera igual; MySQL deshace la transacción al cerrarla.
  }
}

export function isValidInboxEvent(event: InboxEvent): boolean {
  return (
    EVENT_ID.test(event.eventId) &&
    CURSOR_KEY.test(event.cursorKey) &&
    EVENT_TYPE.test(event.eventType) &&
    (event.occurredAt === null || !Number.isNaN(event.occurredAt.getTime()))
  );
}

export interface ProcessOptions {
  /**
   * Efecto mínimo para un evento atrasado (ej. vincular la suscripción en un
   * `subscription.created` que llegó después de un `updated`). Sin esto, se descarta.
   */
  onStale?: () => Promise<Response>;
}

export async function processWebhookOnce(
  event: InboxEvent,
  handler: () => Promise<Response>,
  options: ProcessOptions = {},
): Promise<Response> {
  if (!isValidInboxEvent(event)) {
    return NextResponse.json({ error: "Invalid event identifiers" }, { status: 400 });
  }
  const tag = { provider: event.provider, eventType: event.eventType };

  let conn: PoolConnection;
  try {
    conn = await pool.getConnection();
  } catch (error) {
    console.error("[webhook-inbox] connection failed", { ...tag, category: errorCategory(error) });
    return inboxUnavailableResponse();
  }

  try {
    await conn.beginTransaction();
    // ON DUPLICATE KEY toma el lock exclusivo de una: con INSERT IGNORE + FOR UPDATE dos
    // primeras entregas concurrentes podían bloquearse mutuamente (S → X).
    await conn.query(
      `INSERT INTO WebhookResourceCursor (provider, cursor_key) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE cursor_key = cursor_key`,
      [event.provider, event.cursorKey],
    );
    const [cursorRows] = await conn.query(
      `SELECT (last_occurred_at IS NOT NULL AND ? IS NOT NULL AND ? < last_occurred_at) AS is_stale
       FROM WebhookResourceCursor WHERE provider = ? AND cursor_key = ? FOR UPDATE`,
      [event.occurredAt, event.occurredAt, event.provider, event.cursorKey],
    );
    const [inboxRows] = await conn.query(
      "SELECT outcome FROM WebhookInbox WHERE provider = ? AND event_id = ? FOR UPDATE",
      [event.provider, event.eventId],
    );

    if (Array.isArray(inboxRows) && inboxRows.length > 0) {
      await conn.commit();
      return NextResponse.json({ received: true, duplicate: true });
    }

    const isStale = Number((cursorRows as Array<{ is_stale?: unknown }>)[0]?.is_stale ?? 0) === 1;
    const stale = event.enforceOrder && isStale;
    if (stale && !options.onStale) {
      await recordEvent(conn, event, "stale");
      await conn.commit();
      console.warn("[webhook-inbox] stale event ignored", tag);
      return NextResponse.json({ received: true, stale: true });
    }

    let response: Response;
    try {
      response = stale && options.onStale ? await options.onStale() : await handler();
    } catch (error) {
      await safeRollback(conn);
      console.error("[webhook-inbox] handler failed", { ...tag, category: errorCategory(error) });
      return NextResponse.json({ error: "Failed to process event" }, { status: 500 });
    }
    if (!response.ok) {
      await safeRollback(conn);
      return response;
    }

    await recordEvent(conn, event, stale ? "stale" : "processed");
    if (event.occurredAt && !stale) {
      await conn.query(
        `UPDATE WebhookResourceCursor
         SET last_occurred_at = IF(last_occurred_at IS NULL OR last_occurred_at < ?, ?, last_occurred_at)
         WHERE provider = ? AND cursor_key = ?`,
        [event.occurredAt, event.occurredAt, event.provider, event.cursorKey],
      );
    }
    await conn.commit();
    return response;
  } catch (error) {
    await safeRollback(conn);
    console.error("[webhook-inbox] persistence failed", { ...tag, category: errorCategory(error) });
    return inboxUnavailableResponse();
  } finally {
    conn.release();
  }
}

async function recordEvent(conn: PoolConnection, event: InboxEvent, outcome: "processed" | "stale"): Promise<void> {
  await conn.query(
    `INSERT INTO WebhookInbox (provider, event_id, event_type, cursor_key, occurred_at, outcome, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [event.provider, event.eventId, event.eventType, event.cursorKey, event.occurredAt, outcome],
  );
}

const PADDLE_EVENT_ID = /^evt_[A-Za-z0-9]{1,64}$/;
const PADDLE_RESOURCE_ID = /^[a-z]{2,8}_[A-Za-z0-9]{1,64}$/;
/** Eventos de suscripción que traen el estado completo: uno atrasado no debe pisar uno nuevo. */
const PADDLE_ORDERED = new Set(["subscription.created", "subscription.updated", "subscription.past_due", "subscription.activated", "subscription.paused", "subscription.resumed", "subscription.trialing"]);

/**
 * Sobre de un evento de Paddle ya autenticado por HMAC: `event_id`, `event_type` y
 * `occurred_at` vienen firmados. null si falta alguno o tiene un formato inválido.
 *
 * Las suscripciones comparten cursor (`sub:<id>`): `subscription.canceled` se aplica
 * siempre (una baja en Paddle no se revierte) y avanza el cursor, así un `updated`
 * atrasado no la deshace. Transacciones y ajustes sólo se deduplican: tienen sus propias
 * claves idempotentes y no fijan estado de la suscripción.
 */
export function paddleInboxEvent(payload: unknown): InboxEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { event_id?: unknown; event_type?: unknown; occurred_at?: unknown; data?: { id?: unknown } };
  if (typeof p.event_id !== "string" || !PADDLE_EVENT_ID.test(p.event_id)) return null;
  if (typeof p.event_type !== "string" || !EVENT_TYPE.test(p.event_type)) return null;
  if (typeof p.occurred_at !== "string") return null;
  const occurredAt = new Date(p.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) return null;

  const resourceId = typeof p.data?.id === "string" && PADDLE_RESOURCE_ID.test(p.data.id) ? p.data.id : null;
  const isSubscription = p.event_type.startsWith("subscription.");
  if (isSubscription && !resourceId) return null;

  return {
    provider: "paddle",
    eventId: p.event_id,
    eventType: p.event_type,
    cursorKey: resourceId ? `${isSubscription ? "sub" : p.event_type.split(".")[0]}:${resourceId}` : `event:${p.event_id}`,
    occurredAt,
    enforceOrder: PADDLE_ORDERED.has(p.event_type),
  };
}

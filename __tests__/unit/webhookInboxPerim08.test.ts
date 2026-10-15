// @vitest-environment node
/**
 * PERIM-08 — Inbox durable de webhooks: deduplicación, orden y reintento seguro.
 *
 * La base es un doble en memoria con lo que importa de InnoDB para este flujo: el lock de
 * fila del cursor (FOR UPDATE) se toma en el INSERT ... ON DUPLICATE y se suelta en
 * commit/rollback; las escrituras de la transacción sólo se ven al confirmar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

type Row = { last: Date | null };
const db = vi.hoisted(() => ({
  cursors: new Map<string, { last: Date | null }>(),
  inbox: new Map<string, { outcome: string; occurredAt: Date | null }>(),
  locks: new Map<string, Promise<void>>(),
  failGetConnection: false,
  failCommit: false,
}));

function makeConn() {
  let releaseLock: (() => void) | null = null;
  let pendingInbox: Array<[string, { outcome: string; occurredAt: Date | null }]> = [];
  let pendingCursor: Array<[string, Date]> = [];
  const end = () => {
    releaseLock?.();
    releaseLock = null;
    pendingInbox = [];
    pendingCursor = [];
  };
  return {
    beginTransaction: vi.fn(async () => {}),
    release: vi.fn(),
    rollback: vi.fn(async () => end()),
    commit: vi.fn(async () => {
      if (db.failCommit) throw Object.assign(new Error("lost connection"), { code: "PROTOCOL_CONNECTION_LOST" });
      for (const [k, v] of pendingInbox) db.inbox.set(k, v);
      for (const [k, d] of pendingCursor) {
        const row = db.cursors.get(k)!;
        if (!row.last || row.last < d) row.last = d;
      }
      end();
    }),
    query: vi.fn(async (sql: string, p: unknown[]) => {
      if (sql.startsWith("INSERT INTO WebhookResourceCursor")) {
        const key = `${p[0]}|${p[1]}`;
        while (db.locks.has(key)) await db.locks.get(key);
        let release!: () => void;
        db.locks.set(key, new Promise<void>((r) => (release = r)));
        releaseLock = () => {
          db.locks.delete(key);
          release();
        };
        if (!db.cursors.has(key)) db.cursors.set(key, { last: null } as Row);
        return [{}];
      }
      if (sql.includes("AS is_stale")) {
        const row = db.cursors.get(`${p[2]}|${p[3]}`)!;
        const at = p[0] as Date | null;
        return [[{ is_stale: row.last && at && at < row.last ? 1 : 0 }]];
      }
      if (sql.startsWith("SELECT outcome FROM WebhookInbox")) {
        const r = db.inbox.get(`${p[0]}|${p[1]}`);
        return [r ? [{ outcome: r.outcome }] : []];
      }
      if (sql.startsWith("INSERT INTO WebhookInbox")) {
        const key = `${p[0]}|${p[1]}`;
        if (db.inbox.has(key)) throw Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
        pendingInbox.push([key, { outcome: p[5] as string, occurredAt: p[4] as Date | null }]);
        return [{}];
      }
      if (sql.trimStart().startsWith("UPDATE WebhookResourceCursor")) {
        pendingCursor.push([`${p[2]}|${p[3]}`, p[0] as Date]);
        return [{}];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    }),
  };
}

vi.mock("@/modules/storage/db", () => ({
  default: {
    getConnection: vi.fn(async () => {
      if (db.failGetConnection) throw Object.assign(new Error("pool"), { code: "ECONNREFUSED" });
      return makeConn();
    }),
  },
}));

import { processWebhookOnce, paddleInboxEvent, type InboxEvent } from "@/lib/webhookInbox";

const T = (iso: string) => new Date(iso);
const ev = (o: Partial<InboxEvent> = {}): InboxEvent => ({
  provider: "paddle",
  eventId: "evt_1",
  eventType: "subscription.updated",
  cursorKey: "sub:sub_1",
  occurredAt: T("2026-01-01T10:00:00.000Z"),
  enforceOrder: true,
  ...o,
});
const ok = () => vi.fn(async () => NextResponse.json({ success: true }));

beforeEach(() => {
  db.cursors.clear();
  db.inbox.clear();
  db.locks.clear();
  db.failGetConnection = false;
  db.failCommit = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PERIM-08 — processWebhookOnce", () => {
  it("primera entrega: corre el handler, registra el evento y avanza el cursor", async () => {
    const handler = ok();
    const res = await processWebhookOnce(ev(), handler);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(db.inbox.get("paddle|evt_1")?.outcome).toBe("processed");
    expect(db.cursors.get("paddle|sub:sub_1")?.last).toEqual(T("2026-01-01T10:00:00.000Z"));
  });

  it("reentrega del mismo evento: 200 sin volver a aplicarlo", async () => {
    const handler = ok();
    await processWebhookOnce(ev(), handler);
    const res = await processWebhookOnce(ev(), handler);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("la misma entrega concurrente se aplica una sola vez", async () => {
    let calls = 0;
    const handler = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return NextResponse.json({ success: true });
    });
    const res = await Promise.all(Array.from({ length: 8 }, () => processWebhookOnce(ev(), handler)));
    expect(calls).toBe(1);
    expect(res.every((r) => r.status === 200)).toBe(true);
  });

  it("un evento atrasado no revierte uno más nuevo: se registra como stale y no corre", async () => {
    await processWebhookOnce(ev({ eventId: "evt_new", occurredAt: T("2026-01-02T00:00:00Z") }), ok());
    const handler = ok();
    const res = await processWebhookOnce(ev({ eventId: "evt_old", occurredAt: T("2026-01-01T00:00:00Z") }), handler);
    expect(await res.json()).toEqual({ received: true, stale: true });
    expect(handler).not.toHaveBeenCalled();
    expect(db.inbox.get("paddle|evt_old")?.outcome).toBe("stale");
    expect(db.cursors.get("paddle|sub:sub_1")?.last).toEqual(T("2026-01-02T00:00:00Z"));
  });

  it("entregas concurrentes fuera de orden: la vieja nunca pisa a la nueva", async () => {
    const applied: string[] = [];
    const h = (id: string) => vi.fn(async () => {
      await new Promise((r) => setTimeout(r, id === "evt_new" ? 10 : 1));
      applied.push(id);
      return NextResponse.json({ success: true });
    });
    await Promise.all([
      processWebhookOnce(ev({ eventId: "evt_new", occurredAt: T("2026-01-02T00:00:00Z") }), h("evt_new")),
      processWebhookOnce(ev({ eventId: "evt_old", occurredAt: T("2026-01-01T00:00:00Z") }), h("evt_old")),
    ]);
    expect(applied.at(-1)).toBe("evt_new");
  });

  it("mismo timestamp: se aplica (orden de llegada), no se descarta", async () => {
    await processWebhookOnce(ev({ eventId: "evt_a" }), ok());
    const handler = ok();
    await processWebhookOnce(ev({ eventId: "evt_b" }), handler);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("enforceOrder=false (baja): se aplica aunque sea vieja y el cursor no retrocede", async () => {
    await processWebhookOnce(ev({ eventId: "evt_new", occurredAt: T("2026-01-02T00:00:00Z") }), ok());
    const handler = ok();
    await processWebhookOnce(ev({ eventId: "evt_cancel", eventType: "subscription.canceled", enforceOrder: false, occurredAt: T("2026-01-01T00:00:00Z") }), handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(db.cursors.get("paddle|sub:sub_1")?.last).toEqual(T("2026-01-02T00:00:00Z"));
  });

  it("onStale: un evento atrasado corre sólo el efecto mínimo y no mueve el cursor", async () => {
    await processWebhookOnce(ev({ eventId: "evt_new", occurredAt: T("2026-01-02T00:00:00Z") }), ok());
    const handler = ok();
    const onStale = ok();
    await processWebhookOnce(ev({ eventId: "evt_created", eventType: "subscription.created", occurredAt: T("2026-01-01T00:00:00Z") }), handler, { onStale });
    expect(handler).not.toHaveBeenCalled();
    expect(onStale).toHaveBeenCalledOnce();
    expect(db.inbox.get("paddle|evt_created")?.outcome).toBe("stale");
  });

  it("ámbitos distintos no se descartan entre sí", async () => {
    await processWebhookOnce(ev({ eventId: "evt_a", cursorKey: "sub:x:status", occurredAt: T("2026-01-02T00:00:00Z") }), ok());
    const handler = ok();
    await processWebhookOnce(ev({ eventId: "evt_b", cursorKey: "sub:x:plan", occurredAt: T("2026-01-01T00:00:00Z") }), handler);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("handler con respuesta de error: rollback, nada registrado y el reintento vuelve a aplicarlo", async () => {
    const failing = vi.fn(async () => NextResponse.json({ error: "x" }, { status: 500 }));
    expect((await processWebhookOnce(ev(), failing)).status).toBe(500);
    expect(db.inbox.size).toBe(0);
    expect(db.cursors.get("paddle|sub:sub_1")?.last).toBeNull();
    const handler = ok();
    expect((await processWebhookOnce(ev(), handler)).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("handler que lanza: 500 genérico, rollback y reintento posible", async () => {
    const res = await processWebhookOnce(ev(), vi.fn(async () => { throw new Error("secreto interno"); }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secreto");
    expect(db.inbox.size).toBe(0);
    expect(db.locks.size).toBe(0);
  });

  it("sin base: 503 con Retry-After y el handler no corre (nunca sin deduplicar)", async () => {
    db.failGetConnection = true;
    const handler = ok();
    const res = await processWebhookOnce(ev(), handler);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(handler).not.toHaveBeenCalled();
  });

  it("falla el commit después del efecto: 503 para que el proveedor reintente, nada queda como procesado", async () => {
    db.failCommit = true;
    const res = await processWebhookOnce(ev(), ok());
    expect(res.status).toBe(503);
    expect(db.inbox.size).toBe(0);
  });

  it.each([
    ["eventId vacío", { eventId: "" }],
    ["eventId con espacios", { eventId: "evt 1" }],
    ["eventId larguísimo", { eventId: "e".repeat(129) }],
    ["cursorKey vacío", { cursorKey: "" }],
    ["fecha inválida", { occurredAt: new Date("nope") }],
  ])("%s: 400 sin tocar la base", async (_n, o) => {
    const handler = ok();
    const res = await processWebhookOnce(ev(o as Partial<InboxEvent>), handler);
    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("PERIM-08 — paddleInboxEvent", () => {
  const base = { event_id: "evt_01h04vsc0qhwtsbsxh3422wjs4", occurred_at: "2026-01-01T10:00:00.123456Z" };

  it("suscripción: cursor por suscripción y orden obligatorio", () => {
    const e = paddleInboxEvent({ ...base, event_type: "subscription.updated", data: { id: "sub_01abc" } });
    expect(e).toMatchObject({ provider: "paddle", eventId: base.event_id, cursorKey: "sub:sub_01abc", enforceOrder: true });
    expect(e?.occurredAt?.toISOString()).toBe("2026-01-01T10:00:00.123Z");
  });

  it("subscription.canceled se aplica siempre (no se ordena), mismo cursor", () => {
    expect(paddleInboxEvent({ ...base, event_type: "subscription.canceled", data: { id: "sub_01abc" } }))
      .toMatchObject({ cursorKey: "sub:sub_01abc", enforceOrder: false });
  });

  it("transacciones y ajustes: sólo deduplicación", () => {
    expect(paddleInboxEvent({ ...base, event_type: "transaction.completed", data: { id: "txn_01abc" } }))
      .toMatchObject({ cursorKey: "transaction:txn_01abc", enforceOrder: false });
    expect(paddleInboxEvent({ ...base, event_type: "adjustment.updated", data: { id: "adj_01abc" } }))
      .toMatchObject({ cursorKey: "adjustment:adj_01abc", enforceOrder: false });
  });

  it.each([
    ["sin event_id", { occurred_at: base.occurred_at, event_type: "subscription.updated", data: { id: "sub_1" } }],
    ["event_id con otro formato", { ...base, event_id: "1; DROP", event_type: "subscription.updated", data: { id: "sub_1" } }],
    ["sin occurred_at", { event_id: base.event_id, event_type: "subscription.updated", data: { id: "sub_1" } }],
    ["occurred_at inválido", { ...base, occurred_at: "ayer", event_type: "subscription.updated", data: { id: "sub_1" } }],
    ["suscripción sin id", { ...base, event_type: "subscription.updated", data: {} }],
    ["no es objeto", "x"],
  ])("%s → null", (_n, payload) => {
    expect(paddleInboxEvent(payload)).toBeNull();
  });
});

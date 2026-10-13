// @vitest-environment node
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { revertirComision } = vi.hoisted(() => ({ revertirComision: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({
  default: {
    getConnection: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue([]),
      query: vi.fn().mockResolvedValue([[]]),
      release: vi.fn(),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    })),
    query: vi.fn().mockResolvedValue([[]]),
  },
}));
vi.mock("@/lib/paddleTierMap", () => ({
  priceIdToTier: vi.fn(() => null),
  tierToPriceId: vi.fn(() => "pri_test_123"),
  getPaddleBaseUrl: vi.fn(() => "https://sandbox-api.paddle.com"),
}));
vi.mock("@/services/affiliates.service", () => ({ devengarComision: vi.fn(), revertirComision }));
vi.mock("@/services/commissions.service", () => ({ devengarComisionComercial: vi.fn(), cancelarComisionesPorChurn: vi.fn(), ajustarComisionesPorReembolsoParcial: vi.fn() }));

import { POST } from "@/app/api/webhooks/paddle/route";

/**
 * Los reembolsos y contracargos de Paddle Billing llegan como *adjustments* (`adjustment.created` y `adjustment.updated`):
 * el evento `transaction.refunded` que el handler esperaba no existe, así que la comisión de un cobro devuelto nunca se
 * revertía. Estos tests cuidan cuándo SÍ se revierte (reembolso o contracargo aprobado y total) y, igual de importante,
 * cuándo NO (crédito, pendiente, rechazado, parcial, avisos y reversiones de Paddle).
 */
const SECRETO = "secreto-de-prueba";
const TXN = "txn_01k0000000000000000000000a";

function evento(tipo: string, ajuste: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event_type: tipo, data: { id: "adj_01k0000000000000000000000b", transaction_id: TXN, ...ajuste } });
  const h1 = crypto.createHmac("sha256", SECRETO).update(`${ts}:${body}`).digest("hex");
  return new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${h1}` } });
}

describe("webhook de Paddle: ajustes (reembolsos y contracargos)", () => {
  beforeEach(() => {
    process.env.PADDLE_WEBHOOK_SECRET = SECRETO;
    revertirComision.mockReset();
    revertirComision.mockResolvedValue({ revertidas: 2 });
  });
  afterEach(() => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  describe("revierte la comisión del cobro", () => {
    it.each([
      ["un reembolso total aprobado que llega en adjustment.updated (lo normal en sandbox y en live con aprobación manual)", "adjustment.updated", "refund"],
      ["un reembolso total que nace aprobado, en adjustment.created (aprobación automática)", "adjustment.created", "refund"],
      ["un contracargo total aprobado: la plata también volvió al cliente", "adjustment.created", "chargeback"],
    ])("%s", async (_caso, tipo, action) => {
      const r = await POST(evento(tipo, { action, status: "approved", type: "full" }));
      expect(r.status).toBe(200);
      expect(revertirComision).toHaveBeenCalledWith(TXN);
      expect(await r.json()).toMatchObject({ success: true, reversedCommissions: 2 });
    });

    it("created y updated del mismo ajuste dan la misma reversión: se puede repetir sin efecto doble", async () => {
      await POST(evento("adjustment.created", { action: "refund", status: "approved", type: "full" }));
      await POST(evento("adjustment.updated", { action: "refund", status: "approved", type: "full" }));
      expect(revertirComision.mock.calls.map(([t]) => t)).toEqual([TXN, TXN]);
    });
  });

  describe("NO revierte", () => {
    it.each([
      ["un reembolso todavía pendiente de aprobación", { action: "refund", status: "pending_approval", type: "full" }],
      ["un reembolso rechazado por Paddle", { action: "refund", status: "rejected", type: "full" }],
      ["un crédito: no devuelve plata", { action: "credit", status: "approved", type: "full" }],
      ["el aviso de un contracargo que todavía no ocurrió", { action: "chargeback_warning", status: "approved", type: "full" }],
      ["la reversión de un contracargo: se decide a mano", { action: "chargeback_reverse", status: "approved", type: "full" }],
      ["la reversión de un crédito", { action: "credit_reverse", status: "approved", type: "full" }],
      ["un reembolso ya revertido por Paddle", { action: "refund", status: "reversed", type: "full" }],
      ["un ajuste sin transacción", { action: "refund", status: "approved", type: "full", transaction_id: "" }],
    ])("%s", async (_caso, ajuste) => {
      const r = await POST(evento("adjustment.updated", ajuste));
      expect(r.status).toBe(200);
      expect(revertirComision).not.toHaveBeenCalled();
    });

    // La comisión de un parcial NO se revierte entera: se reduce en proporción (paddleWebhookReembolsos.test.ts). Acá se cuida que
    // no pase por `revertirComision` y que, si el ajuste no trae el subtotal, quede dicho en el log en vez de ajustar a ciegas.
    it.each(["refund", "chargeback"])("un %s PARCIAL aprobado no revierte la comisión entera; sin subtotal legible lo deja en el log", async (action) => {
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const r = await POST(evento("adjustment.updated", { action, status: "approved", type: "partial" }));
      expect(r.status).toBe(200);
      expect(revertirComision).not.toHaveBeenCalled();
      const log = aviso.mock.calls.flat().join(" ");
      expect(log).toContain(action);
      expect(log).toMatch(/parcial/i);
      expect(log).toContain("adj_01k0000000000000000000000b");
    });

    it("un ajuste sin el campo type (forma inesperada) tampoco se trata como total", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await POST(evento("adjustment.updated", { action: "refund", status: "approved" }));
      expect(revertirComision).not.toHaveBeenCalled();
    });
  });

  it("transaction.refunded ya no revierte nada: ese evento no existe en Paddle Billing", async () => {
    const r = await POST(evento("transaction.refunded", { action: "refund", status: "approved", type: "full" }));
    expect(r.status).toBe(200);
    expect(revertirComision).not.toHaveBeenCalled();
    expect(await r.json()).toMatchObject({ message: "Event ignored" });
  });

  it("los ajustes pasan por la misma verificación de firma que el resto de los eventos", async () => {
    const sinFirma = new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", body: JSON.stringify({ event_type: "adjustment.updated", data: { action: "refund", status: "approved", type: "full", transaction_id: TXN } }) });
    expect((await POST(sinFirma)).status).toBe(401);
    expect(revertirComision).not.toHaveBeenCalled();
  });
});

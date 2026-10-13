// @vitest-environment node
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  ejecutar: vi.fn(),
  aplicar: vi.fn(),
  liberar: vi.fn(),
  revertir: vi.fn(),
  cancelarAddon: vi.fn(),
  transicion: vi.fn(),
  churn: vi.fn(),
  avisoBaja: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
  default: {
    getConnection: vi.fn(async () => ({ execute: m.ejecutar, query: vi.fn(async () => [[{ tier: "Professional" }]]), release: vi.fn() })),
    query: m.poolQuery,
  },
}));
vi.mock("@/lib/paddleAddons", () => ({ resolveAddonQuantities: vi.fn(() => ({})), applyAddonCapacity: vi.fn() }));
vi.mock("@/services/tenantLifecycle.service", () => ({ recordTenantLifecycleTransition: m.transicion }));
vi.mock("@/services/providerLifecycleService", () => ({ applyTierChange: vi.fn(async () => {}) }));
vi.mock("@/lib/billingAlerts", () => ({ notifyInternalCancellation: m.avisoBaja }));
vi.mock("@/services/affiliates.service", () => ({ devengarComision: vi.fn(), revertirComision: m.revertir }));
vi.mock("@/services/commissions.service", () => ({ devengarComisionComercial: vi.fn(), cancelarComisionesPorChurn: m.churn }));
vi.mock("@/services/refunds.service", () => ({ aplicarReembolsoAprobado: m.aplicar, liberarReembolsoRechazado: m.liberar }));
vi.mock("@/services/tenantAddons.service", () => ({ TenantAddonsService: { purchaseAddon: vi.fn(), cancelRecurringAddon: m.cancelarAddon } }));

import { POST } from "@/app/api/webhooks/paddle/route";
import { customDataFirmado } from "@/lib/checkoutBinding";

const SECRETO = "secreto-de-prueba";
const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const TXN = "txn_01m4rzzzzzzzzzzzzzzzzzzzzz";
const PRECIO_PRO = "pri_plan_professional_mensual";
const PRECIO_MOD = "pri_modulo_mensual";
const SUB_PLAN = "sub_01m4plan000000000000000000";
const SUB_MOD = "sub_01m4modulo0000000000000000";

function evento(tipo: string, data: Record<string, unknown>): NextRequest {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event_type: tipo, data });
  const h1 = crypto.createHmac("sha256", SECRETO).update(`${ts}:${body}`).digest("hex");
  return new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${h1}` } });
}

const ajuste = (extra: Record<string, unknown> = {}, tipo = "adjustment.updated") =>
  evento(tipo, { id: "adj_01", action: "refund", type: "full", status: "approved", transaction_id: TXN, ...extra });

const moduloRecurrente = () =>
  customDataFirmado({ tenantId: TENANT, priceId: PRECIO_MOD, addonKey: "mod_security", addonType: "recurring", months: 1 });

const suscripcion = (tipo: string, id: string, customData: Record<string, unknown>, precio: string) =>
  evento(tipo, { id, status: tipo.endsWith("canceled") ? "canceled" : "past_due", custom_data: customData, items: [{ price: { id: precio }, quantity: 1 }], current_billing_period: null });

beforeEach(() => {
  process.env.PADDLE_WEBHOOK_SECRET = SECRETO;
  Object.values(m).forEach((f) => f.mockReset());
  m.poolQuery.mockResolvedValue([[]]);
  m.ejecutar.mockResolvedValue([{}]);
  m.aplicar.mockResolvedValue({ aplicado: true, addonRevocado: true, accesoCortado: false });
  m.revertir.mockResolvedValue({ revertidas: 1 });
  m.cancelarAddon.mockResolvedValue(1);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.PADDLE_WEBHOOK_SECRET;
  vi.restoreAllMocks();
});

describe("adjustment.*: efectos de un reembolso", () => {
  it.each(["adjustment.created", "adjustment.updated"])("%s: un reembolso TOTAL aprobado revierte comisiones y aplica los efectos en la plataforma", async (tipo) => {
    const r = await POST(ajuste({}, tipo));
    expect(r.status).toBe(200);
    expect(m.revertir).toHaveBeenCalledWith(TXN);
    expect(m.aplicar).toHaveBeenCalledWith(TXN);
    expect(await r.json()).toMatchObject({ success: true, reversedCommissions: 1, aplicado: true, addonRevocado: true });
  });

  it("un contracargo TOTAL aprobado tiene los mismos efectos", async () => {
    await POST(ajuste({ action: "chargeback" }));
    expect(m.aplicar).toHaveBeenCalledWith(TXN);
  });

  it("un reembolso RECHAZADO libera el cobro y no revierte ni revoca nada", async () => {
    await POST(ajuste({ status: "rejected" }));
    expect(m.liberar).toHaveBeenCalledWith(TXN);
    expect(m.revertir).not.toHaveBeenCalled();
    expect(m.aplicar).not.toHaveBeenCalled();
  });

  it.each([
    ["pendiente de aprobación", { status: "pending_approval" }],
    ["PARCIAL aprobado", { type: "partial" }],
    ["un crédito", { action: "credit" }],
    ["un aviso de contracargo", { action: "chargeback_warning" }],
    ["una reversión de contracargo", { action: "chargeback_reverse" }],
  ])("%s no cambia nada en la plataforma", async (_n, extra) => {
    const r = await POST(ajuste(extra));
    expect(r.status).toBe(200);
    expect(m.aplicar).not.toHaveBeenCalled();
    expect(m.liberar).not.toHaveBeenCalled();
    expect(m.revertir).not.toHaveBeenCalled();
  });

  it("un rechazo de algo que no es un reembolso (un contracargo) no libera ningún cobro", async () => {
    await POST(ajuste({ action: "chargeback", status: "rejected" }));
    expect(m.liberar).not.toHaveBeenCalled();
  });

  it("si aplicar los efectos falla, contesta 500 para que Paddle reintente", async () => {
    m.aplicar.mockRejectedValue(new Error("Paddle no pudo cancelar"));
    expect((await POST(ajuste())).status).toBe(500);
  });
});

describe("la suscripción de un MÓDULO no es el plan del tenant", () => {
  it("subscription.canceled de un módulo da de baja el módulo y NO cancela al tenant, ni corta sus comisiones, ni avisa una baja", async () => {
    const r = await POST(suscripcion("subscription.canceled", SUB_MOD, moduloRecurrente(), PRECIO_MOD));
    expect(r.status).toBe(200);
    expect(m.cancelarAddon).toHaveBeenCalledWith(TENANT, "mod_security");
    expect(m.transicion).not.toHaveBeenCalled();
    expect(m.churn).not.toHaveBeenCalled();
    expect(m.avisoBaja).not.toHaveBeenCalled();
  });

  it("si no se puede dar de baja el módulo, 500 (Paddle reintenta) en vez de dejarlo activo sin pagar", async () => {
    m.cancelarAddon.mockRejectedValue(new Error("ECONNRESET"));
    expect((await POST(suscripcion("subscription.canceled", SUB_MOD, moduloRecurrente(), PRECIO_MOD))).status).toBe(500);
  });

  it("subscription.past_due de un módulo no suspende al tenant", async () => {
    const r = await POST(suscripcion("subscription.past_due", SUB_MOD, moduloRecurrente(), PRECIO_MOD));
    expect(r.status).toBe(200);
    expect(m.transicion).not.toHaveBeenCalled();
  });

  it("control: subscription.canceled del PLAN sigue cancelando al tenant", async () => {
    m.poolQuery.mockImplementation(async (sql: string) => (String(sql).includes("paddle_subscription_id") ? [[{ tenant_id: TENANT }]] : [[]]));
    await POST(suscripcion("subscription.canceled", SUB_PLAN, { tenant_id: TENANT }, PRECIO_PRO));
    expect(m.transicion).toHaveBeenCalledWith(TENANT, "CANCELED", expect.anything());
    expect(m.cancelarAddon).not.toHaveBeenCalled();
    expect(m.churn).toHaveBeenCalledWith(TENANT);
  });

  it("control: subscription.past_due del PLAN sigue suspendiendo al tenant", async () => {
    m.poolQuery.mockImplementation(async (sql: string) => (String(sql).includes("paddle_subscription_id") ? [[{ tenant_id: TENANT }]] : [[]]));
    await POST(suscripcion("subscription.past_due", SUB_PLAN, { tenant_id: TENANT }, PRECIO_PRO));
    expect(m.transicion).toHaveBeenCalledWith(TENANT, "SUSPENDED", expect.anything());
  });
});

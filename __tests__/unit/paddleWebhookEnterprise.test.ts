// @vitest-environment node
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { poolQuery, ejecutar, consultaConexion } = vi.hoisted(() => ({ poolQuery: vi.fn(), ejecutar: vi.fn(), consultaConexion: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({
  default: {
    getConnection: vi.fn(async () => ({
      execute: ejecutar,
      query: consultaConexion,
      release: vi.fn(),
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    })),
    query: poolQuery,
  },
}));
vi.mock("@/lib/paddleAddons", () => ({ resolveAddonQuantities: vi.fn(() => ({})), applyAddonCapacity: vi.fn(async () => {}) }));
vi.mock("@/services/tenantLifecycle.service", () => ({ recordTenantLifecycleTransition: vi.fn(async () => {}) }));
vi.mock("@/services/providerLifecycleService", () => ({ applyTierChange: vi.fn(async () => {}) }));
vi.mock("@/lib/billingAlerts", () => ({ notifyInternalCancellation: vi.fn(async () => {}) }));
vi.mock("@/services/affiliates.service", () => ({ devengarComision: vi.fn(), revertirComision: vi.fn() }));
vi.mock("@/services/commissions.service", () => ({ devengarComisionComercial: vi.fn(), cancelarComisionesPorChurn: vi.fn() }));

import { POST } from "@/app/api/webhooks/paddle/route";
import { customDataFirmado } from "@/lib/checkoutBinding";

/**
 * Cómo se decide el tier cuando llega `subscription.created` / `subscription.updated`.
 *
 * El defecto que cuidan: `custom_data.tier` iba primero. Quien abre un checkout con Paddle.js elige su `customData` (Paddle
 * lo documenta así), así que pagar el precio de Professional con `customData: { tenant_id, tier: "Enterprise" }` activaba
 * Enterprise. Ahora el tier sale del precio pagado, y Enterprise —que usa un precio a medida— sólo si ese precio es el que un
 * SuperAdmin registró para ese tenant (`TenantSubscriptions.paddle_price_id`, lo escribe `generatePaddleCheckoutLink`).
 */
const SECRETO = "secreto-de-prueba";
const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const OTRO_TENANT = "8b41364f-581a-4e43-b7cb-13138dac5517";
const PRECIO_PRO = "pri_plan_professional_mensual";
const PRECIO_BUSINESS = "pri_plan_business_mensual";
const PRECIO_ENTERPRISE = "pri_enterprise_a_medida_acme";

/** `customData` llega FIRMADO por el servidor, como en un checkout legítimo; los casos de checkout armado a mano están en paddleWebhookVinculo.test.ts. */
function evento(tipo: "subscription.created" | "subscription.updated", precio: string, customData: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    event_type: tipo,
    data: {
      id: "sub_01m4rzzzzzzzzzzzzzzzzzzzzz",
      status: "active",
      custom_data: customDataFirmado({ tenantId: String(customData.tenant_id), priceId: precio, tier: customData.tier as string | undefined }),
      items: [{ price: { id: precio }, quantity: 1 }],
      current_billing_period: { ends_at: "2026-11-12T00:00:00Z" },
    },
  });
  const h1 = crypto.createHmac("sha256", SECRETO).update(`${ts}:${body}`).digest("hex");
  return new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${h1}` } });
}

/** Lo que el handler escribió en `Tenants.tier`, o `undefined` si el UPDATE no tocó el tier. */
function tierEscrito(): string | undefined {
  const update = ejecutar.mock.calls.find(([sql]) => String(sql).includes("UPDATE Tenants"));
  if (!update) throw new Error("el handler no hizo ningún UPDATE de Tenants");
  const [sql, params] = update as [string, unknown[]];
  if (!/\btier = \?/.test(sql)) return undefined;
  // created: [id, estado, TIER, trial, acceso, tenant]; updated: [estado, TIER, trial, acceso, tenant]
  return String(params[sql.includes("paddle_subscription_id = ?") ? 2 : 1]);
}

/** El registro de deals Enterprise: qué (tenant, precio) hay registrados. */
function registrar(...deals: Array<[string, string]>) {
  poolQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (String(sql).includes("TenantSubscriptions")) return [deals.some(([t, p]) => t === params[0] && p === params[1]) ? [{ "1": 1 }] : []];
    return [[]];
  });
}

beforeEach(() => {
  process.env.PADDLE_WEBHOOK_SECRET = SECRETO;
  process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = PRECIO_PRO;
  process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY = PRECIO_BUSINESS;
  poolQuery.mockReset();
  ejecutar.mockReset().mockResolvedValue([{}]);
  consultaConexion.mockReset().mockResolvedValue([[{ tier: "Professional" }]]);
  registrar();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.PADDLE_WEBHOOK_SECRET;
  delete process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY;
  delete process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY;
  vi.restoreAllMocks();
});

describe.each(["subscription.created", "subscription.updated"] as const)("%s: tier de la suscripción", (tipo) => {
  it("el deal Enterprise registrado para ESTE tenant activa Enterprise", async () => {
    registrar([TENANT, PRECIO_ENTERPRISE]);
    const r = await POST(evento(tipo, PRECIO_ENTERPRISE, { tenant_id: TENANT, tier: "Enterprise" }));
    expect(r.status).toBe(200);
    expect(tierEscrito()).toBe("Enterprise");
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining("TenantSubscriptions"), [TENANT, PRECIO_ENTERPRISE]);
  });

  it("pagar el precio de Professional con custom_data.tier = Enterprise deja Professional (el precio decide, aun con el vínculo firmado)", async () => {
    registrar([TENANT, PRECIO_PRO]); // aunque el registro dijera que sí, un precio de plan lo decide el precio
    await POST(evento(tipo, PRECIO_PRO, { tenant_id: TENANT, tier: "Enterprise" }));
    expect(tierEscrito()).toBe("Professional");
    expect(poolQuery).not.toHaveBeenCalledWith(expect.stringContaining("TenantSubscriptions"), expect.anything());
  });

  it("lo mismo con el precio de Business", async () => {
    await POST(evento(tipo, PRECIO_BUSINESS, { tenant_id: TENANT, tier: "Enterprise" }));
    expect(tierEscrito()).toBe("Business");
  });

  it("custom_data.tier = Enterprise con un precio que nadie registró: no se activa Enterprise y el tier queda como estaba", async () => {
    await POST(evento(tipo, "pri_un_precio_cualquiera", { tenant_id: TENANT, tier: "Enterprise" }));
    expect(tierEscrito()).toBeUndefined();
  });

  it("el precio registrado para OTRO tenant no sirve: no se puede activar Enterprise pagando el deal de un cliente a nombre de otro", async () => {
    registrar([OTRO_TENANT, PRECIO_ENTERPRISE]);
    await POST(evento(tipo, PRECIO_ENTERPRISE, { tenant_id: TENANT, tier: "Enterprise" }));
    expect(tierEscrito()).toBeUndefined();
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining("TenantSubscriptions"), [TENANT, PRECIO_ENTERPRISE]);
  });

  it("un precio registrado sin custom_data.tier tampoco activa Enterprise por sí solo", async () => {
    registrar([TENANT, PRECIO_ENTERPRISE]);
    await POST(evento(tipo, PRECIO_ENTERPRISE, { tenant_id: TENANT }));
    expect(tierEscrito()).toBeUndefined();
  });

  it("custom_data.tier = Business o Professional con un precio desconocido ya no cuenta: el precio decide", async () => {
    await POST(evento(tipo, "pri_un_precio_cualquiera", { tenant_id: TENANT, tier: "Business" }));
    expect(tierEscrito()).toBeUndefined();
  });

  it("sin custom_data.tier y con un precio de plan: el tier es el del precio, como siempre", async () => {
    await POST(evento(tipo, PRECIO_BUSINESS, { tenant_id: TENANT }));
    expect(tierEscrito()).toBe("Business");
  });

  it("si la base falla al consultar el registro, 500 (Paddle reintenta) en vez de dejar al cliente pago sin plan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    poolQuery.mockRejectedValue(new Error("ECONNRESET"));
    const r = await POST(evento(tipo, PRECIO_ENTERPRISE, { tenant_id: TENANT, tier: "Enterprise" }));
    expect(r.status).toBe(500);
  });
});

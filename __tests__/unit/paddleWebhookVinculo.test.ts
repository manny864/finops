// @vitest-environment node
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { poolQuery, ejecutar, purchaseAddon, aplicarCapacidad } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  ejecutar: vi.fn(),
  purchaseAddon: vi.fn(),
  aplicarCapacidad: vi.fn(),
}));

// PERIM-08: el inbox durable se prueba en webhookInboxPerim08.test.ts; acá pasa directo al handler.
vi.mock("@/lib/webhookInbox", async (orig) => ({
  ...(await orig<typeof import("@/lib/webhookInbox")>()),
  processWebhookOnce: (_e: unknown, handler: () => Promise<Response>) => handler(),
  paddleInboxEvent: () => ({ provider: "paddle", eventId: "evt_test", eventType: "test", cursorKey: "event:evt_test", occurredAt: null, enforceOrder: false }),
}));

vi.mock("@/modules/storage/db", () => ({
  default: {
    getConnection: vi.fn(async () => ({ execute: ejecutar, query: vi.fn(async () => [[{ tier: "Professional" }]]), release: vi.fn() })),
    query: poolQuery,
  },
}));
vi.mock("@/lib/paddleAddons", () => ({ resolveAddonQuantities: vi.fn(() => ({})), applyAddonCapacity: aplicarCapacidad }));
vi.mock("@/services/tenantLifecycle.service", () => ({ recordTenantLifecycleTransition: vi.fn(async () => {}) }));
vi.mock("@/services/providerLifecycleService", () => ({ applyTierChange: vi.fn(async () => {}) }));
vi.mock("@/lib/billingAlerts", () => ({ notifyInternalCancellation: vi.fn(async () => {}) }));
vi.mock("@/services/affiliates.service", () => ({ devengarComision: vi.fn(), revertirComision: vi.fn() }));
vi.mock("@/services/commissions.service", () => ({ devengarComisionComercial: vi.fn(), cancelarComisionesPorChurn: vi.fn() }));
vi.mock("@/services/tenantAddons.service", () => ({ TenantAddonsService: { purchaseAddon } }));

import { POST } from "@/app/api/webhooks/paddle/route";
import { customDataFirmado, verificarVinculo } from "@/lib/checkoutBinding";

/**
 * A quién se acredita y qué se acredita lo decide un vínculo FIRMADO por el servidor, no el `custom_data` que arma quien
 * abre el checkout con Paddle.js (el token de cliente y Paddle.js son públicos). Cada caso de abajo es un checkout armado
 * a mano que, antes de la firma, activaba un plan ajeno o regalaba meses de un módulo.
 */
const SECRETO = "secreto-de-prueba";
const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const VICTIMA = "8b41364f-581a-4e43-b7cb-13138dac5517";
const PRECIO_PRO = "pri_plan_professional_mensual";
const PRECIO_BARATO = "pri_modulo_1_mes";
const PRECIO_12M = "pri_modulo_12_meses";
const SUB = "sub_01m4rzzzzzzzzzzzzzzzzzzzzz";

function firmado(req: { type: string; data: Record<string, unknown> }): NextRequest {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event_type: req.type, data: req.data });
  const h1 = crypto.createHmac("sha256", SECRETO).update(`${ts}:${body}`).digest("hex");
  return new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", body, headers: { "paddle-signature": `ts=${ts};h1=${h1}` } });
}

const suscripcion = (type: "subscription.created" | "subscription.updated", precio: string, customData: unknown) =>
  firmado({
    type,
    data: { id: SUB, status: "active", custom_data: customData, items: [{ price: { id: precio }, quantity: 1 }], current_billing_period: { ends_at: "2026-11-12T00:00:00Z" } },
  });

const transaccion = (precio: string, customData: unknown) =>
  firmado({
    type: "transaction.completed",
    data: {
      id: "txn_01m4rzzzzzzzzzzzzzzzzzzzzz",
      subscription_id: null,
      currency_code: "USD",
      billed_at: "2026-10-12T00:00:00Z",
      custom_data: customData,
      items: [{ price: { id: precio }, quantity: 1 }],
      details: { totals: { subtotal: "4900" }, line_items: [{ price_id: precio }] },
    },
  });

/** Los UPDATE a Tenants que el handler hizo, con el tenant al que apuntaron (último parámetro). */
const tenantsActualizados = () =>
  ejecutar.mock.calls.filter(([sql]) => String(sql).includes("UPDATE Tenants")).map(([, params]) => (params as unknown[]).at(-1));

beforeEach(() => {
  process.env.PADDLE_WEBHOOK_SECRET = SECRETO;
  process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = PRECIO_PRO;
  poolQuery.mockReset().mockResolvedValue([[]]);
  ejecutar.mockReset().mockResolvedValue([{}]);
  purchaseAddon.mockReset().mockResolvedValue({});
  aplicarCapacidad.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.PADDLE_WEBHOOK_SECRET;
  delete process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY;
  vi.restoreAllMocks();
});

describe("subscription.*: el tenant sale de un vínculo firmado o de la suscripción ya registrada", () => {
  it("un alta firmada para el tenant lo activa", async () => {
    await POST(suscripcion("subscription.created", PRECIO_PRO, customDataFirmado({ tenantId: TENANT, priceId: PRECIO_PRO })));
    expect(tenantsActualizados()).toEqual([TENANT]);
  });

  it("custom_data con tenant_id armado a mano (sin firma) no toca a nadie: no se puede pagar a nombre de otro tenant", async () => {
    const r = await POST(suscripcion("subscription.created", PRECIO_PRO, { tenant_id: VICTIMA }));
    expect(r.status).toBe(200);
    expect(tenantsActualizados()).toEqual([]);
  });

  it("la firma de un checkout propio no sirve para cambiar el tenant destino", async () => {
    const propio = customDataFirmado({ tenantId: TENANT, priceId: PRECIO_PRO });
    await POST(suscripcion("subscription.created", PRECIO_PRO, { ...propio, tenant_id: VICTIMA }));
    expect(tenantsActualizados()).toEqual([]);
  });

  it("una firma legítima con un precio que NO se pagó no vale: se firmó para otro precio", async () => {
    const firmaDelModulo = customDataFirmado({ tenantId: TENANT, priceId: PRECIO_12M });
    await POST(suscripcion("subscription.created", PRECIO_PRO, firmaDelModulo));
    expect(tenantsActualizados()).toEqual([]);
  });

  it("una suscripción ya vinculada manda por encima de lo que diga su custom_data (renovaciones y cambios de plan, también las anteriores a la firma)", async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[]) =>
      String(sql).includes("paddle_subscription_id") && params[0] === SUB ? [[{ tenant_id: TENANT }]] : [[]]
    );
    await POST(suscripcion("subscription.updated", PRECIO_PRO, { tenant_id: VICTIMA })); // sin firma y apuntando a otro
    expect(tenantsActualizados()).toEqual([TENANT]);
  });
});

describe("subscription.updated vinculada: el tier Enterprise sólo lo pide un vínculo firmado", () => {
  it("custom_data.tier = Enterprise sin firma, con el precio registrado para el tenant, no activa Enterprise", async () => {
    const PRECIO_ENT = "pri_enterprise_a_medida";
    poolQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (String(sql).includes("paddle_subscription_id")) return [[{ tenant_id: TENANT }]];
      if (String(sql).includes("TenantSubscriptions")) return [params[0] === TENANT && params[1] === PRECIO_ENT ? [{ "1": 1 }] : []];
      return [[]];
    });
    await POST(suscripcion("subscription.updated", PRECIO_ENT, { tenant_id: TENANT, tier: "Enterprise" }));
    const update = ejecutar.mock.calls.find(([sql]) => String(sql).includes("UPDATE Tenants"));
    expect(String(update?.[0])).not.toMatch(/\btier = \?/);
  });
});

describe("transaction.completed: el add-on se acredita con lo que firmó el servidor", () => {
  const compra = (over: Record<string, unknown> = {}) => ({
    ...customDataFirmado({ tenantId: TENANT, priceId: PRECIO_BARATO, addonKey: "mod_security", addonType: "pass", months: 1 }),
    ...over,
  });

  it("la compra legítima acredita el módulo, el tipo y los meses firmados", async () => {
    await POST(transaccion(PRECIO_BARATO, compra()));
    expect(purchaseAddon).toHaveBeenCalledWith(TENANT, "mod_security", "pass", 1, "txn_01m4rzzzzzzzzzzzzzzzzzzzzz");
  });

  it("pagar el pase de 1 mes con custom_data.months = 12 forjado no regala meses: la firma no coincide", async () => {
    await POST(transaccion(PRECIO_BARATO, compra({ months: 12 })));
    expect(purchaseAddon).not.toHaveBeenCalled();
  });

  it("pedir otro módulo con la firma de uno barato tampoco: la firma ata el módulo", async () => {
    await POST(transaccion(PRECIO_BARATO, compra({ addon_key: "mod_databases" })));
    expect(purchaseAddon).not.toHaveBeenCalled();
  });

  it("si la suscripción ya está vinculada a OTRO tenant, el vínculo firmado de un tercero no acredita el módulo en ése", async () => {
    poolQuery.mockImplementation(async (sql: string) => (String(sql).includes("paddle_subscription_id") ? [[{ tenant_id: VICTIMA }]] : [[]]));
    const tx = firmado({
      type: "transaction.completed",
      data: {
        id: "txn_01m4rzzzzzzzzzzzzzzzzzzzzz",
        subscription_id: SUB,
        currency_code: "USD",
        custom_data: compra(),
        items: [{ price: { id: PRECIO_BARATO }, quantity: 1 }],
        details: { totals: { subtotal: "4900" } },
      },
    });
    await POST(tx);
    expect(purchaseAddon).not.toHaveBeenCalled();
  });

  it("un checkout armado a mano sin firma (tenant, módulo y meses a gusto) no acredita nada", async () => {
    const r = await POST(transaccion(PRECIO_BARATO, { tenant_id: TENANT, addon_key: "mod_security", addon_type: "pass", months: 120 }));
    expect(r.status).toBe(200);
    expect(purchaseAddon).not.toHaveBeenCalled();
  });

  it("la firma de la compra de 12 meses, usada para pagar el precio de 1 mes, no acredita: el precio firmado no se pagó", async () => {
    const de12 = customDataFirmado({ tenantId: TENANT, priceId: PRECIO_12M, addonKey: "mod_security", addonType: "pass", months: 12 });
    await POST(transaccion(PRECIO_BARATO, de12));
    expect(purchaseAddon).not.toHaveBeenCalled();
  });
});

describe("verificarVinculo", () => {
  const base = { tenantId: TENANT, priceId: PRECIO_PRO, addonKey: "mod_security", addonType: "pass", months: 3, tier: "Business" };

  it("round-trip: lo firmado se verifica y devuelve los mismos campos", () => {
    expect(verificarVinculo(customDataFirmado(base), [PRECIO_PRO])).toEqual(base);
  });

  it.each([
    ["tenant_id", VICTIMA],
    ["price_id", "pri_otro"],
    ["addon_key", "mod_databases"],
    ["addon_type", "recurring"],
    ["months", 12],
    ["tier", "Enterprise"],
  ])("cambiar %s invalida la firma", (campo, valor) => {
    const cd: Record<string, unknown> = { ...customDataFirmado(base), [campo]: valor };
    expect(verificarVinculo(cd, [PRECIO_PRO, "pri_otro"])).toBeNull();
  });

  it("agregar un campo firmado que no estaba (tier, add-on) invalida la firma", () => {
    const sinTier = customDataFirmado({ tenantId: TENANT, priceId: PRECIO_PRO });
    expect(verificarVinculo({ ...sinTier, tier: "Enterprise" }, [PRECIO_PRO])).toBeNull();
    expect(verificarVinculo({ ...sinTier, addon_key: "mod_security" }, [PRECIO_PRO])).toBeNull();
  });

  it("una firma hecha con otro secreto no verifica", () => {
    const cd = customDataFirmado(base);
    process.env.PADDLE_WEBHOOK_SECRET = "otro-secreto";
    expect(verificarVinculo(cd, [PRECIO_PRO])).toBeNull();
  });

  it.each([[null], [undefined], ["texto"], [{}], [{ tenant_id: TENANT }], [{ tenant_id: TENANT, price_id: PRECIO_PRO, sig: "zz" }]])(
    "un custom_data ajeno o mal formado (%j) da null y no lanza",
    (cd) => {
      expect(verificarVinculo(cd, [PRECIO_PRO])).toBeNull();
    }
  );

  it("sin PADDLE_WEBHOOK_SECRET no se puede firmar: lanza en vez de emitir una firma débil", () => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
    expect(() => customDataFirmado(base)).toThrow(/PADDLE_WEBHOOK_SECRET/);
  });
});

// @vitest-environment node
/**
 * PERIM-08 — Rutas de webhooks: qué llega al inbox y con qué datos.
 *
 * Paddle: firma con formato estricto (rotación con varios h1) y sobre firmado
 * (`event_id`, `occurred_at`) obligatorio. Marketplace: los datos aplicados salen de la
 * operación en la Fulfillment API, no del body (el JWT no lo firma).
 */
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  processWebhookOnce: vi.fn(),
  poolQuery: vi.fn(),
  poolExecute: vi.fn(),
  connQuery: vi.fn(),
  getConnection: vi.fn(),
  getOperation: vi.fn(),
  getSubscription: vi.fn(),
  recordTenantLifecycleTransition: vi.fn(),
}));

vi.mock("@/lib/webhookInbox", async (orig) => ({
  ...(await orig<typeof import("@/lib/webhookInbox")>()),
  processWebhookOnce: h.processWebhookOnce,
}));
vi.mock("@/modules/storage/db", () => ({
  default: { query: h.poolQuery, execute: h.poolExecute, getConnection: h.getConnection },
}));
vi.mock("@/lib/paddleTierMap", () => ({ priceIdToTier: vi.fn(() => null), tierToPriceId: vi.fn(), getPaddleBaseUrl: vi.fn() }));
vi.mock("@/services/affiliates.service", () => ({ devengarComision: vi.fn(), revertirComision: vi.fn() }));
vi.mock("@/services/commissions.service", () => ({ devengarComisionComercial: vi.fn(), cancelarComisionesPorChurn: vi.fn(), ajustarComisionesPorReembolsoParcial: vi.fn() }));
vi.mock("@/services/tenantLifecycle.service", () => ({ recordTenantLifecycleTransition: h.recordTenantLifecycleTransition }));
vi.mock("@/lib/billingAlerts", () => ({ notifyInternalCancellation: vi.fn() }));
vi.mock("@/services/providerLifecycleService", () => ({ applyTierChange: vi.fn() }));
vi.mock("@/lib/marketplace/azure", async (orig) => ({
  ...(await orig<typeof import("@/lib/marketplace/azure")>()),
  verifyWebhookJwt: vi.fn(async () => ({})),
  getOperation: h.getOperation,
  getSubscription: h.getSubscription,
}));

import { POST as paddlePOST } from "@/app/api/webhooks/paddle/route";
import { POST as azurePOST } from "@/app/api/webhooks/marketplace/azure/route";
import { MarketplaceOperationNotFound } from "@/lib/marketplace/azure";

const SECRET = "secreto-de-prueba";
const EVT = "evt_01h04vsc0qhwtsbsxh3422wjs4";
const SUB = "sub_01h04vsc0qhwtsbsxh3422wjs4";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  h.processWebhookOnce.mockImplementation((_e: unknown, handler: () => Promise<Response>) => handler());
  h.poolQuery.mockResolvedValue([[]]);
  h.poolExecute.mockResolvedValue([{}]);
  h.connQuery.mockResolvedValue([[]]);
  h.getConnection.mockResolvedValue({ query: h.connQuery, execute: h.connQuery, release: vi.fn() });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PERIM-08 — Paddle", () => {
  const body = (o: Record<string, unknown> = {}) =>
    JSON.stringify({ event_id: EVT, event_type: "subscription.updated", occurred_at: "2026-01-01T10:00:00Z", data: { id: SUB }, ...o });
  const sign = (ts: number, raw: string, secret = SECRET) => crypto.createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
  const req = (raw: string, signature: string) =>
    new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", body: raw, headers: { "paddle-signature": signature } });
  const now = () => Math.floor(Date.now() / 1000);

  it("evento firmado: llega al inbox con event_id, cursor de suscripción y orden", async () => {
    const raw = body();
    const res = await paddlePOST(req(raw, `ts=${now()};h1=${sign(now(), raw)}`));
    expect(res.status).toBe(200);
    expect(h.processWebhookOnce).toHaveBeenCalledOnce();
    expect(h.processWebhookOnce.mock.calls[0][0]).toMatchObject({
      provider: "paddle", eventId: EVT, cursorKey: `sub:${SUB}`, enforceOrder: true,
    });
    expect(h.processWebhookOnce.mock.calls[0][2]?.onStale).toBeUndefined();
  });

  it("rotación del secreto: con varios h1 alcanza con que uno coincida", async () => {
    const raw = body();
    const ts = now();
    const res = await paddlePOST(req(raw, `ts=${ts};h1=${sign(ts, raw, "viejo")};h1=${sign(ts, raw)}`));
    expect(res.status).toBe(200);
  });

  it.each([
    ["h1 que no es hex de 64", (ts: number) => `ts=${ts};h1=abc`],
    ["un h1 bueno y otro malformado", (ts: number, raw: string) => `ts=${ts};h1=${sign(ts, raw)};h1=zz`],
    ["ts duplicado", (ts: number, raw: string) => `ts=${ts};ts=${ts};h1=${sign(ts, raw)}`],
    ["ts no numérico", (_ts: number, raw: string) => `ts=1e9;h1=${sign(1e9, raw)}`],
    ["clave desconocida", (ts: number, raw: string) => `ts=${ts};h1=${sign(ts, raw)};x=1`],
    ["sin h1", (ts: number) => `ts=${ts}`],
    ["h1 en mayúsculas", (ts: number, raw: string) => `ts=${ts};h1=${sign(ts, raw).toUpperCase()}`],
    ["firma de otro secreto", (ts: number, raw: string) => `ts=${ts};h1=${sign(ts, raw, "otro")}`],
  ])("%s → 401 y nunca llega al inbox", async (_n, header) => {
    const raw = body();
    const res = await paddlePOST(req(raw, header(now(), raw)));
    expect(res.status).toBe(401);
    expect(h.processWebhookOnce).not.toHaveBeenCalled();
  });

  it("firma válida pero sin event_id u occurred_at: 400 sin aplicar nada", async () => {
    for (const raw of [body({ event_id: undefined }), body({ occurred_at: undefined })]) {
      const ts = now();
      const res = await paddlePOST(req(raw, `ts=${ts};h1=${sign(ts, raw)}`));
      expect(res.status).toBe(400);
    }
    expect(h.processWebhookOnce).not.toHaveBeenCalled();
    expect(h.getConnection).not.toHaveBeenCalled();
  });

  it("subscription.created atrasado: sólo vincula la suscripción al tenant", async () => {
    h.processWebhookOnce.mockImplementation((_e: unknown, _h: unknown, o: { onStale: () => Promise<Response> }) => o.onStale());
    h.poolQuery.mockResolvedValue([[{ tenant_id: "t1" }]]);
    const raw = body({ event_type: "subscription.created" });
    const ts = now();
    const res = await paddlePOST(req(raw, `ts=${ts};h1=${sign(ts, raw)}`));
    expect(res.status).toBe(200);
    expect(h.poolExecute).toHaveBeenCalledWith("UPDATE Tenants SET paddle_subscription_id = ? WHERE tenant_id = ?", [SUB, "t1"]);
    expect(h.getConnection).not.toHaveBeenCalled();
  });
});

describe("PERIM-08 — Azure Marketplace", () => {
  const SUB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const OP_ID = "99999999-8888-7777-6666-555555555555";
  const post = (b: unknown) =>
    azurePOST(new NextRequest("https://app/api/webhooks/marketplace/azure", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer x" },
      body: typeof b === "string" ? b : JSON.stringify(b),
    }));
  const notice = (o: Record<string, unknown> = {}) => ({ id: OP_ID, subscriptionId: SUB_ID, action: "Suspended", timeStamp: "2030-01-01T00:00:00Z", ...o });
  const op = (o: Record<string, unknown> = {}) => ({ id: OP_ID, subscriptionId: SUB_ID, action: "Suspended", timeStamp: "2026-01-01T10:00:00Z", status: "Succeeded", ...o });

  beforeEach(() => {
    h.connQuery.mockImplementation(async (sql: string) =>
      sql.startsWith("SELECT tenant_id") ? [[{ tenant_id: "t1" }]] : sql.startsWith("SELECT tier") ? [[{ tier: "Professional" }]] : [[]]);
  });

  it.each([
    ["sin id de operación", notice({ id: undefined })],
    ["id que no es GUID", notice({ id: "1 OR 1=1" })],
    ["suscripción que no es GUID", notice({ subscriptionId: "sub-1" })],
    ["acción que no es string", notice({ action: 1 })],
  ])("%s → 400 sin consultar Fulfillment", async (_n, b) => {
    expect((await post(b)).status).toBe(400);
    expect(h.getOperation).not.toHaveBeenCalled();
  });

  it("body de más de 16 KB → 413", async () => {
    expect((await post(notice({ pad: "x".repeat(17 * 1024) }))).status).toBe(413);
    expect(h.getOperation).not.toHaveBeenCalled();
  });

  it("acción desconocida: 200 sin efectos", async () => {
    const res = await post(notice({ action: "SomethingNew" }));
    expect(res.status).toBe(200);
    expect(h.getOperation).not.toHaveBeenCalled();
    expect(h.processWebhookOnce).not.toHaveBeenCalled();
  });

  it("operación que Fulfillment no conoce: 400 y nada se aplica", async () => {
    h.getOperation.mockRejectedValue(new MarketplaceOperationNotFound());
    expect((await post(notice())).status).toBe(400);
    expect(h.processWebhookOnce).not.toHaveBeenCalled();
  });

  it("Fulfillment caído: 503 con Retry-After para que Microsoft reintente", async () => {
    h.getOperation.mockRejectedValue(new Error("getOperation failed: 500"));
    const res = await post(notice());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(h.processWebhookOnce).not.toHaveBeenCalled();
  });

  it.each([
    ["otra acción", { action: "Reinstated" }],
    ["otra suscripción", { subscriptionId: "00000000-0000-0000-0000-000000000000" }],
    ["otra operación", { id: "00000000-0000-0000-0000-000000000000" }],
  ])("aviso que no coincide con la operación (%s) → 400", async (_n, o) => {
    h.getOperation.mockResolvedValue(op(o));
    expect((await post(notice())).status).toBe(400);
    expect(h.processWebhookOnce).not.toHaveBeenCalled();
  });

  it("orden por la fecha de la operación, no por el timeStamp del body", async () => {
    h.getOperation.mockResolvedValue(op());
    expect((await post(notice())).status).toBe(200);
    expect(h.getOperation).toHaveBeenCalledWith(SUB_ID, OP_ID);
    const ev = h.processWebhookOnce.mock.calls[0][0];
    expect(ev).toMatchObject({ provider: "azure", eventId: OP_ID, cursorKey: `sub:${SUB_ID}:status`, enforceOrder: true });
    expect(ev.occurredAt.toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });

  it("Unsubscribed se aplica siempre (enforceOrder=false) en el ámbito de estado", async () => {
    h.getOperation.mockResolvedValue(op({ action: "Unsubscribed" }));
    h.getSubscription.mockResolvedValue({ term: {} });
    await post(notice({ action: "Unsubscribed" }));
    expect(h.processWebhookOnce.mock.calls[0][0]).toMatchObject({ cursorKey: `sub:${SUB_ID}:status`, enforceOrder: false });
  });

  it("ChangePlan: ámbito propio, plan de la operación y sin tocar el estado", async () => {
    h.getOperation.mockResolvedValue(op({ action: "ChangePlan", planId: "plan-real" }));
    const res = await post(notice({ action: "ChangePlan", planId: "plan-del-body" }));
    expect(res.status).toBe(200);
    expect(h.processWebhookOnce.mock.calls[0][0]).toMatchObject({ cursorKey: `sub:${SUB_ID}:plan`, enforceOrder: true });
    const sqls = h.connQuery.mock.calls.map((c) => [c[0], c[1]]);
    expect(sqls).toContainEqual([expect.stringContaining("marketplace_plan_id = ?"), [expect.anything(), "plan-real", "t1"]]);
    expect(sqls.some(([s]) => String(s).includes("marketplace_status"))).toBe(false);
    expect(h.recordTenantLifecycleTransition).not.toHaveBeenCalled();
  });

  it("operación fallida en Marketplace: 200 sin efectos", async () => {
    h.getOperation.mockResolvedValue(op({ status: "Failed" }));
    expect((await post(notice())).status).toBe(200);
    expect(h.getConnection).not.toHaveBeenCalled();
  });

  it("Suspended aplicado: suspende vía ciclo de vida", async () => {
    h.getOperation.mockResolvedValue(op());
    await post(notice());
    expect(h.recordTenantLifecycleTransition).toHaveBeenCalledWith("t1", "SUSPENDED", expect.anything());
  });

  it("el inbox decide: un duplicado no ejecuta el handler", async () => {
    h.getOperation.mockResolvedValue(op());
    h.processWebhookOnce.mockResolvedValue(NextResponse.json({ received: true, duplicate: true }));
    const res = await post(notice());
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(h.getConnection).not.toHaveBeenCalled();
  });
});

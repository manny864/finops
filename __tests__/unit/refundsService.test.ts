// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { consultar } = vi.hoisted(() => ({ consultar: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: consultar } }));

import { aplicarReembolsoAprobado, liberarReembolsoRechazado, listarCobros, solicitarReembolso, VENTANA_REEMBOLSO_DIAS } from "@/services/refunds.service";

const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const TXN = "txn_01m4rzzzzzzzzzzzzzzzzzzzzz";
const SUB_PLAN = "sub_01m4plan000000000000000000";
const SUB_MOD = "sub_01m4modulo0000000000000000";
const fetchMock = vi.fn();

const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);
const sqls = () => consultar.mock.calls.map(([sql]) => String(sql));
const hizo = (fragmento: string) => sqls().some((s) => s.includes(fragmento));

/** Responde por trozos de SQL; lo que no está listado contesta vacío. */
function base(r: Record<string, unknown>) {
  consultar.mockImplementation(async (sql: string) => {
    for (const [fragmento, valor] of Object.entries(r)) if (String(sql).includes(fragmento)) return [valor];
    return [[]];
  });
}

const paddle = (status: number, cuerpo: unknown) => ({ ok: status < 400, status, json: async () => cuerpo });

beforeEach(() => {
  consultar.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_de_prueba";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.PADDLE_API_KEY;
});

describe("solicitarReembolso", () => {
  const pedido = { tenantId: TENANT, transactionId: TXN, reason: "El cliente pidió la baja", email: "owner@cliente.com", esSuperAdmin: false };
  const cobro = (extra: Record<string, unknown> = {}) => ({ id: 7, status: "completed", billed_at: hace(2), ...extra });

  it("pide a Paddle el reembolso TOTAL de la transacción, con el motivo y quién lo pidió, y reserva el cobro", async () => {
    base({ "FROM BillingTransactions WHERE tenant_id": [cobro()], "SET status = 'refund_pending'": { affectedRows: 1 } });
    fetchMock.mockResolvedValue(paddle(201, { data: { id: "adj_01", status: "pending_approval" } }));

    const r = await solicitarReembolso(pedido);

    expect(r).toEqual({ adjustmentId: "adj_01", status: "pending_approval" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox-api.paddle.com/adjustments");
    expect(init.headers.Authorization).toBe("Bearer pdl_sdbx_apikey_de_prueba");
    expect(JSON.parse(init.body)).toEqual({ action: "refund", type: "full", transaction_id: TXN, reason: "[owner@cliente.com] El cliente pidió la baja" });
    expect(hizo("SET status = 'refund_pending'")).toBe(true);
    expect(consultar).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO SecurityAuditTrail"), expect.arrayContaining([TENANT, "REFUND_REQUESTED", "owner@cliente.com"]));
  });

  it("busca el cobro DENTRO del tenant: pedir el reembolso de un cobro ajeno da 404 y no llega a Paddle", async () => {
    base({});
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 404 });
    expect(consultar).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = ? AND paddle_transaction_id = ?"), [TENANT, TXN]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["refunded", 409, /ya fue reembolsado/],
    ["refund_pending", 409, /en proceso/],
    ["payment_failed", 409, /completados/],
  ])("un cobro %s no se reembolsa", async (status, http, mensaje) => {
    base({ "FROM BillingTransactions WHERE tenant_id": [cobro({ status })] });
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: http, message: expect.stringMatching(mensaje) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it(`un Admin/Owner no reembolsa pasados ${VENTANA_REEMBOLSO_DIAS} días del cobro; el SuperAdmin sí`, async () => {
    base({ "FROM BillingTransactions WHERE tenant_id": [cobro({ billed_at: hace(VENTANA_REEMBOLSO_DIAS + 1) })], "SET status = 'refund_pending'": { affectedRows: 1 } });
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(paddle(201, { data: { id: "adj_02", status: "approved" } }));
    await expect(solicitarReembolso({ ...pedido, esSuperAdmin: true })).resolves.toMatchObject({ adjustmentId: "adj_02" });
  });

  it("dos pedidos a la vez: el que pierde la reserva atómica no manda nada a Paddle", async () => {
    base({ "FROM BillingTransactions WHERE tenant_id": [cobro()], "SET status = 'refund_pending'": { affectedRows: 0 } });
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si Paddle rechaza, el cobro se libera y el error lleva el motivo de Paddle", async () => {
    base({ "FROM BillingTransactions WHERE tenant_id": [cobro()], "SET status = 'refund_pending'": { affectedRows: 1 } });
    fetchMock.mockResolvedValue(paddle(400, { error: { code: "transaction_not_completed", detail: "Transaction must be completed" } }));
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Transaction must be completed") });
    expect(hizo("SET status = 'completed' WHERE id = ? AND status = 'refund_pending'")).toBe(true);
  });

  it("si Paddle no responde, el cobro se libera", async () => {
    base({ "FROM BillingTransactions WHERE tenant_id": [cobro()], "SET status = 'refund_pending'": { affectedRows: 1 } });
    fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 502 });
    expect(hizo("SET status = 'completed' WHERE id = ? AND status = 'refund_pending'")).toBe(true);
  });

  it.each([["", /motivo/], ["abc", /motivo/], ["x".repeat(501), /500/]])("el motivo %j no vale", async (reason, mensaje) => {
    await expect(solicitarReembolso({ ...pedido, reason })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(mensaje) });
    expect(consultar).not.toHaveBeenCalled();
  });

  it("sin PADDLE_API_KEY falla antes de tocar el cobro", async () => {
    delete process.env.PADDLE_API_KEY;
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 500 });
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe("aplicarReembolsoAprobado", () => {
  it("un cobro que no está en BillingTransactions no hace nada", async () => {
    base({});
    await expect(aplicarReembolsoAprobado(TXN)).resolves.toEqual({ aplicado: false, addonRevocado: false, accesoCortado: false });
    expect(hizo("UPDATE")).toBe(false);
  });

  it("un módulo de PASE: marca el cobro y da de baja la fila; no cancela nada en Paddle ni toca el acceso", async () => {
    base({
      "FROM BillingTransactions WHERE paddle_transaction_id": [{ tenant_id: TENANT, paddle_subscription_id: null }],
      "FROM TenantAddons": [{ id: 1, addon_key: "mod_security", addon_type: "pass" }],
    });
    await expect(aplicarReembolsoAprobado(TXN)).resolves.toEqual({ aplicado: true, addonRevocado: true, accesoCortado: false });
    expect(hizo("SET status = 'refunded'")).toBe(true);
    expect(consultar).toHaveBeenCalledWith(expect.stringMatching(/^UPDATE TenantAddons SET status = 'cancelled' WHERE tenant_id = \? AND paddle_transaction_id = \? AND status = 'active'$/), [TENANT, TXN]);
    expect(hizo("access_until")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un módulo RECURRENTE: cancela su suscripción en Paddle (si no, el mes siguiente se vuelve a cobrar y acreditar) y da de baja la fila", async () => {
    base({
      "FROM BillingTransactions WHERE paddle_transaction_id": [{ tenant_id: TENANT, paddle_subscription_id: SUB_MOD }],
      "FROM TenantAddons": [{ id: 1, addon_key: "mod_security", addon_type: "recurring" }],
    });
    fetchMock.mockResolvedValue(paddle(200, { data: {} }));
    const r = await aplicarReembolsoAprobado(TXN);
    expect(r.addonRevocado).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://sandbox-api.paddle.com/subscriptions/${SUB_MOD}/cancel`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ effective_from: "immediately" });
    expect(hizo("UPDATE TenantAddons SET status = 'cancelled'")).toBe(true);
  });

  it("si Paddle no puede cancelar el módulo (5xx), lanza para que el webhook se reintente y la fila NO se da de baja todavía", async () => {
    base({
      "FROM BillingTransactions WHERE paddle_transaction_id": [{ tenant_id: TENANT, paddle_subscription_id: SUB_MOD }],
      "FROM TenantAddons": [{ id: 1, addon_key: "mod_security", addon_type: "recurring" }],
    });
    fetchMock.mockResolvedValue(paddle(503, {}));
    await expect(aplicarReembolsoAprobado(TXN)).rejects.toThrow(/503/);
    expect(hizo("UPDATE TenantAddons SET status = 'cancelled'")).toBe(false);
  });

  describe("el plan del tenant", () => {
    const esElPlan = { "FROM BillingTransactions WHERE paddle_transaction_id": [{ tenant_id: TENANT, paddle_subscription_id: SUB_PLAN }], "FROM Tenants WHERE tenant_id": [{ "1": 1 }] };

    it("si es el ÚLTIMO cobro del plan, corta el acceso ahora y cancela la suscripción en Paddle", async () => {
      base({ ...esElPlan, "ORDER BY billed_at DESC": [{ paddle_transaction_id: TXN }] });
      fetchMock.mockResolvedValue(paddle(200, { data: {} }));
      await expect(aplicarReembolsoAprobado(TXN)).resolves.toEqual({ aplicado: true, addonRevocado: false, accesoCortado: true });
      expect(hizo("UPDATE Tenants SET access_until = NOW()")).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(`https://sandbox-api.paddle.com/subscriptions/${SUB_PLAN}/cancel`);
    });

    it("el acceso se corta ANTES de cancelar: si Paddle falla, el cliente reembolsado no queda con servicio", async () => {
      base({ ...esElPlan, "ORDER BY billed_at DESC": [{ paddle_transaction_id: TXN }] });
      fetchMock.mockResolvedValue(paddle(500, {}));
      await expect(aplicarReembolsoAprobado(TXN)).rejects.toThrow(/500/);
      expect(hizo("UPDATE Tenants SET access_until = NOW()")).toBe(true);
    });

    it("un cobro ANTERIOR del plan no corta nada: ya se usó y el período vigente sigue pago", async () => {
      base({ ...esElPlan, "ORDER BY billed_at DESC": [{ paddle_transaction_id: "txn_mas_nuevo" }] });
      await expect(aplicarReembolsoAprobado(TXN)).resolves.toMatchObject({ aplicado: true, accesoCortado: false });
      expect(hizo("access_until")).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("una suscripción que no es la del tenant (otra cuenta) no corta nada", async () => {
      base({ "FROM BillingTransactions WHERE paddle_transaction_id": [{ tenant_id: TENANT, paddle_subscription_id: "sub_ajena" }] });
      await expect(aplicarReembolsoAprobado(TXN)).resolves.toMatchObject({ accesoCortado: false });
      expect(hizo("access_until")).toBe(false);
    });

    it("si Paddle contesta 4xx al cancelar (ya estaba cancelada), el acceso queda cortado y el webhook no se reintenta", async () => {
      base({ ...esElPlan, "ORDER BY billed_at DESC": [{ paddle_transaction_id: TXN }] });
      fetchMock.mockResolvedValue(paddle(409, { error: { code: "subscription_locked", detail: "already canceled" } }));
      await expect(aplicarReembolsoAprobado(TXN)).resolves.toMatchObject({ accesoCortado: true });
    });

    it("es idempotente: aplicarlo dos veces da el mismo resultado", async () => {
      base({ ...esElPlan, "ORDER BY billed_at DESC": [{ paddle_transaction_id: TXN }] });
      fetchMock.mockResolvedValue(paddle(200, { data: {} }));
      const a = await aplicarReembolsoAprobado(TXN);
      const b = await aplicarReembolsoAprobado(TXN);
      expect(b).toEqual(a);
    });
  });
});

describe("liberarReembolsoRechazado", () => {
  it("vuelve a `completed` sólo un cobro que estaba `refund_pending`", async () => {
    base({});
    await liberarReembolsoRechazado(TXN);
    expect(consultar).toHaveBeenCalledWith(expect.stringContaining("SET status = 'completed' WHERE paddle_transaction_id = ? AND status = 'refund_pending'"), [TXN]);
  });
});

describe("listarCobros", () => {
  const fila = (extra: Record<string, unknown>) => ({ transactionId: TXN, subscriptionId: SUB_PLAN, amount: "299.99", currency: "USD", status: "completed", billedAt: hace(1), addonKey: null, ...extra });

  it("marca por qué un cobro no se puede reembolsar", async () => {
    base({ "FROM BillingTransactions bt": [fila({}), fila({ status: "refunded" }), fila({ status: "refund_pending" }), fila({ billedAt: hace(40) })] });
    const c = await listarCobros(TENANT, false);
    expect(c.map((x) => [x.reembolsable, x.motivo])).toEqual([[true, undefined], [false, "ya-reembolsado"], [false, "en-proceso"], [false, "fuera-de-ventana"]]);
  });

  it("el SuperAdmin no tiene ventana", async () => {
    base({ "FROM BillingTransactions bt": [fila({ billedAt: hace(400) })] });
    expect((await listarCobros(TENANT, true))[0].reembolsable).toBe(true);
  });

  it("sólo trae cobros del tenant pedido, completados, en proceso o reembolsados", async () => {
    base({});
    await listarCobros(TENANT, false);
    expect(consultar).toHaveBeenCalledWith(expect.stringMatching(/bt\.tenant_id = \?.*status IN \('completed', 'refund_pending', 'refunded'\)/s), [TENANT]);
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { consultar } = vi.hoisted(() => ({ consultar: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: consultar } }));

import { aplicarReembolsoAprobado, calcularProrrateo, datosDelCobro, liberarReembolsoRechazado, listarCobros, solicitarReembolso, VENTANA_REEMBOLSO_DIAS } from "@/services/refunds.service";

const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const TXN = "txn_01m4rzzzzzzzzzzzzzzzzzzzzz";
const SUB_PLAN = "sub_01m4plan000000000000000000";
const SUB_MOD = "sub_01m4modulo0000000000000000";
const fetchMock = vi.fn();

/** Se usan medias jornadas (2,5; 9,5...) para no caer justo en el límite de un día, donde el redondeo hacia arriba depende de un milisegundo. */
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

/** `transaction.completed` guardado: período de 30 días (el de un plan mensual) y una línea de 299,99 con impuestos. */
const raw = (over: Record<string, unknown> = {}, lineas = [{ id: "txnitm_01m4linea0000000000000000a", totals: { total: "29999" } }]) => ({
  event_type: "transaction.completed",
  data: { billing_period: { starts_at: hace(2.5).toISOString(), ends_at: new Date(hace(2.5).getTime() + 30 * 86_400_000).toISOString() }, details: { line_items: lineas }, ...over },
});

describe("el valor por defecto de la ventana", () => {
  it("son 7 días", () => expect(VENTANA_REEMBOLSO_DIAS).toBe(7));
});

describe("calcularProrrateo (pura)", () => {
  const inicio = new Date("2026-10-01T00:00:00Z");
  const periodo = { inicio, fin: new Date("2026-10-31T00:00:00Z") }; // 30 días
  const lineas = [{ id: "txnitm_a", totalMinor: 30000 }];
  const t0 = inicio.getTime();
  const calc = (diasDespues: number, extra: Record<string, unknown> = {}) =>
    calcularProrrateo({ billedAt: inicio, periodo, lineas, ahora: t0 + diasDespues * 86_400_000, ...extra });

  it("se devuelve lo no usado: 3 de 30 días usados = 27/30 del total", () => {
    expect(calc(3)).toMatchObject({ ok: true, diasPeriodo: 30, diasUsados: 3, items: [{ item_id: "txnitm_a", amount: "27000" }], montoMinor: 27000 });
  });

  it("cualquier fracción de día cuenta como día usado: a las 3 horas ya es 1 día", () => {
    expect(calcularProrrateo({ billedAt: inicio, periodo, lineas, ahora: t0 + 3 * 3_600_000 })).toMatchObject({ ok: true, diasUsados: 1, montoMinor: 29000 });
  });

  it("un día cumplido exacto cuenta como 1, uno y un minuto como 2", () => {
    expect(calc(1)).toMatchObject({ diasUsados: 1 });
    expect(calcularProrrateo({ billedAt: inicio, periodo, lineas, ahora: t0 + 86_400_000 + 60_000 })).toMatchObject({ diasUsados: 2 });
  });

  it("pedido en el mismo instante del pago: 0 días usados, se devuelve todo", () => {
    expect(calc(0)).toMatchObject({ ok: true, diasUsados: 0, montoMinor: 30000 });
  });

  it("nunca devuelve más de lo cobrado ni redondea hacia arriba: floor por línea", () => {
    const r = calcularProrrateo({ billedAt: inicio, periodo, lineas: [{ id: "txnitm_a", totalMinor: 1000 }], ahora: t0 + 7 * 86_400_000 });
    expect(r).toMatchObject({ ok: true, montoMinor: 766 }); // 1000 * 23 / 30 = 766,66
    if (r.ok) expect(r.montoMinor).toBeLessThanOrEqual(1000);
  });

  it("varias líneas se prorratean cada una", () => {
    const r = calcularProrrateo({ billedAt: inicio, periodo, lineas: [{ id: "txnitm_a", totalMinor: 30000 }, { id: "txnitm_b", totalMinor: 3000 }], ahora: t0 + 3 * 86_400_000 });
    expect(r).toMatchObject({ ok: true, items: [{ item_id: "txnitm_a", amount: "27000" }, { item_id: "txnitm_b", amount: "2700" }], montoMinor: 29700 });
  });

  it("el período ya usado por completo no devuelve nada", () => {
    expect(calc(30)).toEqual({ ok: false, motivo: "periodo-agotado" });
    expect(calc(45)).toEqual({ ok: false, motivo: "periodo-agotado" });
  });

  it("sin período o sin líneas no se calcula: no se inventa", () => {
    expect(calc(3, { periodo: null })).toEqual({ ok: false, motivo: "sin-periodo" });
    expect(calc(3, { lineas: [] })).toEqual({ ok: false, motivo: "sin-periodo" });
    expect(calc(3, { periodo: { inicio, fin: inicio } })).toEqual({ ok: false, motivo: "sin-periodo" });
  });

  it("un reloj adelantado (pedido antes del pago) no da más de lo cobrado", () => {
    expect(calc(-2)).toMatchObject({ ok: true, diasUsados: 0, montoMinor: 30000 });
  });

  it("un año: 100 de 365 días usados", () => {
    const anual = { inicio, fin: new Date(t0 + 365 * 86_400_000) };
    expect(calcularProrrateo({ billedAt: inicio, periodo: anual, lineas: [{ id: "txnitm_a", totalMinor: 365000 }], ahora: t0 + 100 * 86_400_000 })).toMatchObject({ diasPeriodo: 365, diasUsados: 100, montoMinor: 265000 });
  });
});

describe("datosDelCobro", () => {
  it("lee el período y las líneas del transaction.completed guardado, como objeto o como texto", () => {
    const evento = raw();
    for (const guardado of [evento, JSON.stringify(evento)]) {
      const d = datosDelCobro(guardado);
      expect(d.lineas).toEqual([{ id: "txnitm_01m4linea0000000000000000a", totalMinor: 29999 }]);
      expect(d.periodo).not.toBeNull();
    }
  });

  it("un cobro único (billing_period null) usa la vigencia del pase que acreditó", () => {
    const d = datosDelCobro(raw({ billing_period: null }), { startsAt: "2026-10-01T00:00:00Z", expiresAt: "2026-12-30T00:00:00Z" });
    expect(d.periodo?.fin.toISOString()).toBe("2026-12-30T00:00:00.000Z");
  });

  it("sin billing_period ni pase: período null", () => {
    expect(datosDelCobro(raw({ billing_period: null })).periodo).toBeNull();
  });

  it("un evento ilegible no lanza", () => {
    expect(datosDelCobro("{no es json")).toEqual({ lineas: [], periodo: null });
    expect(datosDelCobro(null)).toEqual({ lineas: [], periodo: null });
  });

  it("descarta líneas sin id de línea de Paddle o con total inválido", () => {
    const d = datosDelCobro(raw({}, [{ id: "otra_cosa", totals: { total: "100" } }, { id: "txnitm_ok", totals: { total: "abc" } }, { id: "txnitm_ok2", totals: { total: "500" } }]));
    expect(d.lineas).toEqual([{ id: "txnitm_ok2", totalMinor: 500 }]);
  });
});

describe("solicitarReembolso", () => {
  const pedido = { tenantId: TENANT, transactionId: TXN, reason: "El cliente pidió la baja", email: "owner@cliente.com", esSuperAdmin: false };
  const cobro = (extra: Record<string, unknown> = {}) => ({ id: 7, status: "completed", billed_at: hace(2.5), currency: "USD", raw_event: raw(), ...extra });
  const FRAGMENTO_COBRO = "WHERE bt.tenant_id = ? AND bt.paddle_transaction_id = ?";

  it("por defecto es PROPORCIONAL: pide un reembolso parcial por línea con lo no usado, e informa el monto", async () => {
    base({ [FRAGMENTO_COBRO]: [cobro()], "SET status = 'refund_pending'": { affectedRows: 1 } });
    fetchMock.mockResolvedValue(paddle(201, { data: { id: "adj_01", status: "pending_approval" } }));

    const r = await solicitarReembolso(pedido);

    // billing_period de 30 días y cobrado hace 2 días (se redondea a 3 usados): 29999 * 27 / 30 = 26999,1 -> 26999
    expect(r).toEqual({ adjustmentId: "adj_01", status: "pending_approval", modo: "proporcional", monto: "269.99" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox-api.paddle.com/adjustments");
    expect(init.headers.Authorization).toBe("Bearer pdl_sdbx_apikey_de_prueba");
    expect(JSON.parse(init.body)).toEqual({
      action: "refund",
      transaction_id: TXN,
      reason: "[owner@cliente.com] El cliente pidió la baja",
      type: "partial",
      items: [{ item_id: "txnitm_01m4linea0000000000000000a", type: "partial", amount: "26999" }],
    });
    expect(hizo("SET status = 'refund_pending'")).toBe(true);
    expect(consultar).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO AuditTrailLogs"),
      expect.arrayContaining([TENANT, "owner@cliente.com", "REFUND_REQUESTED", expect.stringContaining("reembolso proporcional de 269.99")])
    );
  });

  it("el SuperAdmin puede pedir el TOTAL: type full, sin ítems", async () => {
    base({ [FRAGMENTO_COBRO]: [cobro()], "SET status = 'refund_pending'": { affectedRows: 1 } });
    fetchMock.mockResolvedValue(paddle(201, { data: { id: "adj_02", status: "approved" } }));
    const r = await solicitarReembolso({ ...pedido, esSuperAdmin: true, modo: "total" });
    expect(r).toMatchObject({ modo: "total" });
    const cuerpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(cuerpo).toMatchObject({ action: "refund", type: "full", transaction_id: TXN });
    expect(cuerpo.items).toBeUndefined();
  });

  it("un Admin/Owner NO puede pedir el total: 403 y no toca nada", async () => {
    await expect(solicitarReembolso({ ...pedido, modo: "total" })).rejects.toMatchObject({ status: 403 });
    expect(consultar).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un modo desconocido es 400", async () => {
    await expect(solicitarReembolso({ ...pedido, modo: "mitad" as any })).rejects.toMatchObject({ status: 400 });
  });

  it("si el período ya se usó por completo, 409 y no llega a Paddle ni reserva el cobro", async () => {
    base({ [FRAGMENTO_COBRO]: [cobro({ billed_at: hace(5.5), raw_event: raw({ billing_period: { starts_at: hace(5.5).toISOString(), ends_at: new Date(hace(5.5).getTime() + 3 * 86_400_000).toISOString() } }) })] });
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ya se usó/) });
    expect(hizo("refund_pending")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si no se puede calcular el período, 409 con la salida (soporte) en vez de inventar un monto", async () => {
    base({ [FRAGMENTO_COBRO]: [cobro({ raw_event: raw({ billing_period: null }) })] });
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/soporte/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a un SuperAdmin sin período calculable le queda el total", async () => {
    base({ [FRAGMENTO_COBRO]: [cobro({ raw_event: raw({ billing_period: null }) })], "SET status = 'refund_pending'": { affectedRows: 1 } });
    fetchMock.mockResolvedValue(paddle(201, { data: { id: "adj_03", status: "pending_approval" } }));
    await expect(solicitarReembolso({ ...pedido, esSuperAdmin: true, modo: "total" })).resolves.toMatchObject({ modo: "total" });
  });

  it("un pase temporal se prorratea por la vigencia del pase (3 meses = 90 días)", async () => {
    base({
      [FRAGMENTO_COBRO]: [cobro({ billed_at: hace(9.5), raw_event: raw({ billing_period: null }), addon_starts_at: hace(9.5), addon_expires_at: new Date(hace(9.5).getTime() + 90 * 86_400_000) })],
      "SET status = 'refund_pending'": { affectedRows: 1 },
    });
    fetchMock.mockResolvedValue(paddle(201, { data: { id: "adj_04", status: "pending_approval" } }));
    // 9,5 días -> 10 usados de 90: 29999 * 80 / 90 = 26665,77 -> 26665 (SuperAdmin: sin ventana de 7 días)
    await solicitarReembolso({ ...pedido, esSuperAdmin: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).items[0].amount).toBe("26665");
  });

  it("busca el cobro DENTRO del tenant: pedir el reembolso de un cobro ajeno da 404 y no llega a Paddle", async () => {
    base({});
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 404 });
    expect(consultar).toHaveBeenCalledWith(expect.stringContaining(FRAGMENTO_COBRO), [TENANT, TXN]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["refunded", 409, /ya fue reembolsado/],
    ["refund_pending", 409, /en proceso/],
    ["payment_failed", 409, /completados/],
  ])("un cobro %s no se reembolsa", async (status, http, mensaje) => {
    base({ [FRAGMENTO_COBRO]: [cobro({ status })] });
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: http, message: expect.stringMatching(mensaje) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it(`un Admin/Owner no reembolsa pasados ${VENTANA_REEMBOLSO_DIAS} días del cobro; el SuperAdmin sí`, async () => {
    base({
      [FRAGMENTO_COBRO]: [cobro({ billed_at: hace(VENTANA_REEMBOLSO_DIAS + 0.5), raw_event: raw({ billing_period: { starts_at: hace(VENTANA_REEMBOLSO_DIAS + 0.5).toISOString(), ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString() } }) })],
      "SET status = 'refund_pending'": { affectedRows: 1 },
    });
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("7 días") });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(paddle(201, { data: { id: "adj_02", status: "approved" } }));
    await expect(solicitarReembolso({ ...pedido, esSuperAdmin: true })).resolves.toMatchObject({ adjustmentId: "adj_02" });
  });

  it("dos pedidos a la vez: el que pierde la reserva atómica no manda nada a Paddle", async () => {
    base({ [FRAGMENTO_COBRO]: [cobro()], "SET status = 'refund_pending'": { affectedRows: 0 } });
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si Paddle rechaza, el cobro se libera y el error lleva el motivo de Paddle", async () => {
    base({ [FRAGMENTO_COBRO]: [cobro()], "SET status = 'refund_pending'": { affectedRows: 1 } });
    fetchMock.mockResolvedValue(paddle(400, { error: { code: "transaction_not_completed", detail: "Transaction must be completed" } }));
    await expect(solicitarReembolso(pedido)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Transaction must be completed") });
    expect(hizo("SET status = 'completed' WHERE id = ? AND status = 'refund_pending'")).toBe(true);
  });

  it("si Paddle no responde, el cobro se libera", async () => {
    base({ [FRAGMENTO_COBRO]: [cobro()], "SET status = 'refund_pending'": { affectedRows: 1 } });
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

describe("aplicarReembolsoAprobado de un reembolso PARCIAL (soloSiPedido)", () => {
  const cobroConEstado = (status: string) => ({
    "FROM BillingTransactions WHERE paddle_transaction_id": [{ tenant_id: TENANT, paddle_subscription_id: SUB_PLAN, status }],
    "FROM Tenants WHERE tenant_id": [{ "1": 1 }],
    "ORDER BY billed_at DESC": [{ paddle_transaction_id: TXN }],
  });

  it("uno hecho a mano en el panel de Paddle (el cobro sigue `completed`) no termina el servicio", async () => {
    base(cobroConEstado("completed"));
    await expect(aplicarReembolsoAprobado(TXN, { soloSiPedido: true })).resolves.toEqual({ aplicado: false, addonRevocado: false, accesoCortado: false });
    expect(hizo("UPDATE")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el que pedimos nosotros (`refund_pending`) sí: corta el acceso y cancela la suscripción", async () => {
    base(cobroConEstado("refund_pending"));
    fetchMock.mockResolvedValue(paddle(200, { data: {} }));
    await expect(aplicarReembolsoAprobado(TXN, { soloSiPedido: true })).resolves.toMatchObject({ aplicado: true, accesoCortado: true });
    expect(hizo("SET status = 'refunded'")).toBe(true);
  });

  it("el reintento de un webhook que ya marcó el cobro (`refunded`) vuelve a aplicar lo que faltó", async () => {
    base(cobroConEstado("refunded"));
    fetchMock.mockResolvedValue(paddle(200, { data: {} }));
    await expect(aplicarReembolsoAprobado(TXN, { soloSiPedido: true })).resolves.toMatchObject({ accesoCortado: true });
  });

  it("sin la opción (reembolso total) se aplica siempre, esté el cobro en el estado que esté", async () => {
    base(cobroConEstado("completed"));
    fetchMock.mockResolvedValue(paddle(200, { data: {} }));
    await expect(aplicarReembolsoAprobado(TXN)).resolves.toMatchObject({ aplicado: true });
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
  const periodo30 = (billed: Date) => ({ billing_period: { starts_at: billed.toISOString(), ends_at: new Date(billed.getTime() + 30 * 86_400_000).toISOString() } });
  const fila = (extra: Record<string, unknown>) => {
    const billedAt = (extra.billedAt as Date) ?? hace(1.5);
    return { transactionId: TXN, subscriptionId: SUB_PLAN, amount: "299.99", currency: "USD", status: "completed", billedAt, addonKey: null, rawEvent: raw(periodo30(billedAt)), ...extra };
  };
  const FRAG = "FROM BillingTransactions bt";

  it("marca por qué un cobro no se puede reembolsar", async () => {
    base({ [FRAG]: [fila({}), fila({ status: "refunded" }), fila({ status: "refund_pending" }), fila({ billedAt: hace(40.5) })] });
    const c = await listarCobros(TENANT, false);
    expect(c.map((x) => [x.reembolsable, x.motivo])).toEqual([[true, undefined], [false, "ya-reembolsado"], [false, "en-proceso"], [false, "fuera-de-ventana"]]);
  });

  it("informa lo que se devolvería hoy y los días usados", async () => {
    base({ [FRAG]: [fila({})] });
    const [c] = await listarCobros(TENANT, false);
    // cobrado hace 1,5 días -> 2 usados de 30 -> 29999 * 28 / 30 = 27999,07 -> 27999
    expect(c.prorrateo).toEqual({ diasPeriodo: 30, diasUsados: 2, monto: "279.99" });
  });

  it("un Admin/Owner no puede reembolsar un cobro cuyo período no se puede calcular; el SuperAdmin sí (total)", async () => {
    base({ [FRAG]: [fila({ rawEvent: raw({ billing_period: null }) })] });
    const [admin] = await listarCobros(TENANT, false);
    expect([admin.reembolsable, admin.motivo, admin.motivoProrrateo]).toEqual([false, "sin-periodo", "sin-periodo"]);
    const [superadmin] = await listarCobros(TENANT, true);
    expect([superadmin.reembolsable, superadmin.prorrateo, superadmin.motivoProrrateo]).toEqual([true, undefined, "sin-periodo"]);
  });

  it("un período ya usado por completo tampoco se ofrece al Admin/Owner", async () => {
    const billedAt = hace(5.5);
    base({ [FRAG]: [fila({ billedAt, rawEvent: raw({ billing_period: { starts_at: billedAt.toISOString(), ends_at: new Date(billedAt.getTime() + 3 * 86_400_000).toISOString() } }) })] });
    expect((await listarCobros(TENANT, false))[0]).toMatchObject({ reembolsable: false, motivo: "periodo-agotado" });
  });

  it("el SuperAdmin no tiene ventana", async () => {
    base({ [FRAG]: [fila({ billedAt: hace(400.5) })] });
    expect((await listarCobros(TENANT, true))[0].reembolsable).toBe(true);
  });

  it("sólo trae cobros del tenant pedido, completados, en proceso o reembolsados", async () => {
    base({});
    await listarCobros(TENANT, false);
    expect(consultar).toHaveBeenCalledWith(expect.stringMatching(/bt\.tenant_id = \?.*status IN \('completed', 'refund_pending', 'refunded'\)/s), [TENANT]);
  });
});

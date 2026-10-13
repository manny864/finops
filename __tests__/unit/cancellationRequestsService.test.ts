// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ consultar: vi.fn(), correo: vi.fn(), transicion: vi.fn(), cancelarPaddle: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: m.consultar } }));
vi.mock("@/lib/emailHelper", async (orig) => ({ ...(await orig<typeof import("@/lib/emailHelper")>()), sendEmailAsync: m.correo }));
vi.mock("@/services/tenantLifecycle.service", () => ({ recordTenantLifecycleTransition: m.transicion }));
vi.mock("@/lib/paddleSubscriptions", () => ({ cancelarSuscripcion: m.cancelarPaddle }));

import { crearSolicitud, listarSolicitudes, recordarSolicitudesPendientes, resolverSolicitud, tieneSolicitudPendiente, DIAS_ENTRE_RECORDATORIOS } from "@/services/cancellationRequests.service";

const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const SUB = "sub_01m4plan000000000000000000";
const ADMIN = "soporte@cscloudsolutions.com";
const sqls = () => m.consultar.mock.calls.map(([sql]) => String(sql));
const hizo = (f: string) => sqls().some((s) => s.includes(f));

/** Responde por trozos de SQL; lo que no está listado contesta vacío. */
function base(r: Record<string, unknown>) {
  m.consultar.mockImplementation(async (sql: string) => {
    for (const [fragmento, valor] of Object.entries(r)) if (String(sql).includes(fragmento)) return [valor];
    return [[]];
  });
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.correo.mockResolvedValue(undefined);
  m.transicion.mockResolvedValue(true);
  m.cancelarPaddle.mockResolvedValue({ ok: true, status: 200 });
  process.env.INTERNAL_CANCELLATION_ALERT_EMAIL = "soporte@cscloudsolutions.com.ar";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.INTERNAL_CANCELLATION_ALERT_EMAIL;
  vi.restoreAllMocks();
});

describe("crearSolicitud", () => {
  const pedido = { tenantId: TENANT, requestedBy: "owner@cliente.com", reasonCode: "no-paddle-subscription" as const, detail: null };

  it("crea la solicitud PENDING, deja auditoría y AVISA AL SUPERADMIN por mail con el motivo", async () => {
    base({ "INSERT INTO CancellationRequests": { affectedRows: 1, insertId: 12 }, "FROM Tenants WHERE tenant_id": [{ company_name: "ACME <b>SA</b>", tier: "Business" }] });
    await expect(crearSolicitud(pedido)).resolves.toEqual({ id: 12, creada: true });

    expect(m.consultar).toHaveBeenCalledWith(expect.stringContaining("WHERE NOT EXISTS"), [TENANT, "owner@cliente.com", "no-paddle-subscription", null, TENANT]);
    expect(m.consultar).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO SecurityAuditTrail"), expect.arrayContaining([TENANT, "CANCELLATION_REQUEST_CREATED", "owner@cliente.com"]));
    const [asunto, html, para] = m.correo.mock.calls[0];
    expect(para).toBe("soporte@cscloudsolutions.com.ar");
    expect(asunto).toContain("pendiente de aprobación");
    expect(html).toContain("no tiene suscripción de Paddle");
    expect(html).toContain("owner@cliente.com");
    // El nombre de la empresa viene del cliente: va escapado.
    expect(html).not.toContain("<b>SA</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("si ya había una abierta no crea otra ni vuelve a avisar: devuelve la existente", async () => {
    base({ "INSERT INTO CancellationRequests": { affectedRows: 0 }, "SELECT id FROM CancellationRequests WHERE tenant_id": [{ id: 7 }] });
    await expect(crearSolicitud(pedido)).resolves.toEqual({ id: 7, creada: false });
    expect(m.correo).not.toHaveBeenCalled();
    expect(hizo("SecurityAuditTrail")).toBe(false);
  });

  it("el detalle se corta a 1000 caracteres", async () => {
    base({ "INSERT INTO CancellationRequests": { affectedRows: 1, insertId: 1 } });
    await crearSolicitud({ ...pedido, reasonCode: "paddle-rejected", detail: "x".repeat(2000) });
    const params = m.consultar.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO CancellationRequests"))![1];
    expect(params[3]).toHaveLength(1000);
  });

  it("si el mail falla, la solicitud igual queda creada", async () => {
    base({ "INSERT INTO CancellationRequests": { affectedRows: 1, insertId: 3 } });
    m.correo.mockRejectedValue(new Error("Graph caído"));
    await expect(crearSolicitud(pedido)).resolves.toEqual({ id: 3, creada: true });
  });
});

describe("resolverSolicitud: rechazar", () => {
  const solicitud = (extra: Record<string, unknown> = {}) => ({ id: 5, tenant_id: TENANT, requested_by: "owner@cliente.com", status: "PENDING", company_name: "ACME", paddle_subscription_id: null, access_until: null, ...extra });

  it("exige un motivo (se le informa al cliente) y no toca nada sin él", async () => {
    await expect(resolverSolicitud({ id: 5, decision: "reject", actor: ADMIN, nota: "no" })).rejects.toMatchObject({ status: 400 });
    expect(m.consultar).not.toHaveBeenCalled();
  });

  it("con motivo: marca REJECTED, no ejecuta ninguna baja y le avisa al cliente con el motivo", async () => {
    base({ "WHERE r.id = ?": [solicitud()], "SET status = ?, resolved_by": { affectedRows: 1 } });
    await expect(resolverSolicitud({ id: 5, decision: "reject", actor: ADMIN, nota: "Lo hablamos y sigue con nosotros" })).resolves.toEqual({ id: 5, estado: "REJECTED" });
    expect(m.cancelarPaddle).not.toHaveBeenCalled();
    expect(m.transicion).not.toHaveBeenCalled();
    expect(hizo("UPDATE Tenants")).toBe(false);
    const [asunto, html, para] = m.correo.mock.calls[0];
    expect(para).toBe("owner@cliente.com");
    expect(asunto).toContain("no fue aprobada");
    expect(html).toContain("Lo hablamos y sigue con nosotros");
    expect(m.consultar).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO SecurityAuditTrail"), expect.arrayContaining(["CANCELLATION_REQUEST_REJECTED", ADMIN]));
  });
});

describe("resolverSolicitud: aprobar", () => {
  const solicitud = (extra: Record<string, unknown> = {}) => ({ id: 5, tenant_id: TENANT, requested_by: "owner@cliente.com", status: "PENDING", company_name: "ACME", paddle_subscription_id: null, access_until: null, ...extra });
  const hoyMas = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
  const preparar = (fila: Record<string, unknown>) => base({ "WHERE r.id = ?": [fila], "SET status = ?, resolved_by": { affectedRows: 1 } });

  it("un tenant SIN Paddle: registra la baja (CANCELED corta las cuotas del comercial), fija hasta cuándo conserva el acceso y avisa al cliente", async () => {
    preparar(solicitud());
    const fecha = hoyMas(20);
    await expect(resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN, fechaEfectiva: fecha, nota: "Confirmado por teléfono" })).resolves.toEqual({ id: 5, estado: "APPROVED" });

    expect(m.cancelarPaddle).not.toHaveBeenCalled();
    expect(m.consultar).toHaveBeenCalledWith(expect.stringContaining("UPDATE Tenants SET cancel_at_period_end = TRUE, access_until = ?"), [`${fecha} 23:59:59`, TENANT]);
    expect(m.transicion).toHaveBeenCalledWith(TENANT, "CANCELED", { actor: ADMIN, reason: "voluntary_churn", metadata: { cancellationRequestId: 5 } });
    const [asunto, html, para] = m.correo.mock.calls[0];
    expect(para).toBe("owner@cliente.com");
    expect(asunto).toContain("aprobada");
    expect(html).toContain(fecha);
  });

  it("un tenant sin Paddle que YA tiene fecha de acceso la conserva si no se indica otra", async () => {
    preparar(solicitud({ access_until: new Date(Date.now() + 10 * 86_400_000) }));
    await resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN });
    expect(m.consultar).toHaveBeenCalledWith("UPDATE Tenants SET cancel_at_period_end = TRUE WHERE tenant_id = ?", [TENANT]);
    expect(m.transicion).toHaveBeenCalled();
  });

  it("sin Paddle y sin fecha de acceso la fecha es obligatoria: sin ella la baja lo dejaría sin servicio al instante", async () => {
    preparar(solicitud());
    await expect(resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("fechaEfectiva") });
    expect(hizo("SET status = ?, resolved_by")).toBe(false);
    expect(m.transicion).not.toHaveBeenCalled();
  });

  it("con suscripción de Paddle: la cancela al final del período EN PADDLE y no registra la baja (la registra el webhook cuando Paddle la emita)", async () => {
    preparar(solicitud({ paddle_subscription_id: SUB }));
    await expect(resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN })).resolves.toMatchObject({ estado: "APPROVED" });
    expect(m.cancelarPaddle).toHaveBeenCalledWith(SUB, "next_billing_period");
    expect(m.transicion).not.toHaveBeenCalled();
    expect(m.consultar).toHaveBeenCalledWith("UPDATE Tenants SET cancel_at_period_end = TRUE WHERE tenant_id = ?", [TENANT]);
  });

  it("con Paddle, la fecha que se mande se ignora: manda Paddle", async () => {
    preparar(solicitud({ paddle_subscription_id: SUB }));
    await resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN, fechaEfectiva: hoyMas(5) });
    expect(hizo("access_until = ?")).toBe(false);
  });

  it("si Paddle rechaza la baja, la solicitud VUELVE a pendiente y el error llega al SuperAdmin", async () => {
    preparar(solicitud({ paddle_subscription_id: SUB }));
    m.cancelarPaddle.mockResolvedValue({ ok: false, status: 400, detail: "scheduled change" });
    await expect(resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("scheduled change") });
    expect(hizo("SET status = 'PENDING'")).toBe(true);
    expect(hizo("UPDATE Tenants")).toBe(false);
    expect(m.correo).not.toHaveBeenCalled();
  });

  it("si algo falla después de tomar la solicitud, también vuelve a pendiente", async () => {
    preparar(solicitud());
    m.transicion.mockRejectedValue(new Error("deadlock"));
    await expect(resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN, fechaEfectiva: hoyMas(3) })).rejects.toThrow("deadlock");
    expect(hizo("SET status = 'PENDING'")).toBe(true);
    expect(m.correo).not.toHaveBeenCalled();
  });

  it("omitirPaddle: el SuperAdmin ya la canceló a mano en Paddle, no se le pide de nuevo", async () => {
    preparar(solicitud({ paddle_subscription_id: SUB }));
    await resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN, omitirPaddle: true });
    expect(m.cancelarPaddle).not.toHaveBeenCalled();
  });
});

describe("resolverSolicitud: guardas", () => {
  it("una solicitud inexistente es 404", async () => {
    base({});
    await expect(resolverSolicitud({ id: 99, decision: "approve", actor: ADMIN })).rejects.toMatchObject({ status: 404 });
  });

  it("una ya resuelta es 409 y no se ejecuta de nuevo", async () => {
    base({ "WHERE r.id = ?": [{ id: 5, tenant_id: TENANT, status: "APPROVED", requested_by: "a@b.c", paddle_subscription_id: SUB }] });
    await expect(resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("ya fue resuelta (APPROVED)") });
    expect(hizo("SET status = ?, resolved_by")).toBe(false);
    expect(m.cancelarPaddle).not.toHaveBeenCalled();
  });

  it("dos SuperAdmin a la vez: el que pierde la toma atómica no ejecuta nada", async () => {
    base({ "WHERE r.id = ?": [{ id: 5, tenant_id: TENANT, status: "PENDING", requested_by: "a@b.c", paddle_subscription_id: SUB }], "SET status = ?, resolved_by": { affectedRows: 0 } });
    await expect(resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN })).rejects.toMatchObject({ status: 409 });
    expect(m.cancelarPaddle).not.toHaveBeenCalled();
    expect(m.transicion).not.toHaveBeenCalled();
  });

  it.each([["decision inválida", { decision: "quizas" as any }], ["fecha mal formada", { decision: "approve" as const, fechaEfectiva: "mañana" }], ["fecha en el pasado", { decision: "approve" as const, fechaEfectiva: "2020-01-01" }], ["nota larguísima", { decision: "approve" as const, nota: "x".repeat(1001) }]])("%s es 400 y no consulta nada", async (_n, extra) => {
    await expect(resolverSolicitud({ id: 5, actor: ADMIN, ...extra })).rejects.toMatchObject({ status: 400 });
    expect(m.consultar).not.toHaveBeenCalled();
  });

  it("si el solicitante no tiene un email válido no se intenta avisarle", async () => {
    base({ "WHERE r.id = ?": [{ id: 5, tenant_id: TENANT, status: "PENDING", requested_by: "desconocido", paddle_subscription_id: SUB }], "SET status = ?, resolved_by": { affectedRows: 1 } });
    await resolverSolicitud({ id: 5, decision: "approve", actor: ADMIN });
    expect(m.correo).not.toHaveBeenCalled();
  });
});

describe("listarSolicitudes y tieneSolicitudPendiente", () => {
  it("trae las pendientes primero, con las cuotas de comisión que la baja cancelaría", async () => {
    base({ "FROM CancellationRequests r": [{ id: 1, tenant_id: TENANT, requested_by: "a@b.c", reason_code: "azure-marketplace", detail: null, status: "PENDING", created_at: new Date("2026-10-01"), company_name: "ACME", tier: "Business", subscription_status: "ACTIVE", access_until: null, paddle_subscription_id: null, cuotas_pendientes: 2, monto_pendiente: "58.0000" }] });
    const [s] = await listarSolicitudes("PENDING");
    expect(s).toMatchObject({ id: 1, tienePaddle: false, cuotasPendientes: 2, montoPendiente: "58.0000", reasonCode: "azure-marketplace" });
    expect(sqls()[0]).toMatch(/ORDER BY \(r\.status = 'PENDING'\) DESC/);
    expect(sqls()[0]).toContain("c.beneficiary_type = 'sales_rep' AND c.status = 'PENDING'");
  });

  it("tieneSolicitudPendiente mira sólo las PENDING del tenant", async () => {
    base({ "SELECT id FROM CancellationRequests": [{ id: 4 }] });
    await expect(tieneSolicitudPendiente(TENANT)).resolves.toBe(true);
    expect(m.consultar).toHaveBeenCalledWith(expect.stringContaining("status = 'PENDING'"), [TENANT]);
    base({});
    await expect(tieneSolicitudPendiente(TENANT)).resolves.toBe(false);
  });
});

describe("recordarSolicitudesPendientes", () => {
  const vieja = (dias: number) => ({ id: 3, tenant_id: TENANT, requested_by: "a@b.c", reason_code: "no-paddle-subscription", detail: null, created_at: new Date(Date.now() - dias * 86_400_000), company_name: "ACME", tier: "Business" });

  it(`recuerda las pendientes con más de ${DIAS_ENTRE_RECORDATORIOS} días sin recordatorio, indica cuánto llevan y marca el recordatorio`, async () => {
    base({ "FROM CancellationRequests r": [vieja(4.5)] });
    await expect(recordarSolicitudesPendientes()).resolves.toEqual({ recordadas: 1 });
    const [asunto, html, para] = m.correo.mock.calls[0];
    expect(para).toBe("soporte@cscloudsolutions.com.ar");
    expect(asunto).toContain("Recordatorio");
    expect(html).toContain("4 días");
    expect(m.consultar).toHaveBeenCalledWith(expect.stringContaining("SET last_reminded_at = NOW()"), [3]);
    expect(sqls()[0]).toContain(`INTERVAL ${DIAS_ENTRE_RECORDATORIOS} DAY`);
    expect(sqls()[0]).toContain("COALESCE(r.last_reminded_at, r.created_at)");
  });

  it("sin pendientes viejas no manda nada", async () => {
    base({});
    await expect(recordarSolicitudesPendientes()).resolves.toEqual({ recordadas: 0 });
    expect(m.correo).not.toHaveBeenCalled();
  });

  it("recordar nunca resuelve ni aprueba nada", async () => {
    base({ "FROM CancellationRequests r": [vieja(30)] });
    await recordarSolicitudesPendientes();
    expect(hizo("SET status")).toBe(false);
    expect(m.transicion).not.toHaveBeenCalled();
    expect(m.cancelarPaddle).not.toHaveBeenCalled();
  });
});

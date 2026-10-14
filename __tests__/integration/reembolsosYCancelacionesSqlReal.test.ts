// @vitest-environment node
//
// Reembolsos, comisiones y solicitudes de cancelación CONTRA MySQL DE VERDAD.
//
// Los tests unitarios de estos flujos mockean `pool.query` y aceptan cualquier SQL: no prueban que MySQL lo ejecute, que las columnas
// existan, que el JSON se lea como objeto, que `INSERT ... WHERE NOT EXISTS` aguante pedidos simultáneos ni que la FK en cascada
// funcione. Este archivo corre los servicios REALES contra la base migrada; sólo se simulan Paddle (`fetch`) y el mail.
// Fue lo que mostró que `SecurityAuditTrail` no existe en ninguna migración y que las auditorías no dejaban rastro.
//
// SE SALTEA salvo que se pase `DB_PORT` (CI no tiene MySQL). Contra un contenedor efímero ya migrado:
//
//   DB_HOST=127.0.0.1 DB_PORT=3317 DB_USER=finops_user DB_PASSWORD=finopspassword DB_NAME=finops_app \
//     npx vitest run __tests__/integration/reembolsosYCancelacionesSqlReal.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const correo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/emailHelper", async (orig) => ({ ...(await orig<typeof import("@/lib/emailHelper")>()), sendEmailAsync: correo }));

import pool from "@/modules/storage/db";
import { aplicarReembolsoAprobado, liberarReembolsoRechazado, listarCobros, solicitarReembolso } from "@/services/refunds.service";
import { ajustarComisionesPorReembolsoParcial } from "@/services/commissions.service";
import { crearCorrida, previsualizarCorrida } from "@/services/payoutRuns.service";
import { recordTenantLifecycleTransition } from "@/services/tenantLifecycle.service";
import { TenantAddonsService } from "@/services/tenantAddons.service";
import { crearSolicitud, listarSolicitudes, recordarSolicitudesPendientes, resolverSolicitud, tieneSolicitudPendiente } from "@/services/cancellationRequests.service";
import { getTenantBillingDetails } from "@/services/saasBilling.service";

const T_PLAN = "tmp-val-plan";
const T_MANUAL = "tmp-val-manual";
const T_AZURE = "tmp-val-azure";
const T_FK = "tmp-val-fk";
const T_HIST = "tmp-val-historial";
const TODOS = [T_PLAN, T_MANUAL, T_AZURE, T_FK, T_HIST];
const SUB_PLAN = "sub_01valplan000000000000000a";
const SUB_MOD = "sub_01valmodulo0000000000000b";
const ADMIN = "soporte@cscloudsolutions.com";
const fetchMock = vi.fn();

const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);
const en = (dias: number) => new Date(Date.now() + dias * 86_400_000);
const ok = () => ({ ok: true, status: 200, json: async () => ({}) });
const q = async (sql: string, params: unknown[] = []) => ((await pool.query(sql, params)) as any)[0] as any[];

async function cobro(tenant: string, txn: string, sub: string | null, billedAt: Date, total = "29999", status = "completed") {
  const raw = {
    event_type: "transaction.completed",
    data: { billing_period: { starts_at: billedAt.toISOString(), ends_at: new Date(billedAt.getTime() + 30 * 86_400_000).toISOString() }, details: { line_items: [{ id: `txnitm_${txn.slice(4, 30)}`, totals: { total } }] } },
  };
  await pool.query(
    `INSERT INTO BillingTransactions (tenant_id, paddle_transaction_id, paddle_subscription_id, amount, currency, status, billed_at, raw_event) VALUES (?, ?, ?, 299.99, 'USD', ?, ?, ?)`,
    [tenant, txn, sub, status, billedAt, JSON.stringify(raw)]
  );
}

async function comision(o: { tipo: "affiliate" | "sales_rep"; id: string; tenant: string; txn: string; base: string; pct: string; monto: string; estado: string; cuota?: number | null }) {
  await pool.query(
    `INSERT INTO Commissions (beneficiary_type, beneficiary_id, tenant_id, paddle_transaction_id, base_amount, currency, commission_pct, commission_amount, installment_number, installment_total, status, billed_at, payment_due_date)
     VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, NOW(), CURDATE())`,
    [o.tipo, o.id, o.tenant, o.txn, o.base, o.pct, o.monto, o.cuota ?? null, o.cuota ? 12 : null, o.estado]
  );
}

const fila = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];
const estadoCobro = async (txn: string) => (await fila("SELECT status FROM BillingTransactions WHERE paddle_transaction_id = ?", [txn])).status as string;
const estadoComision = async (tipo: string, txn: string) => fila("SELECT status, base_amount, commission_amount, notes FROM Commissions WHERE beneficiary_type = ? AND paddle_transaction_id = ?", [tipo, txn]);
const auditoria = async (tenant: string, accion: string) => q("SELECT user_email, resource_target_name, metadata_json FROM AuditTrailLogs WHERE tenant_id = ? AND action_type = ?", [tenant, accion]);

describe.skipIf(!process.env.DB_PORT)("reembolsos, comisiones y cancelaciones contra MySQL real", () => {
  beforeAll(async () => {
    await limpiar();
    for (const t of TODOS) await pool.query("INSERT INTO Tenants (tenant_id, company_name, status) VALUES (?, ?, 'active')", [t, `Val ${t}`]);
    await pool.query("UPDATE Tenants SET paddle_subscription_id = ?, subscription_status = 'ACTIVE' WHERE tenant_id = ?", [SUB_PLAN, T_PLAN]);
    await pool.query("UPDATE Tenants SET marketplace_source = 'azure_marketplace' WHERE tenant_id = ?", [T_AZURE]);
    await pool.query("INSERT INTO Users (tenant_id, email, role) VALUES (?, 'admin@val.com', 'Admin')", [T_PLAN]).catch(() => {});
  }, 60000);

  beforeEach(() => {
    correo.mockReset().mockResolvedValue(undefined);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_de_prueba";
    process.env.INTERNAL_CANCELLATION_ALERT_EMAIL = "soporte@cscloudsolutions.com.ar";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  async function limpiar() {
    await pool.query("DELETE FROM Commissions WHERE tenant_id IN (?)", [TODOS]);
    await pool.query("DELETE FROM TenantAddons WHERE tenant_id IN (?)", [TODOS]);
    await pool.query("DELETE FROM AuditTrailLogs WHERE tenant_id IN (?)", [TODOS]);
    await pool.query("DELETE FROM TenantLifecycleEvents WHERE tenant_id IN (?)", [TODOS]);
    await pool.query("DELETE FROM Users WHERE tenant_id IN (?)", [TODOS]);
    await pool.query("DELETE FROM Tenants WHERE tenant_id IN (?)", [TODOS]);
  }

  afterAll(async () => {
    await limpiar();
    await pool.end().catch(() => {});
  }, 60000);

  // ──────────────────────────── REEMBOLSOS ────────────────────────────
  describe("reembolso proporcional", () => {
    const TXN1 = "txn_01valplan00000000000000a";

    beforeAll(async () => {
      await cobro(T_PLAN, TXN1, SUB_PLAN, hace(2.5));
    });

    it("listarCobros lee el JSON real de la base y calcula el prorrateo: 3 de 30 días usados → 269,99", async () => {
      const [c] = await listarCobros(T_PLAN, false);
      expect(c).toMatchObject({ transactionId: TXN1, status: "completed", reembolsable: true });
      expect(c.prorrateo).toEqual({ diasPeriodo: 30, diasUsados: 3, monto: "269.99" });
    });

    it("solicitarReembolso reserva el cobro en la base, manda a Paddle el parcial por línea y deja auditoría REAL en AuditTrailLogs", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ data: { id: "adj_01val", status: "pending_approval" } }) });
      const r = await solicitarReembolso({ tenantId: T_PLAN, transactionId: TXN1, reason: "Validación contra MySQL real", email: "admin@val.com", esSuperAdmin: false });

      expect(r).toMatchObject({ adjustmentId: "adj_01val", modo: "proporcional", monto: "269.99" });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ type: "partial", items: [{ type: "partial", amount: "26999" }] });
      expect(await estadoCobro(TXN1)).toBe("refund_pending");
      const [a] = await auditoria(T_PLAN, "REFUND_REQUESTED");
      expect(a.user_email).toBe("admin@val.com");
      expect(a.resource_target_name).toContain("reembolso proporcional de 269.99");
    });

    it("un segundo pedido sobre el mismo cobro es 409 y no llega a Paddle", async () => {
      await expect(solicitarReembolso({ tenantId: T_PLAN, transactionId: TXN1, reason: "otra vez, por favor", email: "admin@val.com", esSuperAdmin: false })).rejects.toMatchObject({ status: 409 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("dos pedidos SIMULTÁNEOS sobre un cobro: la reserva atómica deja pasar sólo uno", async () => {
      const TXN_R = "txn_01valcarrera000000000000a";
      await cobro(T_PLAN, TXN_R, null, hace(1.5));
      fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ data: { id: "adj_01carrera", status: "pending_approval" } }) });
      const pedir = () => solicitarReembolso({ tenantId: T_PLAN, transactionId: TXN_R, reason: "carrera de pedidos", email: "a@b.c", esSuperAdmin: true, modo: "total" });
      const resultados = await Promise.allSettled([pedir(), pedir(), pedir(), pedir()]);
      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await pool.query("UPDATE BillingTransactions SET status = 'refunded' WHERE paddle_transaction_id = ?", [TXN_R]);
    });

    it("con el reembolso PENDIENTE las comisiones del cobro NO entran en una corrida de pago; al rechazarse sí", async () => {
      await comision({ tipo: "affiliate", id: "aff-val-1", tenant: T_PLAN, txn: TXN1, base: "250", pct: "20", monto: "50", estado: "DUE" });
      const hay = async () => (await previsualizarCorrida({ currency: "USD", minimo: 0 })).some((l) => l.beneficiaryId === "aff-val-1");

      expect(await estadoCobro(TXN1)).toBe("refund_pending");
      expect(await hay()).toBe(false);

      await liberarReembolsoRechazado(TXN1);
      expect(await estadoCobro(TXN1)).toBe("completed");
      expect(await hay()).toBe(true);

      await pool.query("UPDATE BillingTransactions SET status = 'refund_pending' WHERE paddle_transaction_id = ?", [TXN1]);
      expect(await hay()).toBe(false);
    });

    it("crear la corrida de verdad (lectura FOR UPDATE + UPDATE que asigna) tampoco se lleva una comisión con reembolso pendiente", async () => {
      const asignada = async () => (await fila("SELECT payout_run_id FROM Commissions WHERE beneficiary_type = 'affiliate' AND paddle_transaction_id = ?", [TXN1])).payout_run_id;

      await pool.query("UPDATE BillingTransactions SET status = 'refund_pending' WHERE paddle_transaction_id = ?", [TXN1]);
      await crearCorrida({ currency: "USD", minimo: 0, adminEmail: ADMIN });
      expect(await asignada()).toBeNull();

      // Al rechazarse, la corrida siguiente sí la toma.
      await liberarReembolsoRechazado(TXN1);
      await crearCorrida({ currency: "USD", minimo: 0, adminEmail: ADMIN });
      expect(await asignada()).not.toBeNull();

      // Se deja como estaba para los casos siguientes.
      await pool.query("UPDATE Commissions SET payout_run_id = NULL WHERE paddle_transaction_id = ?", [TXN1]);
      await pool.query("DELETE FROM PayoutRuns WHERE created_by = ?", [ADMIN]);
      await pool.query("UPDATE BillingTransactions SET status = 'refund_pending' WHERE paddle_transaction_id = ?", [TXN1]);
    });

    it("un parcial aprobado reduce la comisión en proporción (afiliado y comercial), es idempotente por ajuste y acumula ajustes distintos", async () => {
      await comision({ tipo: "sales_rep", id: "rep-val-1", tenant: T_PLAN, txn: TXN1, base: "250", pct: "10", monto: "25", estado: "PENDING", cuota: 1 });

      const r1 = await ajustarComisionesPorReembolsoParcial({ transactionId: TXN1, adjustmentId: "adj_01valA", subtotalReembolsado: "27.00" });
      expect(r1).toEqual({ reducidas: 2, revertidas: 0, pagadasARevisar: 0 });
      expect(await estadoComision("affiliate", TXN1)).toMatchObject({ base_amount: "223.0000", commission_amount: "44.6000" });
      expect(await estadoComision("sales_rep", TXN1)).toMatchObject({ base_amount: "223.0000", commission_amount: "22.3000" });

      // El mismo ajuste otra vez (created + updated, reintento de Paddle): no cambia nada.
      await ajustarComisionesPorReembolsoParcial({ transactionId: TXN1, adjustmentId: "adj_01valA", subtotalReembolsado: "27.00" });
      expect(await estadoComision("affiliate", TXN1)).toMatchObject({ base_amount: "223.0000", commission_amount: "44.6000" });

      // Otro ajuste distinto sobre el mismo cobro se acumula.
      await ajustarComisionesPorReembolsoParcial({ transactionId: TXN1, adjustmentId: "adj_01valB", subtotalReembolsado: "10.00" });
      const afiliado = await estadoComision("affiliate", TXN1);
      expect(afiliado).toMatchObject({ base_amount: "213.0000", commission_amount: "42.6000" });
      expect(afiliado.notes).toContain("[adj_01valA]");
      expect(afiliado.notes).toContain("[adj_01valB]");
    });

    it("una comisión ya PAGADA no se toca: queda la nota; y una que se agota pasa a REVERSED", async () => {
      const TXN_P = "txn_01valpagada0000000000000a";
      await cobro(T_PLAN, TXN_P, null, hace(1.5));
      await comision({ tipo: "affiliate", id: "aff-val-2", tenant: T_PLAN, txn: TXN_P, base: "100", pct: "20", monto: "20", estado: "PAID" });
      expect(await ajustarComisionesPorReembolsoParcial({ transactionId: TXN_P, adjustmentId: "adj_01valC", subtotalReembolsado: "30.00" })).toEqual({ reducidas: 0, revertidas: 0, pagadasARevisar: 1 });
      expect(await estadoComision("affiliate", TXN_P)).toMatchObject({ status: "PAID", base_amount: "100.0000", commission_amount: "20.0000" });

      const TXN_Z = "txn_01valagotada0000000000000a";
      await cobro(T_PLAN, TXN_Z, null, hace(1.5));
      await comision({ tipo: "affiliate", id: "aff-val-3", tenant: T_PLAN, txn: TXN_Z, base: "100", pct: "20", monto: "20", estado: "PENDING" });
      await ajustarComisionesPorReembolsoParcial({ transactionId: TXN_Z, adjustmentId: "adj_01valD", subtotalReembolsado: "100.00" });
      expect((await estadoComision("affiliate", TXN_Z)).status).toBe("REVERSED");
    });

    it("aprobado el reembolso de un PLAN: cobro refunded, acceso cortado ahora y suscripción cancelada en Paddle; es idempotente", async () => {
      fetchMock.mockResolvedValue(ok());
      const r = await aplicarReembolsoAprobado(TXN1, { soloSiPedido: true });
      expect(r).toEqual({ aplicado: true, addonRevocado: false, accesoCortado: true });
      expect(await estadoCobro(TXN1)).toBe("refunded");
      const t = await fila("SELECT access_until <= NOW() AS cortado FROM Tenants WHERE tenant_id = ?", [T_PLAN]);
      expect(Number(t.cortado)).toBe(1);
      expect(fetchMock.mock.calls[0][0]).toContain(`/subscriptions/${SUB_PLAN}/cancel`);
      expect((await auditoria(T_PLAN, "REFUND_APPLIED")).length).toBeGreaterThan(0);

      fetchMock.mockClear();
      await expect(aplicarReembolsoAprobado(TXN1, { soloSiPedido: true })).resolves.toMatchObject({ aplicado: true, accesoCortado: true });
    });

    it("un parcial hecho a mano en el panel de Paddle (cobro `completed`) no termina el servicio", async () => {
      const TXN_M = "txn_01valmanual0000000000000a";
      await cobro(T_PLAN, TXN_M, SUB_PLAN, new Date());
      await expect(aplicarReembolsoAprobado(TXN_M, { soloSiPedido: true })).resolves.toEqual({ aplicado: false, addonRevocado: false, accesoCortado: false });
      expect(await estadoCobro(TXN_M)).toBe("completed");
    });

    it("un módulo de PASE y uno RECURRENTE: se dan de baja las filas reales y el recurrente cancela su suscripción en Paddle", async () => {
      const TXN_PASE = "txn_01valpase00000000000000a";
      const TXN_REC = "txn_01valrecurr0000000000000a";
      await cobro(T_PLAN, TXN_PASE, null, hace(1));
      await cobro(T_PLAN, TXN_REC, SUB_MOD, hace(1));
      await TenantAddonsService.purchaseAddon(T_PLAN, "mod_security", "pass", 3, TXN_PASE);
      await TenantAddonsService.purchaseAddon(T_PLAN, "mod_analytics", "recurring", 1, TXN_REC);
      fetchMock.mockResolvedValue(ok());

      expect(await aplicarReembolsoAprobado(TXN_PASE)).toMatchObject({ addonRevocado: true, accesoCortado: false });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await aplicarReembolsoAprobado(TXN_REC)).toMatchObject({ addonRevocado: true });
      expect(fetchMock.mock.calls[0][0]).toContain(`/subscriptions/${SUB_MOD}/cancel`);

      const filas = await q("SELECT addon_key, status FROM TenantAddons WHERE tenant_id = ? ORDER BY addon_key", [T_PLAN]);
      expect(filas).toEqual([{ addon_key: "mod_analytics", status: "cancelled" }, { addon_key: "mod_security", status: "cancelled" }]);
    });
  });

  // ─────────────── BAJA Y COMISIONES DEL COMERCIAL ───────────────
  describe("toda baja corta las cuotas no exigibles del comercial (transacción real)", () => {
    it("CANCELED cancela las PENDING del comercial y deja las exigibles, las pagadas y las del afiliado", async () => {
      await cobro(T_MANUAL, "txn_01valchurn1000000000000a", null, hace(40));
      await cobro(T_MANUAL, "txn_01valchurn2000000000000a", null, hace(10));
      await cobro(T_MANUAL, "txn_01valchurn3000000000000a", null, hace(5));
      await comision({ tipo: "sales_rep", id: "rep-val-2", tenant: T_MANUAL, txn: "txn_01valchurn1000000000000a", base: "100", pct: "20", monto: "20", estado: "PENDING", cuota: 1 });
      await comision({ tipo: "sales_rep", id: "rep-val-2", tenant: T_MANUAL, txn: "txn_01valchurn2000000000000a", base: "100", pct: "20", monto: "20", estado: "DUE", cuota: 2 });
      await comision({ tipo: "affiliate", id: "aff-val-9", tenant: T_MANUAL, txn: "txn_01valchurn3000000000000a", base: "100", pct: "20", monto: "20", estado: "PENDING" });

      expect(await recordTenantLifecycleTransition(T_MANUAL, "CANCELED", { actor: "test", reason: "voluntary_churn" })).toBe(true);

      expect((await estadoComision("sales_rep", "txn_01valchurn1000000000000a")).status).toBe("CANCELLED");
      expect((await estadoComision("sales_rep", "txn_01valchurn2000000000000a")).status).toBe("DUE");
      expect((await estadoComision("affiliate", "txn_01valchurn3000000000000a")).status).toBe("PENDING");
      expect((await fila("SELECT subscription_status FROM Tenants WHERE tenant_id = ?", [T_MANUAL])).subscription_status).toBe("CANCELED");

      // Reactivar para los escenarios de abajo.
      await pool.query("UPDATE Tenants SET subscription_status = 'ACTIVE', canceled_at = NULL WHERE tenant_id = ?", [T_MANUAL]);
    });
  });

  // ─────────────── SOLICITUDES DE CANCELACIÓN ───────────────
  describe("solicitudes de cancelación", () => {
    it("la migración creó la tabla con la FK en cascada: borrar el tenant se lleva sus solicitudes", async () => {
      await pool.query("INSERT INTO Tenants (tenant_id, company_name, status) VALUES (?, 'fk', 'active') ON DUPLICATE KEY UPDATE company_name = 'fk'", [T_FK]);
      await crearSolicitud({ tenantId: T_FK, requestedBy: "a@b.c", reasonCode: "no-paddle-subscription" });
      expect(await q("SELECT id FROM CancellationRequests WHERE tenant_id = ?", [T_FK])).toHaveLength(1);
      await pool.query("DELETE FROM Tenants WHERE tenant_id = ?", [T_FK]);
      expect(await q("SELECT id FROM CancellationRequests WHERE tenant_id = ?", [T_FK])).toHaveLength(0);
    });

    let idManual = 0;

    it("seis pedidos SIMULTÁNEOS del mismo tenant dejan UNA sola solicitud PENDING y un solo aviso", async () => {
      const pedir = () => crearSolicitud({ tenantId: T_MANUAL, requestedBy: "owner@val.com", reasonCode: "no-paddle-subscription" });
      const r = await Promise.all([pedir(), pedir(), pedir(), pedir(), pedir(), pedir()]);
      const filas = await q("SELECT id FROM CancellationRequests WHERE tenant_id = ? AND status = 'PENDING'", [T_MANUAL]);
      expect(filas).toHaveLength(1);
      expect(r.filter((x) => x.creada)).toHaveLength(1);
      expect(new Set(r.map((x) => x.id)).size).toBe(1);
      expect(correo).toHaveBeenCalledTimes(1);
      idManual = r[0].id;
      expect((await auditoria(T_MANUAL, "CANCELLATION_REQUEST_CREATED")).length).toBe(1);
    });

    it("el mail al SuperAdmin sale a la dirección configurada, con el motivo y el nombre escapado", async () => {
      // El del test anterior ya se mandó: se repite el pedido en otro tenant para mirar el contenido.
      await crearSolicitud({ tenantId: T_AZURE, requestedBy: "owner@azure.com", reasonCode: "azure-marketplace", detail: "x".repeat(1500) });
      const [asunto, html, para] = correo.mock.calls[0];
      expect(para).toBe("soporte@cscloudsolutions.com.ar");
      expect(asunto).toContain("pendiente de aprobación");
      expect(html).toContain("marketplace de Azure");
      const [fila1] = await q("SELECT detail FROM CancellationRequests WHERE tenant_id = ? AND status = 'PENDING'", [T_AZURE]);
      expect(fila1.detail).toHaveLength(1000);
    });

    it("listarSolicitudes (JOIN + subconsultas de comisiones + ORDER BY con booleano) corre en MySQL y cuenta las cuotas que la baja cancelaría", async () => {
      await comision({ tipo: "sales_rep", id: "rep-val-3", tenant: T_MANUAL, txn: "txn_01vallista000000000000a", base: "100", pct: "20", monto: "29", estado: "PENDING", cuota: 3 });
      const lista = await listarSolicitudes("PENDING");
      const s = lista.find((x) => x.tenantId === T_MANUAL)!;
      expect(s).toMatchObject({ id: idManual, status: "PENDING", reasonCode: "no-paddle-subscription", tienePaddle: false, cuotasPendientes: 1 });
      expect(Number(s.montoPendiente)).toBe(29);
      expect(s.companyName).toBe(`Val ${T_MANUAL}`);
      expect(await listarSolicitudes()).not.toHaveLength(0);
    });

    it("tieneSolicitudPendiente y el detalle de facturación del cliente la reflejan (cancellationPending)", async () => {
      expect(await tieneSolicitudPendiente(T_MANUAL)).toBe(true);
      expect((await getTenantBillingDetails(T_MANUAL)).cancellationPending).toBe(true);
      expect(await tieneSolicitudPendiente(T_PLAN)).toBe(false);
    });

    it("aprobar la de un tenant SIN Paddle, con dos SuperAdmin a la vez: se ejecuta UNA vez; fija el acceso, registra CANCELED y corta las cuotas", async () => {
      const fecha = en(20).toISOString().slice(0, 10);
      const aprobar = (actor: string) => resolverSolicitud({ id: idManual, decision: "approve", actor, fechaEfectiva: fecha, nota: "ok" });
      const r = await Promise.allSettled([aprobar("a@cscloudsolutions.com"), aprobar("b@cscloudsolutions.com")]);

      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

      const sol = await fila("SELECT status, resolved_by, DATE_FORMAT(effective_date, '%Y-%m-%d') AS fecha FROM CancellationRequests WHERE id = ?", [idManual]);
      expect(sol.status).toBe("APPROVED");
      expect(sol.fecha).toBe(fecha);
      const t = await fila("SELECT cancel_at_period_end, subscription_status, DATE_FORMAT(access_until, '%Y-%m-%d %H:%i:%s') AS hasta FROM Tenants WHERE tenant_id = ?", [T_MANUAL]);
      expect(t).toMatchObject({ cancel_at_period_end: 1, subscription_status: "CANCELED", hasta: `${fecha} 23:59:59` });
      expect((await q("SELECT id FROM TenantLifecycleEvents WHERE tenant_id = ? AND event_type = 'CANCELED'", [T_MANUAL])).length).toBeGreaterThan(0);
      expect((await estadoComision("sales_rep", "txn_01vallista000000000000a")).status).toBe("CANCELLED");
      expect((await auditoria(T_MANUAL, "CANCELLATION_REQUEST_APPROVED")).length).toBe(1);
      // El cliente (owner@val.com) recibió el aviso.
      expect(correo.mock.calls.some(([asunto, , para]) => para === "owner@val.com" && String(asunto).includes("aprobada"))).toBe(true);
    });

    it("resuelta la solicitud, el tenant puede volver a pedir otra (nueva fila) y rechazarla guarda motivo y quién", async () => {
      const nueva = await crearSolicitud({ tenantId: T_MANUAL, requestedBy: "owner@val.com", reasonCode: "no-paddle-subscription" });
      expect(nueva.creada).toBe(true);
      expect(nueva.id).not.toBe(idManual);
      await resolverSolicitud({ id: nueva.id, decision: "reject", actor: ADMIN, nota: "Lo hablamos y sigue" });
      const s = await fila("SELECT status, resolved_by, resolution_note, resolved_at IS NOT NULL AS resuelta FROM CancellationRequests WHERE id = ?", [nueva.id]);
      expect(s).toMatchObject({ status: "REJECTED", resolved_by: ADMIN, resolution_note: "Lo hablamos y sigue", resuelta: 1 });
      await expect(resolverSolicitud({ id: nueva.id, decision: "approve", actor: ADMIN, fechaEfectiva: en(5).toISOString().slice(0, 10) })).rejects.toMatchObject({ status: 409 });
    });

    it("un tenant CON Paddle: aprobar cancela en Paddle y no registra la baja; si Paddle rechaza, la solicitud vuelve a PENDING de verdad", async () => {
      const s = await crearSolicitud({ tenantId: T_PLAN, requestedBy: "admin@val.com", reasonCode: "paddle-rejected", detail: "Paddle: x" });

      fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: "x", detail: "scheduled change" } }) });
      await expect(resolverSolicitud({ id: s.id, decision: "approve", actor: ADMIN })).rejects.toMatchObject({ status: 502 });
      expect((await fila("SELECT status, resolved_by, resolved_at, resolution_note FROM CancellationRequests WHERE id = ?", [s.id]))).toMatchObject({ status: "PENDING", resolved_by: null, resolved_at: null, resolution_note: null });

      fetchMock.mockResolvedValue(ok());
      await resolverSolicitud({ id: s.id, decision: "approve", actor: ADMIN });
      expect(fetchMock.mock.calls.at(-1)![0]).toContain(`/subscriptions/${SUB_PLAN}/cancel`);
      expect((await fila("SELECT cancel_at_period_end FROM Tenants WHERE tenant_id = ?", [T_PLAN])).cancel_at_period_end).toBe(1);
    });

    it("recordatorios: sólo las pendientes con más de 3 días sin aviso, una vez cada 3 días", async () => {
      const [{ id }] = await q("SELECT id FROM CancellationRequests WHERE tenant_id = ? AND status = 'PENDING'", [T_AZURE]);
      correo.mockClear();

      expect((await recordarSolicitudesPendientes()).recordadas).toBe(0);

      await pool.query("UPDATE CancellationRequests SET created_at = NOW() - INTERVAL 4 DAY WHERE id = ?", [id]);
      expect((await recordarSolicitudesPendientes()).recordadas).toBe(1);
      expect(String(correo.mock.calls[0][0])).toContain("Recordatorio");
      expect(String(correo.mock.calls[0][1])).toContain("4 días");
      expect((await fila("SELECT last_reminded_at IS NOT NULL AS marcada FROM CancellationRequests WHERE id = ?", [id])).marcada).toBe(1);

      expect((await recordarSolicitudesPendientes()).recordadas).toBe(0);
      await pool.query("UPDATE CancellationRequests SET last_reminded_at = NOW() - INTERVAL 4 DAY WHERE id = ?", [id]);
      expect((await recordarSolicitudesPendientes()).recordadas).toBe(1);
      // Recordar no resuelve nada.
      expect((await fila("SELECT status FROM CancellationRequests WHERE id = ?", [id])).status).toBe("PENDING");
    });
  });

  // ─────────────────────── HISTORIAL DE COBROS DEL PANEL ───────────────────────

  describe("historial de cobros (getTenantBillingDetails)", () => {
    it("sale de BillingTransactions: completed, refund_pending y refunded en su moneda, el más nuevo primero, sin fallidos", async () => {
      await cobro(T_HIST, "txn_01hist_viejo", null, hace(40), "29999");
      await cobro(T_HIST, "txn_01hist_nuevo", null, hace(5), "29999");
      await cobro(T_HIST, "txn_01hist_reemb", null, hace(20), "29999", "refunded");
      await cobro(T_HIST, "txn_01hist_pend", null, hace(15), "29999", "refund_pending");
      await pool.query(
        "INSERT INTO BillingTransactions (tenant_id, paddle_transaction_id, amount, currency, status, billed_at, raw_event) VALUES (?, 'txn_01hist_eur', 100.50, 'EUR', 'completed', ?, ?)",
        [T_HIST, hace(10), JSON.stringify({ data: { details: { totals: { subtotal: "10050", tax: "2111", total: "12161" } } } })]
      );
      await pool.query("INSERT INTO BillingTransactions (tenant_id, paddle_transaction_id, status) VALUES (?, 'txn_01hist_falla', 'payment_failed')", [T_HIST]);

      const { invoices } = await getTenantBillingDetails(T_HIST);

      expect(invoices.map((i) => [i.paddleTransactionId, i.status, i.currency, i.amount])).toEqual([
        ["txn_01hist_nuevo", "PAID", "USD", 299.99],
        ["txn_01hist_eur", "PAID", "EUR", 121.61], // total con impuestos, del evento guardado
        ["txn_01hist_pend", "REFUND_PENDING", "USD", 299.99],
        ["txn_01hist_reemb", "REFUNDED", "USD", 299.99],
        ["txn_01hist_viejo", "PAID", "USD", 299.99],
      ]);
      expect(invoices[1]).toMatchObject({ subtotal: 100.5, tax: 21.11 });
      expect(invoices[0].subtotal).toBeUndefined(); // sin totales en el evento guardado no se inventa un impuesto
      expect(invoices.every((i) => /^\d{6,}$/.test(i.invoiceNumber))).toBe(true); // el número es sólo numérico
      expect(invoices[0].downloadPdfUrl).toBeUndefined();
      expect(new Date(invoices[0].billingDateIso).getTime()).toBeGreaterThan(hace(6).getTime());
    });

    it("un tenant sin cobros devuelve la lista vacía", async () => {
      expect((await getTenantBillingDetails(T_FK)).invoices).toEqual([]);
    });
  });
});

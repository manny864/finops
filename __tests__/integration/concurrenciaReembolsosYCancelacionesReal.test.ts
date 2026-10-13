// @vitest-environment node
//
// Concurrencia de los pedidos de reembolso y de cancelación CONTRA MySQL DE VERDAD.
//
// `INSERT ... WHERE NOT EXISTS` toma bloqueos de hueco: con pedidos simultáneos del mismo tenant MySQL aborta alguno con "Deadlock found
// when trying to get lock". Medido en MySQL 8.0 antes de reintentar: 86 deadlocks en 750 pedidos (30 simultáneos x 25 tenants). El
// error le llegaba al cliente en vez de su solicitud. Un mock no puede mostrar eso.
//
// SE SALTEA salvo que se pase `DB_PORT`:
//
//   DB_HOST=127.0.0.1 DB_PORT=3317 DB_USER=finops_user DB_PASSWORD=finopspassword DB_NAME=finops_app \
//     npx vitest run __tests__/integration/concurrenciaReembolsosYCancelacionesReal.test.ts
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/emailHelper", async (orig) => ({ ...(await orig<typeof import("@/lib/emailHelper")>()), sendEmailAsync: vi.fn() }));

import pool from "@/modules/storage/db";
import { crearSolicitud, resolverSolicitud } from "@/services/cancellationRequests.service";
import { solicitarReembolso } from "@/services/refunds.service";

const PREFIJO = "tmp-conc-";
const RONDAS = 25;
const fetchMock = vi.fn();
const manana = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

const tenant = async (n: number) => {
  const t = `${PREFIJO}${n}`;
  await pool.query("INSERT INTO Tenants (tenant_id, company_name, status) VALUES (?, 'conc', 'active') ON DUPLICATE KEY UPDATE company_name = 'conc'", [t]);
  return t;
};
const limpiar = async () => {
  await pool.query("DELETE FROM AuditTrailLogs WHERE tenant_id LIKE ?", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM TenantLifecycleEvents WHERE tenant_id LIKE ?", [`${PREFIJO}%`]);
  await pool.query("DELETE FROM Tenants WHERE tenant_id LIKE ?", [`${PREFIJO}%`]);
};
/** Lo que NO puede pasar: un error de base (deadlock) en vez de un resultado de negocio. */
const erroresDeBase = (r: PromiseSettledResult<unknown>[]) =>
  r.filter((x): x is PromiseRejectedResult => x.status === "rejected" && !(x.reason as any)?.status).map((x) => String(x.reason?.message));

describe.skipIf(!process.env.DB_PORT)("concurrencia contra MySQL real", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 201, json: async () => ({ data: { id: "adj_01conc", status: "pending_approval" } }) });
    vi.stubGlobal("fetch", fetchMock);
    process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_de_prueba";
  });
  afterAll(async () => {
    await limpiar();
    await pool.end().catch(() => {});
  }, 60000);

  it(`crearSolicitud: 30 pedidos simultáneos x ${RONDAS} tenants dejan UNA solicitud cada uno y ningún error de base`, async () => {
    await limpiar();
    let errores: string[] = [];
    let malas = 0;
    for (let n = 0; n < RONDAS; n++) {
      const t = await tenant(n);
      const r = await Promise.allSettled(Array.from({ length: 30 }, () => crearSolicitud({ tenantId: t, requestedBy: "a@b.c", reasonCode: "no-paddle-subscription" })));
      errores = errores.concat(erroresDeBase(r));
      const ok = r.filter((x): x is PromiseFulfilledResult<{ id: number; creada: boolean }> => x.status === "fulfilled").map((x) => x.value);
      const [{ n: abiertas }] = ((await pool.query("SELECT COUNT(*) AS n FROM CancellationRequests WHERE tenant_id = ? AND status = 'PENDING'", [t])) as any)[0];
      if (Number(abiertas) !== 1 || ok.filter((x) => x.creada).length !== 1 || new Set(ok.map((x) => x.id)).size !== 1) malas++;
    }
    expect({ errores: [...new Set(errores)], rondasMalas: malas }).toEqual({ errores: [], rondasMalas: 0 });
  }, 180000);

  it(`resolverSolicitud: 4 SuperAdmin aprobando a la vez x ${RONDAS} solicitudes: se ejecuta UNA vez, los demás reciben 409 y ninguno un error de base`, async () => {
    await limpiar();
    let errores: string[] = [];
    let malas = 0;
    for (let n = 0; n < RONDAS; n++) {
      const t = await tenant(n);
      const { id } = await crearSolicitud({ tenantId: t, requestedBy: "owner@val.com", reasonCode: "no-paddle-subscription" });
      const r = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => resolverSolicitud({ id, decision: "approve", actor: `sa${i}@cscloudsolutions.com`, fechaEfectiva: manana })));
      errores = errores.concat(erroresDeBase(r));
      const exitos = r.filter((x) => x.status === "fulfilled").length;
      const conflictos = r.filter((x) => x.status === "rejected" && (x.reason as any)?.status === 409).length;
      const [{ n: bajas }] = ((await pool.query("SELECT COUNT(*) AS n FROM TenantLifecycleEvents WHERE tenant_id = ? AND event_type = 'CANCELED'", [t])) as any)[0];
      if (exitos !== 1 || conflictos !== 3 || Number(bajas) !== 1) malas++;
    }
    expect({ errores: [...new Set(errores)], rondasMalas: malas }).toEqual({ errores: [], rondasMalas: 0 });
  }, 180000);

  it(`solicitarReembolso: 8 pedidos simultáneos x ${RONDAS} cobros: se manda UN reembolso a Paddle por cobro y ningún error de base`, async () => {
    await limpiar();
    let errores: string[] = [];
    let malas = 0;
    for (let n = 0; n < RONDAS; n++) {
      const t = await tenant(n);
      const txn = `txn_01valconc${String(n).padStart(13, "0")}`;
      const inicio = new Date(Date.now() - 36 * 3_600_000);
      await pool.query(
        "INSERT INTO BillingTransactions (tenant_id, paddle_transaction_id, amount, currency, status, billed_at, raw_event) VALUES (?, ?, 10, 'USD', 'completed', ?, ?)",
        [t, txn, inicio, JSON.stringify({ data: { billing_period: { starts_at: inicio.toISOString(), ends_at: new Date(inicio.getTime() + 30 * 86_400_000).toISOString() }, details: { line_items: [{ id: "txnitm_01valconc000000000000a", totals: { total: "1000" } }] } } })]
      );
      fetchMock.mockClear();
      const r = await Promise.allSettled(Array.from({ length: 8 }, () => solicitarReembolso({ tenantId: t, transactionId: txn, reason: "carrera de pedidos", email: "a@b.c", esSuperAdmin: false })));
      errores = errores.concat(erroresDeBase(r));
      if (r.filter((x) => x.status === "fulfilled").length !== 1 || fetchMock.mock.calls.length !== 1) malas++;
    }
    expect({ errores: [...new Set(errores)], rondasMalas: malas }).toEqual({ errores: [], rondasMalas: 0 });
  }, 180000);
});

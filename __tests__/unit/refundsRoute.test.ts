// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rol: vi.fn(),
  esSuper: vi.fn(),
  limite: vi.fn(),
  listar: vi.fn(),
  pedir: vi.fn(),
}));

vi.mock("@/lib/requestAuth", () => {
  class AuthError extends Error {
    status: number;
    constructor(msg: string, status = 403) {
      super(msg);
      this.status = status;
    }
  }
  return { AuthError, requireTenantRole: m.rol, hasSystemRole: m.esSuper };
});
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo-tenant" }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: m.limite } }));
vi.mock("@/services/refunds.service", () => ({ listarCobros: m.listar, solicitarReembolso: m.pedir, VENTANA_REEMBOLSO_DIAS: 14 }));

import { GET, POST } from "@/app/api/billing/refunds/route";
import { AuthError } from "@/lib/requestAuth";

const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const TXN = "txn_01m4rzzzzzzzzzzzzzzzzzzzzz";

const post = (cuerpo: unknown) => POST(new NextRequest("http://localhost/api/billing/refunds", { method: "POST", body: JSON.stringify(cuerpo) }));
const get = (q = `tenantId=${TENANT}`) => GET(new NextRequest(`http://localhost/api/billing/refunds?${q}`));

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.rol.mockResolvedValue({ email: "owner@cliente.com", isCorporateDomain: false });
  m.esSuper.mockResolvedValue(false);
  m.limite.mockResolvedValue({ allowed: true, resetAt: new Date() });
  m.listar.mockResolvedValue([]);
  m.pedir.mockResolvedValue({ adjustmentId: "adj_01", status: "pending_approval" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/billing/refunds", () => {
  const valido = { tenantId: TENANT, transactionId: TXN, reason: "El cliente pidió la baja" };

  it("un Admin/Owner del tenant pide el reembolso, con ventana", async () => {
    const r = await post(valido);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, adjustmentId: "adj_01", status: "pending_approval" });
    expect(m.rol).toHaveBeenCalledWith(expect.anything(), TENANT, ["Admin", "Owner"]);
    expect(m.pedir).toHaveBeenCalledWith({ tenantId: TENANT, transactionId: TXN, reason: "El cliente pidió la baja", email: "owner@cliente.com", esSuperAdmin: false, modo: undefined });
  });

  it("pasa el modo pedido al servicio (que decide si ese usuario puede pedir el total)", async () => {
    await post({ ...valido, modo: "total" });
    expect(m.pedir).toHaveBeenCalledWith(expect.objectContaining({ modo: "total" }));
    await post({ ...valido, modo: "proporcional" });
    expect(m.pedir).toHaveBeenLastCalledWith(expect.objectContaining({ modo: "proporcional" }));
  });

  it("un modo que no existe es 400 y no llega al servicio", async () => {
    expect((await post({ ...valido, modo: "mitad" })).status).toBe(400);
    expect(m.pedir).not.toHaveBeenCalled();
  });

  it("un SuperAdmin de dominio corporativo pide sin ventana", async () => {
    m.rol.mockResolvedValue({ email: "soporte@cscloudsolutions.com", isCorporateDomain: true });
    m.esSuper.mockResolvedValue(true);
    await post(valido);
    expect(m.pedir).toHaveBeenCalledWith(expect.objectContaining({ esSuperAdmin: true }));
  });

  it("un rol SUPERADMIN de un correo que NO es del dominio corporativo no cuenta como SuperAdmin", async () => {
    m.esSuper.mockResolvedValue(true);
    await post(valido);
    expect(m.pedir).toHaveBeenCalledWith(expect.objectContaining({ esSuperAdmin: false }));
    expect(m.esSuper).not.toHaveBeenCalled();
  });

  it("sin rol sobre el tenant, 403 y no se pide nada", async () => {
    m.rol.mockRejectedValue(new AuthError("Acceso denegado", 403));
    expect((await post(valido)).status).toBe(403);
    expect(m.pedir).not.toHaveBeenCalled();
  });

  it.each([
    ["falta el motivo", { tenantId: TENANT, transactionId: TXN }],
    ["falta la transacción", { tenantId: TENANT, reason: "motivo válido" }],
    ["falta el tenant", { transactionId: TXN, reason: "motivo válido" }],
    ["la transacción no tiene forma de txn_", { ...{ tenantId: TENANT, reason: "motivo válido" }, transactionId: "txn_x'; DROP TABLE" }],
  ])("400 si %s", async (_n, cuerpo) => {
    expect((await post(cuerpo)).status).toBe(400);
    expect(m.pedir).not.toHaveBeenCalled();
  });

  it("un tenant demo no tiene cobros reales", async () => {
    expect((await post({ ...valido, tenantId: "demo-tenant" })).status).toBe(400);
    expect(m.pedir).not.toHaveBeenCalled();
  });

  it("limita los pedidos: 429 sin llegar al servicio", async () => {
    m.limite.mockResolvedValue({ allowed: false, resetAt: new Date() });
    expect((await post(valido)).status).toBe(429);
    expect(m.pedir).not.toHaveBeenCalled();
    expect(m.limite).toHaveBeenCalledWith(`refund:${TENANT}:owner@cliente.com`, 5, 60_000);
  });

  it("el error del servicio llega con su status y su mensaje", async () => {
    m.pedir.mockRejectedValue(Object.assign(new Error("Ese cobro ya fue reembolsado."), { status: 409 }));
    const r = await post(valido);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "Ese cobro ya fue reembolsado." });
  });

  it("un fallo inesperado es 500 sin filtrar el detalle", async () => {
    m.pedir.mockRejectedValue(new Error("ER_ACCESS_DENIED secreto-interno"));
    const r = await post(valido);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secreto-interno");
  });
});

describe("GET /api/billing/refunds", () => {
  it("lista los cobros con la ventana del Admin/Owner", async () => {
    m.listar.mockResolvedValue([{ transactionId: TXN }]);
    const j = await (await get()).json();
    expect(j).toEqual({ success: true, cobros: [{ transactionId: TXN }], ventanaDias: 14 });
    expect(m.listar).toHaveBeenCalledWith(TENANT, false);
  });

  it("al SuperAdmin no le informa ventana", async () => {
    m.rol.mockResolvedValue({ email: "soporte@cscloudsolutions.com", isCorporateDomain: true });
    m.esSuper.mockResolvedValue(true);
    expect((await (await get()).json()).ventanaDias).toBeNull();
    expect(m.listar).toHaveBeenCalledWith(TENANT, true);
  });

  it("400 sin tenantId y 403 sin rol", async () => {
    expect((await get("")).status).toBe(400);
    m.rol.mockRejectedValue(new AuthError("Acceso denegado", 403));
    expect((await get()).status).toBe(403);
    expect(m.listar).not.toHaveBeenCalled();
  });

  it("un tenant demo devuelve la lista vacía", async () => {
    expect((await (await get("tenantId=demo-tenant")).json()).cobros).toEqual([]);
    expect(m.listar).not.toHaveBeenCalled();
  });
});

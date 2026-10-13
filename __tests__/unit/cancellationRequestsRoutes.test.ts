// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ superadmin: vi.fn(), listar: vi.fn(), resolver: vi.fn() }));

vi.mock("@/lib/requestAuth", () => {
  class AuthError extends Error {
    status: number;
    constructor(msg: string, status = 403) {
      super(msg);
      this.status = status;
    }
  }
  return { AuthError, requireSuperAdmin: m.superadmin };
});
vi.mock("@/services/cancellationRequests.service", () => ({ listarSolicitudes: m.listar, resolverSolicitud: m.resolver }));

import { GET } from "@/app/api/superadmin/cancellation-requests/route";
import { POST } from "@/app/api/superadmin/cancellation-requests/[id]/route";
import { AuthError } from "@/lib/requestAuth";

const get = (q = "") => GET(new NextRequest(`http://localhost/api/superadmin/cancellation-requests${q}`));
const post = (id: string, cuerpo: unknown) =>
  POST(new NextRequest(`http://localhost/api/superadmin/cancellation-requests/${id}`, { method: "POST", body: JSON.stringify(cuerpo) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.superadmin.mockResolvedValue({ email: "soporte@cscloudsolutions.com" });
  m.listar.mockResolvedValue([]);
  m.resolver.mockResolvedValue({ id: 5, estado: "APPROVED" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/superadmin/cancellation-requests", () => {
  it("lista las solicitudes (todas, con las pendientes primero) para un SuperAdmin", async () => {
    m.listar.mockResolvedValue([{ id: 1 }]);
    const r = await get();
    expect(await r.json()).toEqual({ success: true, solicitudes: [{ id: 1 }] });
    expect(m.listar).toHaveBeenCalledWith(undefined);
  });

  it("filtra por estado", async () => {
    await get("?status=PENDING");
    expect(m.listar).toHaveBeenCalledWith("PENDING");
  });

  it("un estado que no existe es 400", async () => {
    expect((await get("?status=BORRADA")).status).toBe(400);
    expect(m.listar).not.toHaveBeenCalled();
  });

  it("quien no es SuperAdmin recibe 403 y no ve nada", async () => {
    m.superadmin.mockRejectedValue(new AuthError("Acceso denegado", 403));
    expect((await get()).status).toBe(403);
    expect(m.listar).not.toHaveBeenCalled();
  });
});

describe("POST /api/superadmin/cancellation-requests/{id}", () => {
  it("aprueba como el SuperAdmin autenticado (el actor no lo elige el cuerpo) y pasa nota, fecha y omitirPaddle", async () => {
    const r = await post("5", { decision: "approve", note: "ok", effectiveDate: "2030-01-31", skipPaddle: true, actor: "otro@x.com" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, id: 5, estado: "APPROVED" });
    expect(m.resolver).toHaveBeenCalledWith({ id: 5, decision: "approve", actor: "soporte@cscloudsolutions.com", nota: "ok", fechaEfectiva: "2030-01-31", omitirPaddle: true });
  });

  it("skipPaddle sólo vale si es exactamente true", async () => {
    await post("5", { decision: "approve", skipPaddle: "true" });
    expect(m.resolver).toHaveBeenCalledWith(expect.objectContaining({ omitirPaddle: false }));
  });

  it.each([["0"], ["-3"], ["abc"], ["1.5"]])("el id %j es 400", async (id) => {
    expect((await post(id, { decision: "approve" })).status).toBe(400);
    expect(m.resolver).not.toHaveBeenCalled();
  });

  it("sin ser SuperAdmin, 403 y no se ejecuta nada", async () => {
    m.superadmin.mockRejectedValue(new AuthError("Acceso denegado", 403));
    expect((await post("5", { decision: "approve" })).status).toBe(403);
    expect(m.resolver).not.toHaveBeenCalled();
  });

  it("el error del servicio llega con su status y su mensaje", async () => {
    m.resolver.mockRejectedValue(Object.assign(new Error("Paddle no pudo programar la baja: x"), { status: 502 }));
    const r = await post("5", { decision: "approve" });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "Paddle no pudo programar la baja: x" });
  });

  it("un fallo inesperado es 500 sin filtrar el detalle", async () => {
    m.resolver.mockRejectedValue(new Error("ER_ACCESS_DENIED secreto-interno"));
    const r = await post("5", { decision: "approve" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secreto-interno");
  });

  it("un cuerpo que no es JSON no tira: llega como decisión vacía y el servicio lo rechaza", async () => {
    m.resolver.mockRejectedValue(Object.assign(new Error("decision debe ser 'approve' o 'reject'."), { status: 400 }));
    const req = new NextRequest("http://localhost/api/superadmin/cancellation-requests/5", { method: "POST", body: "no es json" });
    expect((await POST(req, { params: Promise.resolve({ id: "5" }) })).status).toBe(400);
  });
});

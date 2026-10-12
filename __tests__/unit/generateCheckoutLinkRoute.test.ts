// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { superAdminMock, generarMock, AuthError } = vi.hoisted(() => {
  class AuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.status = status;
    }
  }
  return { superAdminMock: vi.fn(), generarMock: vi.fn(), AuthError };
});

vi.mock("@/lib/requestAuth", () => ({ requireSuperAdmin: superAdminMock, AuthError }));
vi.mock("@/services/superAdminTenants.service", () => ({ generatePaddleCheckoutLink: generarMock }));

import { POST } from "@/app/api/superadmin/tenants/paddle/generate-checkout-link/route";

/**
 * Ruta que llama el panel de SuperAdmin para cobrar un deal Enterprise. La interfaz sólo mostraba "Error al generar
 * enlace de Paddle" aunque el servidor supiera el motivo: estos tests fijan que el motivo y el código HTTP llegan intactos.
 */
const pedir = (cuerpo: unknown, mock = false) =>
  new NextRequest(`http://localhost/api/superadmin/tenants/paddle/generate-checkout-link${mock ? "?mock=true" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
const VALIDO = { tenantId: "81ebe027-e6af-4e09-bc73-58c9012c6408", paddlePriceId: "pri_01kve67ce9j9b9697hm7jb58s7" };

beforeEach(() => {
  superAdminMock.mockReset().mockResolvedValue({ email: "ana@cscloudsolutions.com.ar" });
  generarMock.mockReset().mockResolvedValue({ checkoutUrl: "https://pay.example/?_ptxn=txn_1", priceId: VALIDO.paddlePriceId, tenantId: VALIDO.tenantId, transactionId: "txn_1" });
});

describe("POST /api/superadmin/tenants/paddle/generate-checkout-link", () => {
  it("exige SuperAdmin: sin serlo, 403 y no se crea ninguna transacción", async () => {
    superAdminMock.mockRejectedValue(new AuthError("Acceso denegado. Se requieren privilegios de Super Administrador.", 403));
    const r = await POST(pedir(VALIDO));
    expect(r.status).toBe(403);
    expect(generarMock).not.toHaveBeenCalled();
  });

  it("devuelve el enlace y la transacción", async () => {
    const r = await POST(pedir(VALIDO));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, checkoutUrl: "https://pay.example/?_ptxn=txn_1", priceId: VALIDO.paddlePriceId, tenantId: VALIDO.tenantId, transactionId: "txn_1" });
    expect(generarMock).toHaveBeenCalledWith(VALIDO, false);
  });

  it.each([
    ["sin tenantId", { paddlePriceId: VALIDO.paddlePriceId }],
    ["sin precio", { tenantId: VALIDO.tenantId }],
    ["sin cuerpo", {}],
  ])("%s: 400 sin llamar al servicio", async (_caso, cuerpo) => {
    const r = await POST(pedir(cuerpo));
    expect(r.status).toBe(400);
    expect(generarMock).not.toHaveBeenCalled();
  });

  it("si Paddle rechazó la transacción, la interfaz recibe el motivo y un 502 (no un 500 mudo)", async () => {
    generarMock.mockRejectedValue(Object.assign(new Error("Paddle rechazó la transacción: no default payment link"), { status: 502 }));
    const r = await POST(pedir(VALIDO));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ success: false, error: "Paddle rechazó la transacción: no default payment link" });
  });

  it("un dato inválido (precio mal escrito) llega como 400 con su explicación", async () => {
    generarMock.mockRejectedValue(Object.assign(new Error("El Price ID de Paddle tiene que empezar con pri_"), { status: 400 }));
    const r = await POST(pedir(VALIDO));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("pri_");
  });

  it("un error inesperado sigue siendo 500", async () => {
    generarMock.mockRejectedValue(new Error("boom"));
    expect((await POST(pedir(VALIDO))).status).toBe(500);
  });

  it("el modo demo no pide credenciales (el servicio responde con un enlace falso, sin Paddle ni base)", async () => {
    await POST(pedir(VALIDO, true));
    expect(superAdminMock).not.toHaveBeenCalled();
    expect(generarMock).toHaveBeenCalledWith(VALIDO, true);
  });
});

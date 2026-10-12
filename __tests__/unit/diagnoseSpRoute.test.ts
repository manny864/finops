// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { identityMock, rolMock, rateMock, getTokenMock, credencialCtor, subsMock, AuthError } = vi.hoisted(() => {
  class AuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.status = status;
    }
  }
  return { identityMock: vi.fn(), rolMock: vi.fn(), rateMock: vi.fn(), getTokenMock: vi.fn(), credencialCtor: vi.fn(), subsMock: vi.fn(), AuthError };
});

vi.mock("@/lib/requestAuth", () => ({ requireRequestIdentity: identityMock, requireTenantRole: rolMock, AuthError }));
vi.mock("@/lib/rateLimiter", () => ({ default: { checkByKeyDistributed: rateMock } }));
vi.mock("@/lib/azure", () => ({ listTenantSubscriptions: subsMock }));
vi.mock("@azure/identity", () => ({
  ClientSecretCredential: class {
    constructor(...args: unknown[]) {
      credencialCtor(...args);
    }
    getToken = getTokenMock;
  },
}));

import { POST } from "@/app/api/admin/diagnose-sp/route";

/**
 * El paso 2 del asistente de onboarding llamaba a `/api/admin/diagnose-sp`, que no existía: el 404 hacía lanzar a
 * `response.json()` y el formulario no mostraba nada. Estos tests fijan el contrato de la ruta nueva: quién puede
 * llamarla, qué valida antes de ir a Entra, cómo traduce cada fallo de Entra y que el secreto no sale nunca.
 */
const PLATAFORMA = "8b41364f-581a-4e43-b7cb-13138dac5517";
const SP_TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const SP_CLIENT = "ebc0781f-bf47-45b8-b0a4-e7f19f69b4fa";
const SECRETO = "Xy8~Q-valor-del-secreto_ABC123.def456";

const pedir = (cuerpo: Record<string, unknown> = {}) =>
  new NextRequest("http://localhost/api/admin/diagnose-sp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: SP_CLIENT, tenant_id: SP_TENANT, client_secret: SECRETO, ...cuerpo }),
  });

/** Un error del SDK de identidad, con la forma real que se vio en los logs de staging. */
const errorDeEntra = (aadsts: string) =>
  Object.assign(new Error(`invalid_client: Error(s): ${aadsts} - Timestamp: 2026-10-12 19:38:14Z - Description: AADSTS${aadsts}: algo. Trace ID: 0000`), {
    name: "AuthenticationRequiredError",
  });

beforeEach(() => {
  identityMock.mockReset().mockResolvedValue({ tenantId: PLATAFORMA, email: "ana@cscloudsolutions.com.ar", claims: {} });
  rolMock.mockReset().mockResolvedValue(undefined);
  rateMock.mockReset().mockResolvedValue({ allowed: true, remaining: 9, resetAt: new Date() });
  getTokenMock.mockReset().mockResolvedValue({ token: "t", expiresOnTimestamp: 0 });
  credencialCtor.mockReset();
  subsMock.mockReset().mockResolvedValue([
    { subscriptionId: "sub-1", displayName: "Producción", tenantId: SP_TENANT },
    { subscriptionId: "sub-2", tenantId: SP_TENANT },
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/admin/diagnose-sp", () => {
  describe("quién puede llamarla", () => {
    it("sin sesión válida: 401 y no se le pregunta nada a Entra", async () => {
      identityMock.mockRejectedValue(new AuthError("Token inválido", 401));
      const r = await POST(pedir());
      expect(r.status).toBe(401);
      expect(getTokenMock).not.toHaveBeenCalled();
    });

    it("un usuario que no es Admin/Owner del tenant: 403, sin consumir cupo ni preguntarle a Entra", async () => {
      rolMock.mockRejectedValue(new AuthError("Acceso denegado: requiere rol Admin/Owner.", 403));
      const r = await POST(pedir());
      expect(r.status).toBe(403);
      expect(rateMock).not.toHaveBeenCalled();
      expect(getTokenMock).not.toHaveBeenCalled();
    });

    it("el rol se exige sobre el tenant de la plataforma en el que se actúa, no sobre el directorio del Service Principal", async () => {
      const otro = "11111111-2222-4333-8444-555555555555";
      await POST(pedir({ platform_tenant_id: otro }));
      expect(rolMock).toHaveBeenCalledWith(expect.anything(), otro, ["Admin", "Owner"]);
      expect(rolMock).not.toHaveBeenCalledWith(expect.anything(), SP_TENANT, expect.anything());
    });

    it("sin platform_tenant_id (o con uno que no es GUID) usa el tenant del token", async () => {
      await POST(pedir());
      await POST(pedir({ platform_tenant_id: "no-es-un-guid" }));
      expect(rolMock.mock.calls.map(([, t]) => t)).toEqual([PLATAFORMA, PLATAFORMA]);
    });

    it("pasados los 10 intentos por minuto: 429 y Entra no se consulta (cada intento es un pedido de token con un secreto ajeno)", async () => {
      rateMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });
      const r = await POST(pedir());
      expect(r.status).toBe(429);
      expect((await r.json()).code).toBe("RATE_LIMITED");
      expect(getTokenMock).not.toHaveBeenCalled();
      expect(rateMock).toHaveBeenCalledWith(`diagnose-sp:${PLATAFORMA}:ana@cscloudsolutions.com.ar`, 10, 60_000);
    });
  });

  describe("lo que valida antes de ir a Entra", () => {
    it.each([
      ["falta el Client ID", { client_id: "" }],
      ["el Client ID no es un GUID", { client_id: "mi-app" }],
      ["falta el Tenant ID", { tenant_id: undefined }],
      ["el Tenant ID es un dominio y no un GUID", { tenant_id: "contoso.onmicrosoft.com" }],
      ["falta el secreto", { client_secret: "" }],
      ["el secreto no es texto", { client_secret: 12345 }],
      ["el secreto es de un largo imposible", { client_secret: "x".repeat(257) }],
    ])("%s: 400 INVALID_INPUT sin tocar Entra", async (_caso, cuerpo) => {
      const r = await POST(pedir(cuerpo));
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ success: false, code: "INVALID_INPUT" });
      expect(getTokenMock).not.toHaveBeenCalled();
    });

    it("un cuerpo que no es JSON: 400, no un 500", async () => {
      const mal = new NextRequest("http://localhost/api/admin/diagnose-sp", { method: "POST", body: "esto no es json" });
      expect((await POST(mal)).status).toBe(400);
    });

    it.each([
      ["un GUID pelado", "4c0531cb-e531-4644-895b-e3b844784c57"],
      ["un GUID con comillas y espacios de copiar-pegar", `  "4c0531cb-e531-4644-895b-e3b844784c57"  `],
    ])("el secreto es %s (el ID del secreto, no su valor): lo dice sin ir a Entra", async (_caso, secreto) => {
      const r = await POST(pedir({ client_secret: secreto }));
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ success: false, code: "SECRET_ID_NOT_VALUE" });
      expect(getTokenMock).not.toHaveBeenCalled();
    });
  });

  describe("cómo traduce lo que contesta Entra", () => {
    it.each([
      ["7000215", "INVALID_SECRET"],
      ["7000222", "SECRET_EXPIRED"],
      ["700016", "APP_NOT_FOUND"],
      ["90002", "TENANT_NOT_FOUND"],
      ["7000112", "APP_DISABLED"],
    ])("AADSTS%s es %s", async (aadsts, code) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      getTokenMock.mockRejectedValue(errorDeEntra(aadsts));
      const r = await POST(pedir());
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ success: false, code, aadsts });
      expect(subsMock).not.toHaveBeenCalled();
    });

    it("un AADSTS que no sabemos explicar es AUTH_FAILED y conserva el número para soporte", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      getTokenMock.mockRejectedValue(errorDeEntra("50012"));
      expect(await (await POST(pedir())).json()).toMatchObject({ code: "AUTH_FAILED", aadsts: "50012" });
    });

    it("un fallo sin código de Entra (red, timeout) es NETWORK, no 'secreto inválido'", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      getTokenMock.mockRejectedValue(new TypeError("fetch failed"));
      expect(await (await POST(pedir())).json()).toMatchObject({ success: false, code: "NETWORK" });
    });

    it("el pedido a Entra lleva un tope de tiempo", async () => {
      await POST(pedir());
      const opciones = getTokenMock.mock.calls[0][1];
      expect(opciones.abortSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("el resultado", () => {
    it("credencial válida y suscripciones visibles: success con la cantidad y los nombres", async () => {
      const r = await POST(pedir());
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ success: true, subscriptions: 2, names: ["Producción", "sub-2"] });
      expect(subsMock).toHaveBeenCalledWith(SP_TENANT, expect.anything(), expect.any(AbortSignal));
    });

    it("la credencial se arma con el directorio, el client ID y el secreto YA saneado (sin comillas ni espacios)", async () => {
      await POST(pedir({ client_secret: `  "${SECRETO}" `, client_id: ` ${SP_CLIENT} ` }));
      expect(credencialCtor).toHaveBeenCalledWith(SP_TENANT, SP_CLIENT, SECRETO);
    });

    it("credencial válida pero sin ninguna suscripción: NO_SUBSCRIPTIONS (falta el rol Reader), no un éxito", async () => {
      subsMock.mockResolvedValue([]);
      expect(await (await POST(pedir())).json()).toMatchObject({ success: false, code: "NO_SUBSCRIPTIONS" });
    });

    it("Azure responde 403 al listar: ACCESS_DENIED", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      subsMock.mockRejectedValue(Object.assign(new Error("AccessDenied: ARM respondió 403"), { statusCode: 403, code: "AccessDenied" }));
      expect(await (await POST(pedir())).json()).toMatchObject({ success: false, code: "ACCESS_DENIED" });
    });

    it("Azure falla de otra forma al listar: NETWORK", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      subsMock.mockRejectedValue(new Error("socket hang up"));
      expect(await (await POST(pedir())).json()).toMatchObject({ success: false, code: "NETWORK" });
    });
  });

  describe("el secreto no sale", () => {
    it("ni en la respuesta ni en los logs, aunque el error del SDK lo traiga en el mensaje", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      getTokenMock.mockRejectedValue(new Error(`AADSTS7000215: Invalid client secret provided: ${SECRETO}`));
      const r = await POST(pedir());
      const cuerpo = JSON.stringify(await r.json());
      expect(cuerpo).not.toContain(SECRETO);
      for (const espia of [log, aviso, err]) expect(JSON.stringify(espia.mock.calls)).not.toContain(SECRETO);
    });

    it("en un error interno tampoco: responde 500 genérico y no repite el mensaje", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      rateMock.mockRejectedValue(new Error(`boom ${SECRETO}`));
      const r = await POST(pedir());
      expect(r.status).toBe(500);
      expect(JSON.stringify(await r.json())).not.toContain(SECRETO);
    });
  });
});

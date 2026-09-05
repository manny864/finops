import { describe, it, expect, vi, beforeEach } from "vitest";

// El módulo arrastra Redis, Cost Management y el cliente de ARG en el import;
// nada de eso participa del camino que se prueba acá.
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@azure/arm-costmanagement", () => ({ CostManagementClient: class {} }));
vi.mock("@/modules/collectors/azure/billing/billingHelpers", () => ({
  withRetry: (fn: any) => fn(),
}));

const recursos = vi.fn();
vi.mock("@/lib/azure", () => ({
  getResourceGraphClient: async () => ({ resources: recursos }),
}));

import { listResourcesByTypes } from "./diagnosticsShared";

const credencial = { getToken: async () => ({ token: "t" }) };
const SUBS = ["sub-a", "sub-b"];
const TIPOS = ["microsoft.documentdb/databaseaccounts", "microsoft.dbformysql/servers"];

describe("listResourcesByTypes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    recursos.mockReset();
  });

  it("no cae al fallback de ARM cuando el KQL responde bien con 0 filas", async () => {
    // Cero filas es la respuesta correcta para un tenant sin ese tipo de
    // recurso. Tratarla como fallo costaba 148 llamadas ARM por tenant.
    recursos.mockResolvedValue({ data: [] });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await listResourcesByTypes("t1", TIPOS, SUBS, credencial)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sí cae al fallback cuando el KQL falla", async () => {
    recursos.mockRejectedValue(new Error("ARG throttled"));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ value: [] }), { status: 200 }),
    );

    await listResourcesByTypes("t1", TIPOS, SUBS, credencial);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("pide cada tipo una sola vez por suscripción y no saltea los que siguen", async () => {
    // Dos regresiones en una: el loop de casings duplicaba cada llamada, y su
    // `break` —al quedar huérfano— cortaba el for de tipos, dejando sin
    // consultar todo lo que viniera después del primer tipo con resultados.
    recursos.mockRejectedValue(new Error("ARG down"));
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({ value: [{ id: `/subscriptions/x/${urls.length}`, name: "r" }] }),
        { status: 200 },
      );
    });

    await listResourcesByTypes("t1", TIPOS, SUBS, credencial);

    expect(urls).toHaveLength(SUBS.length * TIPOS.length);
    for (const sub of SUBS) {
      for (const tipo of TIPOS) {
        expect(urls.filter((u) => u.includes(sub) && u.includes(encodeURIComponent(tipo)))).toHaveLength(1);
      }
    }
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { accesoDeLaListaDeTenants, consultarAcceso } from "@/lib/accesoTenantClient";

/** STRIDE-03 — la regla de oro del cliente: ante cualquier duda, NO se asume una negativa. */
const respuesta = (body: unknown, ok = true) =>
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response) as unknown as typeof fetch;

describe("consultarAcceso (/api/me/acceso)", () => {
    it("pide el tenant codificado y manda el token", async () => {
        const f = respuesta({ acceso: { ok: true } });
        await consultarAcceso("a b/c", "tok", f);
        expect(f).toHaveBeenCalledWith("/api/me/acceso?tenantId=a%20b%2Fc", { headers: { Authorization: "Bearer tok" } });
    });

    it("acceso concedido", async () => {
        expect(await consultarAcceso("t", "x", respuesta({ acceso: { ok: true } }))).toEqual({ ok: true });
    });

    it.each([
        [{ ok: false, motivo: "SIN_CUPO", tier: "Professional", limite: 3 }, { ok: false, motivo: "SIN_CUPO", tier: "Professional", limite: 3 }],
        [{ ok: false, motivo: "DESHABILITADA" }, { ok: false, motivo: "DESHABILITADA" }],
        [{ ok: false, motivo: "NO_INVITADO" }, { ok: false, motivo: "NO_INVITADO" }],
        [{ ok: false, motivo: "SIN_ACCESO" }, { ok: false, motivo: "SIN_ACCESO" }],
        [{ ok: false, motivo: "SIN_SUSCRIPCION" }, { ok: false, motivo: "SIN_SUSCRIPCION" }],
    ])("negativa %j", async (acceso, esperado) => {
        expect(await consultarAcceso("t", "x", respuesta({ acceso }))).toEqual(esperado);
    });

    it("descarta campos que no son del tipo esperado (tier no texto, límite no numérico)", async () => {
        const r = await consultarAcceso("t", "x", respuesta({ acceso: { ok: false, motivo: "SIN_CUPO", tier: 5, limite: "3" } }));
        expect(r).toEqual({ ok: false, motivo: "SIN_CUPO" });
    });

    it.each([
        ["HTTP 401", respuesta({ error: "x" }, false)],
        ["HTTP 500", respuesta({ error: "x" }, false)],
        ["cuerpo sin acceso", respuesta({ success: true })],
        ["acceso sin ok", respuesta({ acceso: {} })],
        ["motivo que este cliente no conoce", respuesta({ acceso: { ok: false, motivo: "MOTIVO_NUEVO" } })],
        ["motivo ausente", respuesta({ acceso: { ok: false } })],
        ["cuerpo nulo", respuesta(null)],
        ["JSON roto", vi.fn(async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }) as unknown as Response) as unknown as typeof fetch],
        ["sin red", vi.fn(async () => { throw new TypeError("network"); }) as unknown as typeof fetch],
    ])("no se pudo saber (%s) -> null, nunca una negativa", async (_caso, f) => {
        expect(await consultarAcceso("t", "x", f)).toBeNull();
    });
});

describe("accesoDeLaListaDeTenants (/api/tenants)", () => {
    it("devuelve el motivo de una negativa de la organización", () => {
        expect(accesoDeLaListaDeTenants({ tenants: [], acceso: { motivo: "SIN_CUPO", tier: "Business", limite: 5 } }))
            .toEqual({ motivo: "SIN_CUPO", tier: "Business", limite: 5 });
        expect(accesoDeLaListaDeTenants({ acceso: { motivo: "SIN_ACCESO" } })).toEqual({ motivo: "SIN_ACCESO" });
    });

    it("SIN_SUSCRIPCION no es «sin acceso»: sigue yendo a la pantalla de precios", () => {
        expect(accesoDeLaListaDeTenants({ acceso: { motivo: "SIN_SUSCRIPCION" } })).toBeNull();
    });

    it.each([[undefined], [null], [{}], [{ acceso: null }], [{ acceso: { motivo: "XYZ" } }], ["texto"], [42]])(
        "ausente o inválido (%j) -> null", (data) => {
            expect(accesoDeLaListaDeTenants(data)).toBeNull();
        });
});

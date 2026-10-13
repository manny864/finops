// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { consultar, exigirRol } = vi.hoisted(() => ({ consultar: vi.fn(), exigirRol: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: consultar } }));
vi.mock("@/lib/requestAuth", () => ({ requireTenantRole: exigirRol }));
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo-tenant" }));

import { POST } from "@/app/api/billing/marketplace/checkout/route";
import { ADDON_CATALOG } from "@/lib/addonCatalog";
import { verificarVinculo } from "@/lib/checkoutBinding";

/**
 * El servidor elige el precio del add-on y firma el vínculo: el navegador sólo dice QUÉ módulo, de qué tipo y cuántos meses.
 */
const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const MOD = ADDON_CATALOG.mod_security;

const pedir = (cuerpo: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/billing/marketplace/checkout", { method: "POST", body: JSON.stringify(cuerpo) }));

function tenant(fila: Record<string, unknown> | null) {
  consultar.mockResolvedValue([fila ? [fila] : []]);
}

beforeEach(() => {
  process.env.PADDLE_WEBHOOK_SECRET = "secreto-de-prueba";
  consultar.mockReset();
  exigirRol.mockReset().mockResolvedValue({});
  tenant({ tier: "Business", marketplace_source: null });
});
afterEach(() => {
  delete process.env.PADDLE_WEBHOOK_SECRET;
});

describe("POST /api/billing/marketplace/checkout", () => {
  it("el pase de 3 meses sale con el precio de 3 meses y un vínculo firmado para ese tenant, módulo y duración", async () => {
    const r = await pedir({ tenantId: TENANT, addonKey: "mod_security", addonType: "pass", months: 3 });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.priceId).toBe(MOD.prices.pass3m);
    expect(verificarVinculo(j.customData, [j.priceId])).toEqual({
      tenantId: TENANT, priceId: MOD.prices.pass3m, addonKey: "mod_security", addonType: "pass", months: 3, tier: undefined,
    });
  });

  it("la suscripción mensual usa el precio mensual", async () => {
    const j = await (await pedir({ tenantId: TENANT, addonKey: "mod_security", addonType: "recurring", months: 1 })).json();
    expect(j.priceId).toBe(MOD.prices.monthly);
    expect(j.customData.addon_type).toBe("recurring");
  });

  it("pide un rol de Admin u Owner sobre el tenant", async () => {
    await pedir({ tenantId: TENANT, addonKey: "mod_security", months: 1 });
    expect(exigirRol).toHaveBeenCalledWith(expect.anything(), TENANT, ["Admin", "Owner"]);
  });

  it("sin permiso sobre el tenant no firma nada", async () => {
    exigirRol.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const r = await pedir({ tenantId: TENANT, addonKey: "mod_security", months: 1 });
    expect(r.status).toBe(403);
  });

  it.each([
    ["una duración que no existe", { months: 7 }, 400],
    ["un módulo que no está en el catálogo", { addonKey: "mod_inventado" }, 404],
    ["un módulo que se contrata por capacidad, no por checkout", { addonKey: "quota_tenant" }, 400],
  ])("rechaza %s", async (_n, cambio, status) => {
    const r = await pedir({ tenantId: TENANT, addonKey: "mod_security", months: 1, ...cambio });
    expect(r.status).toBe(status);
  });

  it("un tenant demo no paga por acá", async () => {
    expect((await pedir({ tenantId: "demo-tenant", addonKey: "mod_security", months: 1 })).status).toBe(400);
  });

  it("un tenant que factura por el marketplace de Azure no compra por Paddle", async () => {
    tenant({ tier: "Business", marketplace_source: "azure_marketplace" });
    expect((await pedir({ tenantId: TENANT, addonKey: "mod_security", months: 1 })).status).toBe(403);
  });

  it("un módulo que el plan del tenant ya incluye no se vende (Enterprise tiene Seguridad)", async () => {
    tenant({ tier: "Enterprise", marketplace_source: null });
    expect((await pedir({ tenantId: TENANT, addonKey: "mod_security", months: 1 })).status).toBe(403);
  });

  it("si el período no tiene precio cargado, 400 y no se firma nada", async () => {
    const original = MOD.prices.pass9m;
    MOD.prices.pass9m = "";
    try {
      expect((await pedir({ tenantId: TENANT, addonKey: "mod_security", addonType: "pass", months: 9 })).status).toBe(400);
    } finally {
      MOD.prices.pass9m = original;
    }
  });
});

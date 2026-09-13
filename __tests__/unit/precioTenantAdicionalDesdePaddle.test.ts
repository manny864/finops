// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PADDLE_API_KEY", "key");
    vi.stubEnv("PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL", "pri_tenant_pro");
    vi.stubEnv("PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS", "pri_tenant_biz");
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

/**
 * `fetchPricesBatch` pide GET /prices?id=a,b,c y espera `data` como ARRAY.
 * Paddle manda el monto en la denominacion MINIMA: 12000 = USD 120.
 */
const lote = (porId: Record<string, string>) => ({
    ok: true,
    json: async () => ({
        data: Object.entries(porId).map(([id, amount]) => ({
            id,
            unit_price: { amount, currency_code: "USD" },
        })),
    }),
});

describe("el precio del tenant adicional lo pone Paddle, no la tabla escrita a mano", () => {
    // Los IDs del tenant adicional viven en `pricesByTier`, y el batch solo
    // recorria `prices`: nunca se le preguntaba a Paddle por ellos.
    it("pide a Paddle los price IDs por tier", async () => {
        fetchMock.mockResolvedValue(lote({ pri_tenant_pro: "12000", pri_tenant_biz: "30000" }));

        const { getModulePrices } = await import("@/services/paddlePrices.service");
        const res = await getModulePrices();

        expect(res.modules.quota_tenant.monthlyByTier).toEqual({
            Professional: 120,
            Business: 300,
        });
        const pedidos = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(pedidos.some((u) => u.includes("pri_tenant_pro"))).toBe(true);
    });

    it("si Paddle no responde, cae al precio de lista del catalogo", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

        const { getModulePrices } = await import("@/services/paddlePrices.service");
        const { ADDON_PRICE_USD } = await import("@/lib/pricing");
        const res = await getModulePrices();

        expect(res.modules.quota_tenant.monthlyByTier?.Professional).toBe(ADDON_PRICE_USD.extraTenant.Professional);
        expect(res.source).toBe("catalog");
    });

    // `live.monthly` para este producto es 0 (no tiene precio sin tier):
    // pisarlo con eso mostraba el tenant adicional a $0 en el marketplace.
    it("el producto por tier no queda en cero", async () => {
        fetchMock.mockResolvedValue(lote({ pri_tenant_pro: "12000" }));
        const { getModulePrices } = await import("@/services/paddlePrices.service");
        const res = await getModulePrices();
        expect(res.modules.quota_tenant.monthly).toBe(0);
        expect(res.modules.quota_tenant.monthlyByTier?.Professional).toBe(120);
    });
});

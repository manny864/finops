// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
    getModulePrices,
    clearPaddleModulePriceCache,
    fetchPricesBatch,
} from "@/services/paddlePrices.service";
import { ADDON_CATALOG } from "@/lib/addonCatalog";

describe("paddlePrices.service - getModulePrices", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        clearPaddleModulePriceCache();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        process.env = originalEnv;
        clearPaddleModulePriceCache();
        vi.restoreAllMocks();
    });

    it("retorna las tarifas base de ADDON_CATALOG con source: catalog si no hay PADDLE_API_KEY", async () => {
        delete process.env.PADDLE_API_KEY;

        const result = await getModulePrices();
        expect(result.source).toBe("catalog");
        expect(result.modules).toBeDefined();

        for (const [key, product] of Object.entries(ADDON_CATALOG)) {
            const mod = result.modules[key];
            expect(mod).toBeDefined();
            expect(mod.monthly).toBe(product.basePriceUSD.monthly);
            expect(mod.pass1m).toBe(product.basePriceUSD.pass1m);
            expect(mod.pass3m).toBe(product.basePriceUSD.pass3m);
            expect(mod.pass6m).toBe(product.basePriceUSD.pass6m);
            expect(mod.pass9m).toBe(product.basePriceUSD.pass9m);
            expect(mod.pass12m).toBe(product.basePriceUSD.pass12m);
            expect(mod.currency).toBe("USD");
        }
    });

    it("obtiene y actualiza los precios desde Paddle cuando la API responde con éxito", async () => {
        process.env.PADDLE_API_KEY = "pdl_live_apikey_test";

        const simulatorMonthlyId = ADDON_CATALOG.feature_simulator.prices.monthly!;
        const simulatorPass3mId = ADDON_CATALOG.feature_simulator.prices.pass3m!;

        // Mock global fetch para Paddle
        const fetchMock = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes("/prices?")) {
                return {
                    ok: true,
                    json: async () => ({
                        data: [
                            {
                                id: simulatorMonthlyId,
                                unit_price: { amount: "5500", currency_code: "USD" }, // 55 USD
                            },
                            {
                                id: simulatorPass3mId,
                                unit_price: { amount: "14500", currency_code: "USD" }, // 145 USD
                            },
                        ],
                    }),
                };
            }
            return { ok: false, status: 404 };
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await getModulePrices();
        expect(result.source).toBe("paddle");

        // Los precios que vinieron de Paddle deben estar actualizados
        const sim = result.modules.feature_simulator;
        expect(sim.monthly).toBe(55);
        expect(sim.pass3m).toBe(145);

        // Los que no vinieron en el mock conservan el fallback del catálogo
        expect(sim.pass1m).toBe(ADDON_CATALOG.feature_simulator.basePriceUSD.pass1m);
    });

    it("utiliza la caché en memoria y no repite llamadas dentro del TTL", async () => {
        process.env.PADDLE_API_KEY = "pdl_live_apikey_test";

        const fetchMock = vi.fn().mockImplementation(async () => ({
            ok: true,
            json: async () => ({
                data: [
                    {
                        id: ADDON_CATALOG.feature_simulator.prices.monthly,
                        unit_price: { amount: "4900", currency_code: "USD" },
                    },
                ],
            }),
        }));
        vi.stubGlobal("fetch", fetchMock);

        const res1 = await getModulePrices();
        const res2 = await getModulePrices();

        expect(res1.source).toBe("paddle");
        expect(res2.source).toBe("paddle");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("recae en el catálogo ante error de red o status no-200 de Paddle", async () => {
        process.env.PADDLE_API_KEY = "pdl_live_apikey_test";

        const fetchMock = vi.fn().mockRejectedValue(new Error("Paddle API offline"));
        vi.stubGlobal("fetch", fetchMock);

        const result = await getModulePrices();
        expect(result.source).toBe("catalog");
        expect(result.modules.feature_simulator.monthly).toBe(ADDON_CATALOG.feature_simulator.basePriceUSD.monthly);
    });
});

describe("paddlePrices.service - fetchPricesBatch", () => {
    it("retorna un objeto vacío si no se pasan IDs o API Key", async () => {
        expect(await fetchPricesBatch([], "apikey")).toEqual({});
        expect(await fetchPricesBatch(["pri_1"], "")).toEqual({});
    });

    it("parsea correctamente múltiples precios en lote respetando divisas", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: "pri_usd", unit_price: { amount: "1999", currency_code: "USD" } },
                    { id: "pri_jpy", unit_price: { amount: "2500", currency_code: "JPY" } },
                    { id: "pri_invalid", unit_price: { amount: "invalid", currency_code: "USD" } },
                ],
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const batch = await fetchPricesBatch(["pri_usd", "pri_jpy", "pri_invalid"], "apikey");
        expect(batch["pri_usd"]).toEqual({ amount: 19.99, currency: "USD" });
        expect(batch["pri_jpy"]).toEqual({ amount: 2500, currency: "JPY" });
        expect(batch["pri_invalid"]).toBeUndefined();
    });
});

describe("GET /api/pricing/modules", () => {
    it("responde 200 con success: true, source y lista de modulos con Cache-Control", async () => {
        const { GET } = await import("@/app/api/pricing/modules/route");
        const res = await GET();
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(["paddle", "catalog"]).toContain(json.source);
        expect(json.modules).toBeDefined();
        expect(json.modules.feature_simulator).toBeDefined();
        expect(res.headers.get("cache-control")).toContain("stale-while-revalidate=3600");
    });
});


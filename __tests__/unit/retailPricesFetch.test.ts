// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { obtenerItemsRetail, limpiarCacheItemsRetail, precioMensualDesdeUnidad } from "@/services/pricingService";

/**
 * La Retail API responde 429 "Too many requests" cuando se la consulta seguido
 * (pasó el 2026-10-08 al explorarla, tres de trece servicios), pagina de a 1000
 * y contesta 200 con `Items: []` cuando un nombre no existe. El código anterior
 * trataba todo eso como "precio 0".
 */

const item = (n: number) => ({ retailPrice: n, unitOfMeasure: "1 Hour", meterName: `m${n}`, productName: "p", skuName: "s" });
const respuesta = (cuerpo: unknown, status = 200, headers: Record<string, string> = {}) =>
    ({ ok: status >= 200 && status < 300, status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: async () => cuerpo }) as unknown as Response;

const sinEspera = async () => {};
const consulta = { serviceName: "Virtual Machines", region: "westus2", filtro: { campo: "armSkuName" as const, valor: "Standard_D2s_v3" } };

beforeEach(() => limpiarCacheItemsRetail());

describe("obtenerItemsRetail", () => {
    it("arma el $filter con servicio, región, Consumption y el SKU", async () => {
        const f = vi.fn().mockResolvedValue(respuesta({ Items: [item(1)] }));
        await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera });
        const url = decodeURIComponent(String(f.mock.calls[0][0]));
        expect(url).toContain("https://prices.azure.com/api/retail/prices?$filter=");
        expect(url).toContain("serviceName eq 'Virtual Machines'");
        expect(url).toContain("armRegionName eq 'westus2'");
        expect(url).toContain("priceType eq 'Consumption'");
        expect(url).toContain("armSkuName eq 'Standard_D2s_v3'");
    });

    it("sin filtro de SKU trae todo el servicio de la región", async () => {
        const f = vi.fn().mockResolvedValue(respuesta({ Items: [] }));
        await obtenerItemsRetail({ serviceName: "Azure App Service", region: "westus2" }, { fetch: f as any, esperar: sinEspera });
        expect(decodeURIComponent(String(f.mock.calls[0][0]))).not.toContain("SkuName eq");
    });

    it("sigue el NextPageLink hasta agotarlo", async () => {
        const f = vi.fn()
            .mockResolvedValueOnce(respuesta({ Items: [item(1), item(2)], NextPageLink: "https://prices.azure.com/p2" }))
            .mockResolvedValueOnce(respuesta({ Items: [item(3)], NextPageLink: null }));
        const r = await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera });
        expect("items" in r && r.items.map((i) => i.retailPrice)).toEqual([1, 2, 3]);
        expect(f.mock.calls[1][0]).toBe("https://prices.azure.com/p2");
    });

    it("reintenta ante un 429 y se recupera", async () => {
        const f = vi.fn()
            .mockResolvedValueOnce(respuesta("Too many requests", 429))
            .mockResolvedValueOnce(respuesta({ Items: [item(7)] }));
        const esperas: number[] = [];
        const r = await obtenerItemsRetail(consulta, { fetch: f as any, esperar: async (ms) => { esperas.push(ms); } });
        expect("items" in r && r.items).toHaveLength(1);
        expect(f).toHaveBeenCalledTimes(2);
        expect(esperas).toEqual([500]);
    });

    it("respeta Retry-After, con un tope", async () => {
        const f = vi.fn()
            .mockResolvedValueOnce(respuesta("x", 429, { "retry-after": "2" }))
            .mockResolvedValueOnce(respuesta("x", 429, { "retry-after": "999" }))
            .mockResolvedValueOnce(respuesta({ Items: [item(1)] }));
        const esperas: number[] = [];
        await obtenerItemsRetail(consulta, { fetch: f as any, esperar: async (ms) => { esperas.push(ms); } });
        expect(esperas).toEqual([2000, 5000]);
    });

    it("tras agotar los reintentos informa 'limite' y no un precio 0", async () => {
        const f = vi.fn().mockResolvedValue(respuesta("Too many requests", 429));
        const r = await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera });
        expect(r).toEqual({ error: "limite" });
        expect(f).toHaveBeenCalledTimes(3);
    });

    it("un 5xx se reintenta y, si persiste, es un error de la API", async () => {
        const f = vi.fn().mockResolvedValue(respuesta("boom", 503));
        expect(await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera })).toEqual({ error: "api" });
    });

    it("un 4xx distinto de 429 no se reintenta", async () => {
        const f = vi.fn().mockResolvedValue(respuesta("bad", 400));
        expect(await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera })).toEqual({ error: "api" });
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("una excepción de red no escapa", async () => {
        const f = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
        expect(await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera })).toEqual({ error: "api" });
    });

    it("cachea: la segunda consulta no sale a la red", async () => {
        const f = vi.fn().mockResolvedValue(respuesta({ Items: [item(1)] }));
        await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera });
        await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera });
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("dos consultas simultáneas iguales comparten una sola llamada", async () => {
        const f = vi.fn().mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5)); return respuesta({ Items: [item(1)] }); });
        const [a, b] = await Promise.all([
            obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera }),
            obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera }),
        ]);
        expect(f).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
    });

    it("la caché vence: pasado el TTL vuelve a preguntar", async () => {
        const f = vi.fn().mockResolvedValue(respuesta({ Items: [item(1)] }));
        let ahora = 1_000_000;
        const deps = { fetch: f as any, esperar: sinEspera, ahora: () => ahora };
        await obtenerItemsRetail(consulta, deps);
        ahora += 7 * 60 * 60 * 1000;
        await obtenerItemsRetail(consulta, deps);
        expect(f).toHaveBeenCalledTimes(2);
    });

    it("un resultado vacío se cachea poco: un nombre mal escrito no martilla la API pero tampoco queda para siempre", async () => {
        const f = vi.fn().mockResolvedValue(respuesta({ Items: [] }));
        let ahora = 1_000_000;
        const deps = { fetch: f as any, esperar: sinEspera, ahora: () => ahora };
        await obtenerItemsRetail(consulta, deps);
        await obtenerItemsRetail(consulta, deps);
        expect(f).toHaveBeenCalledTimes(1);
        ahora += 11 * 60 * 1000;
        await obtenerItemsRetail(consulta, deps);
        expect(f).toHaveBeenCalledTimes(2);
    });

    it("un fallo no se cachea: el siguiente intento vuelve a probar", async () => {
        const f = vi.fn().mockResolvedValueOnce(respuesta("x", 400)).mockResolvedValueOnce(respuesta({ Items: [item(1)] }));
        expect(await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera })).toEqual({ error: "api" });
        expect("items" in (await obtenerItemsRetail(consulta, { fetch: f as any, esperar: sinEspera }))).toBe(true);
    });

    it("rechaza valores que no son nombres de Azure: vienen del plan de un cliente", async () => {
        const f = vi.fn();
        for (const valor of ["x' or serviceName ne '", "Standard_D2s_v3'", "a;b", "a\nb", "{}"]) {
            const r = await obtenerItemsRetail({ ...consulta, filtro: { campo: "armSkuName", valor } }, { fetch: f as any, esperar: sinEspera });
            expect(r).toEqual({ error: "filtro-invalido" });
        }
        expect(await obtenerItemsRetail({ serviceName: "a' or 1 eq 1", region: "westus2" }, { fetch: f as any })).toEqual({ error: "filtro-invalido" });
        expect(f).not.toHaveBeenCalled();
    });

    it("acepta los nombres reales que usa el catálogo", async () => {
        const f = vi.fn().mockResolvedValue(respuesta({ Items: [] }));
        for (const [servicio, region, valor] of [
            ["Azure Database for MySQL", "westus2", "B2s"], ["Virtual Machines", "westeurope", "Standard_D2s_v3"],
            ["Load Balancer", "Global", "Standard"], ["Azure App Service", "westus2", "P1 v3"],
            ["Container Registry", "eastus", "Premium"], ["Redis Cache", "westus2", "C1"],
        ]) {
            const r = await obtenerItemsRetail({ serviceName: servicio, region, filtro: { campo: "skuName", valor } }, { fetch: f as any, esperar: sinEspera });
            expect(r).not.toEqual({ error: "filtro-invalido" });
        }
    });
});

describe("precioMensualDesdeUnidad con barra", () => {
    // Application Gateway, Container Registry y las reglas de Load Balancer
    // publican "1/Hour" y "1/Day": antes devolvían null y esos recursos nunca se tarifaban.
    it("acepta 1/Hour y 1/Day", () => {
        expect(precioMensualDesdeUnidad(0.2, "1/Hour")).toBeCloseTo(146, 4);
        expect(precioMensualDesdeUnidad(1.6666, "1/Day")).toBeCloseTo(1.6666 * (730 / 24), 4);
    });

    it("lo que pide una cantidad sigue sin convertirse", () => {
        expect(precioMensualDesdeUnidad(0.016, "1 GB")).toBeNull();
        expect(precioMensualDesdeUnidad(0.1, "1 GB/Month")).toBeNull();
        expect(precioMensualDesdeUnidad(0.4, "1K")).toBeNull();
    });
});

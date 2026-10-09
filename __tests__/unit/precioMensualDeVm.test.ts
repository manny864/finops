// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { HOURS_PER_MONTH } from "@/lib/aroUtils";
import type { ItemRetail } from "@/services/pricingService";
import { fetchDeFixture } from "../helpers/retailFixture";

/**
 * `getMonthlyCostEstimate` de una VM, contra la Retail API tal como la capturó el
 * fixture del 2026-10-08 (la consulta de hoy devuelve las mismas seis filas).
 *
 * El caso que lo motiva: `armSkuName eq 'Standard_D2s_v3'` en westus2 devuelve
 * seis filas --Linux, Windows, Spot y Low Priority, todas `Consumption`-- y la
 * PRIMERA es la Spot de Windows. El helper se quedaba con "la primera convertible"
 * y cotizaba la VM a 25,36 por mes cuando la Linux a demanda cuesta 70,08.
 *
 * El caché de precios es del módulo, así que cada test arranca con módulos nuevos.
 */
const D2S = "Virtual Machines|westus2|armSkuName|Standard_D2s_v3";
const DATOS = JSON.parse(readFileSync("__tests__/fixtures/retail-prices-2026-10-08.json", "utf8")).consultas as Record<string, ItemRetail[]>;

const mensual = (horaria: number) => horaria * HOURS_PER_MONTH;

async function estimador() {
    return (await import("@/services/pricingService")).getMonthlyCostEstimate;
}

function conFetch(f: typeof fetch) {
    const espia = vi.fn(f);
    vi.stubGlobal("fetch", espia);
    return espia;
}

/** Un fetch que contesta siempre estas filas, sin mirar el filtro. */
const respondeCon = (items: ItemRetail[]) =>
    (async () => ({ ok: true, status: 200, json: async () => ({ Items: items }) }) as Response) as typeof fetch;

beforeEach(() => {
    vi.resetModules();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("getMonthlyCostEstimate — VMs", () => {
    it("la primera fila de la API es la Spot de Windows: el fixture lo demuestra", () => {
        // Si esto cambiara, el resto del archivo ya no probaría el caso del bug.
        expect(DATOS[D2S][0].skuName).toBe("D2s v3 Spot");
        expect(DATOS[D2S][0].productName).toMatch(/Windows/);
        expect(mensual(DATOS[D2S][0].retailPrice)).toBeCloseTo(25.36, 2);
    });

    it("sin información del SO cotiza Linux a demanda: 70,08 y no los 25,36 de la Spot de Windows", async () => {
        conFetch(fetchDeFixture());
        const precio = await (await estimador())("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName");
        expect(precio).toBeCloseTo(mensual(0.096), 4);
        expect(precio).toBeCloseTo(70.08, 2);
    });

    it("con { windows: true } cotiza Windows con la licencia incluida: 137,24", async () => {
        conFetch(fetchDeFixture());
        const precio = await (await estimador())("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName", { windows: true });
        expect(precio).toBeCloseTo(mensual(0.188), 4);
        expect(precio).toBeCloseTo(137.24, 2);
    });

    it("{ windows: false } es lo mismo que no decir nada", async () => {
        conFetch(fetchDeFixture());
        const precio = await (await estimador())("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName", { windows: false });
        expect(precio).toBeCloseTo(70.08, 2);
    });

    it("vale para otro tamaño: D4s_v3 cuesta 140,16 en Linux y 274,48 en Windows", async () => {
        conFetch(fetchDeFixture());
        const f = await estimador();
        expect(await f("Virtual Machines", "Standard_D4s_v3", "westus2", "armSkuName")).toBeCloseTo(mensual(0.192), 4);
        expect(await f("Virtual Machines", "Standard_D4s_v3", "westus2", "armSkuName", { windows: true })).toBeCloseTo(mensual(0.376), 4);
    });

    it("no depende del orden en que la API devuelve las filas", async () => {
        const filas = DATOS[D2S];
        const ordenes = [filas, [...filas].reverse(), [...filas.slice(2), ...filas.slice(0, 2)], [...filas.slice(4), ...filas.slice(0, 4)]];
        for (const orden of ordenes) {
            vi.resetModules();
            conFetch(respondeCon(orden));
            const f = await estimador();
            expect(await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName")).toBeCloseTo(70.08, 2);
            expect(await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName", { windows: true })).toBeCloseTo(137.24, 2);
        }
    });

    it("nunca cotiza Spot ni Low Priority, ni siquiera cuando son lo único que hay", async () => {
        const soloBaratas = DATOS[D2S].filter((i) => /spot|low priority/i.test(i.skuName));
        expect(soloBaratas).toHaveLength(4);
        conFetch(respondeCon(soloBaratas));
        const f = await estimador();
        // 0 hace que el llamador use su propio respaldo: mejor que un precio de otra cosa.
        expect(await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName")).toBe(0);
        expect(await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName", { windows: true })).toBe(0);
    });

    it("si el tamaño no tiene medidor del SO pedido da 0 y no el del otro SO", async () => {
        const soloLinux = DATOS[D2S].filter((i) => !/windows/i.test(i.productName));
        conFetch(respondeCon(soloLinux));
        const f = await estimador();
        expect(await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName")).toBeCloseTo(70.08, 2);
        expect(await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName", { windows: true })).toBe(0);
    });

    it("Linux y Windows se cachean por separado y cada uno se pregunta una sola vez", async () => {
        const fetchEspia = conFetch(fetchDeFixture());
        const f = await estimador();
        const linux = await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName");
        const windows = await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName", { windows: true });
        expect(windows).toBeGreaterThan(linux);
        // Segunda vuelta: las dos salen de la caché.
        expect(await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName")).toBe(linux);
        expect(await f("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName", { windows: true })).toBe(windows);
        expect(fetchEspia).toHaveBeenCalledTimes(2);
    });

    it("pide a la API una VM por armSkuName, en la región y como Consumption", async () => {
        const fetchEspia = conFetch(fetchDeFixture());
        await (await estimador())("Virtual Machines", "Standard_D2s_v3", "westus2", "armSkuName");
        const url = decodeURIComponent(String(fetchEspia.mock.calls[0][0]));
        expect(url).toContain("serviceName eq 'Virtual Machines'");
        expect(url).toContain("armRegionName eq 'westus2'");
        expect(url).toContain("armSkuName eq 'Standard_D2s_v3'");
        expect(url).toContain("priceType eq 'Consumption'");
    });

    it("buscar una VM por skuName no devuelve nada: 200 con Items vacío y precio 0, no un error", async () => {
        // Es el error del llamador de licencias: le pasaba un armSkuName como skuName.
        // La API real contesta así (verificado el 2026-10-09), y por eso nadie se enteraba.
        conFetch(fetchDeFixture());
        expect(await (await estimador())("Virtual Machines", "Standard_D2s_v3", "westus2")).toBe(0);
    });
});

describe("getMonthlyCostEstimate — lo que NO es una VM no cambia", () => {
    it("un disco sigue eligiendo el medidor de capacidad y no el Disk Mount que viene primero", async () => {
        conFetch(fetchDeFixture());
        const precio = await (await estimador())("Storage", "P20 ZRS", "westus2");
        expect(DATOS["Storage|westus2|skuName|P20 ZRS"][0].meterName).toBe("P20 ZRS Disk Mount");
        expect(precio).toBeCloseTo(99.84, 2);
    });

    it("{ windows: true } se ignora fuera de Virtual Machines", async () => {
        const fetchEspia = conFetch(fetchDeFixture());
        const f = await estimador();
        const sin = await f("Storage", "P20 ZRS", "westus2");
        const con = await f("Storage", "P20 ZRS", "westus2", "skuName", { windows: true });
        expect(con).toBe(sin);
        // Misma clave de caché: no se volvió a preguntar.
        expect(fetchEspia).toHaveBeenCalledTimes(1);
    });
});

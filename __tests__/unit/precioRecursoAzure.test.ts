// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { HOURS_PER_MONTH } from "@/lib/aroUtils";
import type { ItemRetail } from "@/services/pricingService";
import { fetchDeFixture } from "../helpers/retailFixture";

/**
 * El precio de un recurso que YA EXISTE en el tenant, contra la Retail API tal
 * como la capturó el fixture (2026-10-08, y 2026-10-09 para SQL y el disco P10).
 *
 * El problema que corrige: Zombies, Rightsizing y Licencias le pasaban a
 * `getMonthlyCostEstimate` el identificador de ARM (`Premium_LRS`, `GP_Gen5_2`,
 * el servicio `App Service`...), que la Retail API no conoce. Contesta 200 con
 * `Items: []`, el helper lo traduce a 0 y cada llamador cae a su respaldo fijo:
 * nada falla y nadie se entera. `fetchDeFixture()` contesta igual que la API.
 *
 * El caché de precios es del módulo, así que cada test arranca con módulos nuevos.
 */
const DATOS = JSON.parse(readFileSync("__tests__/fixtures/retail-prices-2026-10-08.json", "utf8")).consultas as Record<string, ItemRetail[]>;
const mensual = (horaria: number) => horaria * HOURS_PER_MONTH;

async function precios() {
    return import("@/services/precioRecursoAzure");
}

function conFetch(f: typeof fetch) {
    const espia = vi.fn(f);
    vi.stubGlobal("fetch", espia);
    return espia;
}
/** Las consultas que llegaron a la API, ya decodificadas. */
const consultas = (espia: ReturnType<typeof vi.fn>) => espia.mock.calls.map((c) => decodeURIComponent(String(c[0])));

/** Un fetch que contesta siempre estas filas, sin mirar el filtro. */
const respondeCon = (items: ItemRetail[]) =>
    (async () => ({ ok: true, status: 200, json: async () => ({ Items: items }) }) as Response) as typeof fetch;

beforeEach(() => {
    vi.resetModules();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("precioMensualDisco", () => {
    it("un Premium_LRS de 64 GB es un P6 LRS (9,28): no el respaldo de GB × 0,15", async () => {
        conFetch(fetchDeFixture());
        const precio = await (await precios()).precioMensualDisco("Premium_LRS", 64, "westus2");
        expect(precio).toBeCloseTo(9.2801, 4);
        expect(precio).not.toBeCloseTo(64 * 0.15, 2);
    });

    it("el tamaño se redondea hacia arriba al tier que Azure factura: 200 GB Premium es P15, no P10", async () => {
        conFetch(fetchDeFixture());
        expect(await (await precios()).precioMensualDisco("Premium_LRS", 200, "westus2")).toBeCloseTo(34.56, 2);
    });

    it("cada familia tiene su tier: Standard SSD (E10), HDD (S10) y Premium ZRS (P20 ZRS)", async () => {
        conFetch(fetchDeFixture());
        const { precioMensualDisco } = await precios();
        expect(await precioMensualDisco("StandardSSD_LRS", 128, "westus2")).toBeCloseTo(9.6, 2);
        expect(await precioMensualDisco("Standard_LRS", 128, "westus2")).toBeCloseTo(5.888, 3);
        expect(await precioMensualDisco("Premium_ZRS", 512, "westus2")).toBeCloseTo(99.84, 2);
        // El P10 sale de la captura del 2026-10-09: 128 GB es el tamaño más común.
        expect(await precioMensualDisco("Premium_LRS", 128, "westus2")).toBeCloseTo(17.92, 2);
    });

    it("el respaldo de GB × 0,15 le pegaba mal a los Standard: un HDD de 128 GB cuesta 5,89 y no 19,20", async () => {
        conFetch(fetchDeFixture());
        const precio = await (await precios()).precioMensualDisco("Standard_LRS", 128, "westus2");
        expect(precio).toBeLessThan(128 * 0.15 / 3);
    });

    it("a la API le pide el tier (`skuName eq 'P6 LRS'`) y no el nombre de ARM", async () => {
        const espia = conFetch(fetchDeFixture());
        await (await precios()).precioMensualDisco("Premium_LRS", 64, "westus2");
        const urls = consultas(espia);
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain("serviceName eq 'Storage'");
        expect(urls[0]).toContain("armRegionName eq 'westus2'");
        expect(urls[0]).toContain("skuName eq 'P6 LRS'");
        expect(urls[0]).not.toContain("Premium_LRS");
    });

    it("UltraSSD y PremiumV2 se cobran por GiB/IOPS aprovisionados: no hay tier y ni se pregunta", async () => {
        const espia = conFetch(fetchDeFixture());
        const { precioMensualDisco } = await precios();
        expect(await precioMensualDisco("UltraSSD_LRS", 512, "westus2")).toBeNull();
        expect(await precioMensualDisco("PremiumV2_LRS", 512, "westus2")).toBeNull();
        expect(espia).not.toHaveBeenCalled();
    });

    it("sin tamaño o sin tipo no inventa un precio", async () => {
        const espia = conFetch(fetchDeFixture());
        const { precioMensualDisco } = await precios();
        expect(await precioMensualDisco("Premium_LRS", null, "westus2")).toBeNull();
        expect(await precioMensualDisco("Premium_LRS", 0, "westus2")).toBeNull();
        expect(await precioMensualDisco(undefined, 128, "westus2")).toBeNull();
        expect(espia).not.toHaveBeenCalled();
    });

    it("un tier que la API no publica (200 con Items vacío) da null, no 0", async () => {
        conFetch(fetchDeFixture());
        // P1 LRS no está en el fixture: la API contesta `Items: []`.
        expect(await (await precios()).precioMensualDisco("Premium_LRS", 4, "westus2")).toBeNull();
    });

    it("no depende del orden en que la API devuelve las filas", async () => {
        const filas = DATOS["Storage|westus2|skuName|P20 ZRS"];
        for (const orden of [filas, [...filas].reverse(), [filas[2], filas[0], filas[1]]]) {
            vi.resetModules();
            conFetch(respondeCon(orden));
            expect(await (await precios()).precioMensualDisco("Premium_ZRS", 512, "westus2")).toBeCloseTo(99.84, 2);
        }
    });

    it("si la API falla da null: el llamador decide su respaldo", async () => {
        conFetch((async () => ({ ok: false, status: 400 }) as Response) as typeof fetch);
        expect(await (await precios()).precioMensualDisco("Premium_LRS", 64, "westus2")).toBeNull();
    });
});

describe("precioMensualIpPublica", () => {
    it("una Standard cuesta lo que la IP, 3,65: no lo del Public IP Prefix que comparte skuName", async () => {
        conFetch(fetchDeFixture());
        expect(await (await precios()).precioMensualIpPublica("Standard", "westus2")).toBeCloseTo(mensual(0.005), 4);
    });

    it("no depende del orden: con el Prefix primero sigue siendo 3,65 (el helper viejo daba 4,38)", async () => {
        const filas = DATOS["Virtual Network|westus2|skuName|Standard"];
        expect(filas.map((f) => f.productName).sort()).toEqual(["IP Addresses", "Public IP Prefix"]);
        for (const orden of [filas, [...filas].reverse()]) {
            vi.resetModules();
            conFetch(respondeCon(orden));
            expect(await (await precios()).precioMensualIpPublica("Standard", "westus2")).toBeCloseTo(3.65, 2);
        }
    });

    it("una Basic se cotiza estática (2,63): ARM no dice la asignación y se informa de menos", async () => {
        conFetch(fetchDeFixture());
        expect(await (await precios()).precioMensualIpPublica("Basic", "westus2")).toBeCloseTo(mensual(0.0036), 4);
    });

    it("una SKU que no es Basic ni Standard no se tarifa", async () => {
        conFetch(fetchDeFixture());
        expect(await (await precios()).precioMensualIpPublica("StandardV2", "westus2")).toBeNull();
    });
});

describe("precioMensualPlanAppService", () => {
    it("Linux y Windows tienen medidores distintos: S1 cuesta 58,40 en Linux y 73,00 en Windows", async () => {
        conFetch(fetchDeFixture());
        const { precioMensualPlanAppService } = await precios();
        expect(await precioMensualPlanAppService("S1", "westus2", true)).toBeCloseTo(mensual(0.08), 4);
        expect(await precioMensualPlanAppService("S1", "westus2", false)).toBeCloseTo(mensual(0.1), 4);
    });

    it("`P1v3` de ARM es `P1 v3` en la API", async () => {
        conFetch(fetchDeFixture());
        const { precioMensualPlanAppService } = await precios();
        expect(await precioMensualPlanAppService("P1v3", "westus2", true)).toBeCloseTo(mensual(0.155), 4);
        expect(await precioMensualPlanAppService("P1v3", "westus2", false)).toBeCloseTo(mensual(0.315), 4);
    });

    it("el servicio se llama `Azure App Service` en la API, no `App Service`", async () => {
        const espia = conFetch(fetchDeFixture());
        await (await precios()).precioMensualPlanAppService("S1", "westus2", false);
        const urls = consultas(espia);
        expect(urls[0]).toContain("serviceName eq 'Azure App Service'");
        expect(urls[0]).not.toContain("serviceName eq 'App Service'");
    });

    it("lo que se cobra por consumo o por otro esquema (Y1, EP1) no tiene precio fijo: null sin preguntar", async () => {
        const espia = conFetch(fetchDeFixture());
        const { precioMensualPlanAppService } = await precios();
        expect(await precioMensualPlanAppService("Y1", "westus2", false)).toBeNull();
        expect(await precioMensualPlanAppService("EP1", "westus2", false)).toBeNull();
        expect(espia).not.toHaveBeenCalled();
    });
});

describe("precioMensualAppGateway", () => {
    it("Standard_v2 cobra su costo fijo, 146,00, y WAF_v2 el suyo, 262,80", async () => {
        conFetch(fetchDeFixture());
        const { precioMensualAppGateway } = await precios();
        expect(await precioMensualAppGateway("Standard_v2", "westus2")).toBeCloseTo(mensual(0.2), 4);
        // Hay un "WAF v2 - Discounted" a 0,20 en la misma respuesta: no es el de un WAF_v2 normal.
        expect(await precioMensualAppGateway("WAF_v2", "westus2")).toBeCloseTo(mensual(0.36), 4);
    });

    it("los v1 (Standard_Medium, WAF_Medium) salen de su propio producto", async () => {
        conFetch(fetchDeFixture());
        const { precioMensualAppGateway } = await precios();
        expect(await precioMensualAppGateway("Standard_Medium", "westus2")).toBeCloseTo(mensual(0.07), 4);
        expect(await precioMensualAppGateway("WAF_Medium", "westus2")).toBeCloseTo(mensual(0.126), 4);
    });

    it("pide el servicio por región y elige por producto: `skuName eq 'Standard_v2'` no existe", async () => {
        const espia = conFetch(fetchDeFixture());
        await (await precios()).precioMensualAppGateway("Standard_v2", "westus2");
        const urls = consultas(espia);
        expect(urls[0]).toContain("serviceName eq 'Application Gateway'");
        expect(urls[0]).not.toContain("Standard_v2");
    });

    it("una SKU desconocida no se tarifa", async () => {
        conFetch(fetchDeFixture());
        expect(await (await precios()).precioMensualAppGateway("Algo_v9", "westus2")).toBeNull();
    });
});

describe("precioMensualSqlDatabase", () => {
    // La API publica el cómputo por tamaño (`2 vCore`: 0,304434/h = 2 × 0,152217) y SIN licencia
    // de SQL Server. La licencia es un medidor aparte, en `Global`, por vCore (GP 0,099966/h,
    // BC 0,375/h). Lo que pagan las bases que lista `missingAhubSql` (licencia incluida) es la suma.
    const GP2 = mensual(0.304434 + 2 * 0.099966);
    const BC2 = mensual(0.60887 + 2 * 0.375);

    it("GP_Gen5_2 con licencia incluida: cómputo base + licencia × vCores = 368,19", async () => {
        conFetch(fetchDeFixture());
        const precio = await (await precios()).precioMensualSqlDatabase("GP_Gen5_2", "westus2");
        expect(precio).toBeCloseTo(GP2, 4);
        expect(precio).toBeCloseTo(368.19, 2);
    });

    it("BC_Gen5_2 y GP_Gen5_4 escalan por su tamaño y su nivel", async () => {
        conFetch(fetchDeFixture());
        const { precioMensualSqlDatabase } = await precios();
        expect(await precioMensualSqlDatabase("BC_Gen5_2", "westus2")).toBeCloseTo(BC2, 4);
        expect(await precioMensualSqlDatabase("GP_Gen5_4", "westus2")).toBeCloseTo(mensual(0.608868 + 4 * 0.099966), 4);
    });

    it("no es el cómputo solo (222,24): sin la licencia se subestimaría el costo y el ahorro", async () => {
        conFetch(fetchDeFixture());
        const precio = (await (await precios()).precioMensualSqlDatabase("GP_Gen5_2", "westus2"))!;
        expect(precio).toBeGreaterThan(mensual(0.304434) + 100);
    });

    it("no cobra Zone Redundancy: no se sabe si la base lo es, y se informa de menos", async () => {
        conFetch(fetchDeFixture());
        const precio = (await (await precios()).precioMensualSqlDatabase("GP_Gen5_2", "westus2"))!;
        expect(DATOS["SQL Database|westus2|armSkuName|SQLDB_GP_Compute_Gen5_2"].some((i) => i.meterName === "Zone Redundancy vCore")).toBe(true);
        expect(precio).toBeCloseTo(GP2, 4);
    });

    it("pide el cómputo por el armSkuName que publica la API y la licencia a `Global`", async () => {
        const espia = conFetch(fetchDeFixture());
        await (await precios()).precioMensualSqlDatabase("GP_Gen5_2", "westus2");
        const urls = consultas(espia);
        expect(urls.some((u) => u.includes("serviceName eq 'SQL Database'") && u.includes("armRegionName eq 'westus2'") && u.includes("armSkuName eq 'SQLDB_GP_Compute_Gen5_2'"))).toBe(true);
        expect(urls.some((u) => u.includes("armRegionName eq 'Global'") && u.includes("skuName eq 'vCore'"))).toBe(true);
        // `GP_Gen5_2` es el sku.name de ARM: la API no lo conoce ni como skuName ni como armSkuName.
        expect(urls.some((u) => /(skuName|armSkuName) eq 'GP_Gen5_2'/.test(u))).toBe(false);
    });

    it("sin la fila de licencia no devuelve el cómputo solo: null", async () => {
        const f = fetchDeFixture();
        conFetch((async (url: RequestInfo | URL, init?: RequestInit) =>
            decodeURIComponent(String(url)).includes("armRegionName eq 'Global'")
                ? ({ ok: true, status: 200, json: async () => ({ Items: [] }) } as Response)
                : f(url, init)) as typeof fetch);
        expect(await (await precios()).precioMensualSqlDatabase("GP_Gen5_2", "westus2")).toBeNull();
    });

    it("lo que no se mapeó (pools, serverless, Hyperscale, DC, DTU) da null y no pregunta", async () => {
        const espia = conFetch(fetchDeFixture());
        const { precioMensualSqlDatabase } = await precios();
        for (const sku of ["ElasticPool", "GP_S_Gen5_2", "HS_Gen5_2", "GP_DC_2", "BC_DC_2", "S0", "Basic", "", undefined]) {
            expect(await precioMensualSqlDatabase(sku, "westus2")).toBeNull();
        }
        expect(espia).not.toHaveBeenCalled();
    });

    it("un tamaño que la API no publica da null", async () => {
        conFetch(fetchDeFixture());
        expect(await (await precios()).precioMensualSqlDatabase("GP_Gen5_3", "westus2")).toBeNull();
    });
});

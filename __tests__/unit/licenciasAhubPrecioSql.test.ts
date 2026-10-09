// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kqlCatalog } from "@/modules/core/kqlCatalog";
import { fetchDeFixture } from "../helpers/retailFixture";

/**
 * Optimización de licencias: el ahorro de activar Hybrid Benefit en una SQL Database.
 *
 * El servicio le pedía el precio a la Retail API con el `sku.name` de ARM
 * (`GP_Gen5_2`): no existe ni como `skuName` ni como `armSkuName`, la API contesta 200
 * con `Items: []`, el precio daba 0 y TODAS las bases caían al respaldo de 70 USD por
 * vCore: el mismo ahorro para cada base de igual tamaño, sin importar el nivel. Nada
 * fallaba, por eso nadie se enteró.
 *
 * La API publica el cómputo base por tamaño (`SQLDB_GP_Compute_Gen5_2`) y la licencia de
 * SQL Server aparte, en `Global`, por vCore. Las bases de esta lista son las que pagan
 * licencia incluida (`licenseType != BasePrice`): cuestan las dos cosas, y el 30% (GP) o
 * 55% (BC) de Hybrid Benefit se aplica sobre esa suma.
 *
 * Precios del fixture (westus2, USD por hora):
 *   GP Gen5 2 vCore: cómputo 0,304434 + licencia 2 × 0,099966 = 0,504366  → 368,19 al mes
 *   GP Gen5 4 vCore: cómputo 0,608868 + licencia 4 × 0,099966 = 1,008732  → 736,36 al mes
 *   BC Gen5 2 vCore: cómputo 0,60887  + licencia 2 × 0,375    = 1,35887   → 991,98 al mes
 */
const { clienteArg } = vi.hoisted(() => ({ clienteArg: { resources: vi.fn() } }));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({ getToken: async () => ({ token: "token-de-prueba" }) })),
    getResourceGraphClient: vi.fn(async () => clienteArg),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));

const base = (name: string, sku: string, tier: string, capacity: number, elasticPoolId = "") => ({
    id: `/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Sql/servers/srv/databases/${name}`,
    name,
    location: "westus2",
    resourceGroup: "rg",
    subscriptionId: "sub-1",
    sku,
    tier,
    capacity,
    serverId: "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Sql/servers/srv",
    elasticPoolId,
});

const BASES = [
    base("db-gp2", "GP_Gen5_2", "GeneralPurpose", 2),
    base("db-gp2-bis", "GP_Gen5_2", "GeneralPurpose", 2),
    base("db-gp4", "GP_Gen5_4", "GeneralPurpose", 4),
    base("db-bc2", "BC_Gen5_2", "BusinessCritical", 2),
    // Familias que todavía no se mapean: siguen con el respaldo de 70 por vCore.
    base("db-hs2", "HS_Gen5_2", "Hyperscale", 2),
    // En un pool el sku de la base es "ElasticPool": el tamaño real es del pool, no de la base.
    base("db-pool", "ElasticPool", "GeneralPurpose", 0, "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Sql/servers/srv/elasticPools/pool-1"),
];

let fetchEspia: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetModules();
    clienteArg.resources.mockImplementation(async ({ query }: { query: string }) => ({
        data: query === kqlCatalog.missingAhubSql ? BASES : [],
    }));
    const retail = fetchDeFixture();
    fetchEspia = vi.fn(async (url: unknown, init?: unknown) =>
        String(url).startsWith("https://graph.microsoft.com")
            ? ({ ok: true, status: 200, json: async () => ({ value: [] }) } as Response)
            : retail(url as string, init as RequestInit)
    );
    vi.stubGlobal("fetch", fetchEspia);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

async function ahorros() {
    const { getLicenseOptimizationData } = await import("@/services/azureLicenseOptimization.service");
    const r = await getLicenseOptimizationData("tenant-1");
    const de = (nombre: string) => r.ahubResources.find((x) => x.name === nombre)!.estimatedMonthlySavingsUSD;
    return { r, de };
}

describe("getLicenseOptimizationData — ahorro de Hybrid Benefit en SQL Database", () => {
    it("cada base se cotiza por su tamaño y su nivel: licencia incluida × 30% (GP) o 55% (BC)", async () => {
        const { de } = await ahorros();
        expect(de("db-gp2")).toBe(110.46); // 368,19 × 0,30
        expect(de("db-gp2-bis")).toBe(110.46);
        expect(de("db-gp4")).toBe(220.91); // 736,36 × 0,30
        expect(de("db-bc2")).toBe(545.59); // 991,98 × 0,55
    });

    it("ya no es el respaldo de 70 por vCore, que daba 42 a toda base de 2 vCore y 77 a una BC", async () => {
        const { de } = await ahorros();
        expect(de("db-gp2")).not.toBe(42);
        expect(de("db-bc2")).not.toBe(77);
        expect(de("db-gp2")).not.toBe(de("db-gp4"));
    });

    it("lo que todavía no se mapea (Hyperscale, pools) sigue con el respaldo de 70 por vCore", async () => {
        const { de } = await ahorros();
        expect(de("db-hs2")).toBe(42); // 70 × 2 × 0,30
        expect(de("Elastic Pool (1 DBs)")).toBe(42); // capacity 0 → 2 vCores por defecto
    });

    it("el total del resumen suma lo calculado", async () => {
        const { r } = await ahorros();
        expect(r.summary.totalAhubSavingsUSD).toBeCloseTo(110.46 * 2 + 220.91 + 545.59 + 42 + 42, 2);
        expect(r.summary.ahubResourceCount).toBe(6);
    });

    it("consulta la Retail API por armSkuName `SQLDB_GP_Compute_Gen5_2` y la licencia en Global", async () => {
        await ahorros();
        const urls = fetchEspia.mock.calls
            .map((c) => decodeURIComponent(String(c[0])))
            .filter((u) => u.startsWith("https://prices.azure.com"));
        expect(urls.some((u) => u.includes("armSkuName eq 'SQLDB_GP_Compute_Gen5_2'"))).toBe(true);
        expect(urls.some((u) => u.includes("armSkuName eq 'SQLDB_BC_Compute_Gen5_2'"))).toBe(true);
        expect(urls.some((u) => u.includes("armRegionName eq 'Global'") && u.includes("skuName eq 'vCore'"))).toBe(true);
        // El sku.name de ARM no existe en la API.
        expect(urls.some((u) => /(skuName|armSkuName) eq 'GP_Gen5_2'/.test(u))).toBe(false);
    });

    it("la licencia es de toda la región: se pide una vez y cada tamaño una vez, no una por base", async () => {
        await ahorros();
        const urls = fetchEspia.mock.calls
            .map((c) => decodeURIComponent(String(c[0])))
            .filter((u) => u.startsWith("https://prices.azure.com"));
        // GP_2, GP_4 y BC_2 más la licencia: cuatro consultas para seis bases.
        expect(urls).toHaveLength(4);
    });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kqlCatalog } from "@/modules/core/kqlCatalog";
import { fetchDeFixture } from "../helpers/retailFixture";

/**
 * Fugas financieras: lo que se ahorraría borrando un disco administrado sin asociar.
 *
 * El servicio le pedía el precio a la Retail API con el `sku.name` de ARM
 * (`Premium_LRS`): la API publica los discos por tier y tamaño (`P6 LRS`), contesta 200
 * con `Items: []`, el precio daba 0 y SIEMPRE valía el respaldo de tamaño × 0,15. Un
 * Standard HDD de 128 GB aparecía a 19,20 y cuesta 5,89.
 *
 * Precios del fixture (westus2, USD por mes): P6 LRS 9,2801 · E10 LRS 9,60 · S10 LRS 5,888.
 */
const { clienteArg } = vi.hoisted(() => ({ clienteArg: { resources: vi.fn() } }));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getResourceGraphClient: vi.fn(async () => clienteArg),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));
vi.mock("@/lib/azureSubscriptionNames", () => ({
    getSubscriptionNameMap: vi.fn(async () => new Map()),
    resolveSubscriptionName: (id: string) => id,
}));
vi.mock("@/lib/argConcurrency", () => ({ withArgLimit: (f: () => unknown) => f() }));
vi.mock("@/modules/storage/recommendationExemptions", () => ({ getExemptionsForTenant: vi.fn(async () => []) }));

const TENANT = "5b2c7c1e-0000-4000-8000-000000000001";
const disco = (name: string, sku: string, diskSizeGB: number) => ({
    id: `/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/disks/${name}`,
    name,
    location: "westus2",
    resourceGroup: "rg",
    subscriptionId: "sub-1",
    sku,
    diskSizeGB,
});

const DISCOS = [
    disco("p6", "Premium_LRS", 64),
    disco("e10", "StandardSSD_LRS", 128),
    disco("s10", "Standard_LRS", 128),
    // Ultra se cobra por GiB/IOPS aprovisionados: no hay tier, sigue en el respaldo.
    disco("ultra", "UltraSSD_LRS", 100),
];

let fetchEspia: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetModules();
    clienteArg.resources.mockImplementation(async ({ query }: { query: string }) => ({
        data: query === kqlCatalog.unattachedDisks ? DISCOS : [],
    }));
    fetchEspia = vi.fn(fetchDeFixture());
    vi.stubGlobal("fetch", fetchEspia);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

async function ahorros() {
    const { AzureZombieHuntingService } = await import("@/services/azureZombieHunting.service");
    const r = await AzureZombieHuntingService.getFinancialLeaksSummary(TENANT);
    const de = (nombre: string) => r.resources.find((x) => x.name === nombre)!.estimatedMonthlySavingsUSD;
    return { r, de };
}

describe("AzureZombieHuntingService — discos administrados sin asociar", () => {
    it("cada disco se cotiza por su tier, no por tamaño × 0,15", async () => {
        const { de } = await ahorros();
        expect(de("p6")).toBe(9.28);
        expect(de("e10")).toBe(9.6);
        expect(de("s10")).toBe(5.89);
        // El comportamiento viejo: 64 × 0,15 = 9,60 y 128 × 0,15 = 19,20 para todo lo de 128 GB.
        expect(de("s10")).not.toBe(19.2);
        expect(de("e10")).not.toBe(19.2);
    });

    it("un disco sin tier (Ultra) sigue con el respaldo de tamaño × 0,15", async () => {
        const { de } = await ahorros();
        expect(de("ultra")).toBe(15);
    });

    it("el total del resumen suma lo calculado", async () => {
        const { r } = await ahorros();
        expect(r.totalMonthlyLeakUSD).toBeCloseTo(9.28 + 9.6 + 5.89 + 15, 2);
    });

    it("pide a la API el tier (`skuName eq 'P6 LRS'`) y nunca el nombre de ARM", async () => {
        await ahorros();
        const urls = fetchEspia.mock.calls
            .map((c) => decodeURIComponent(String(c[0])))
            .filter((u) => u.startsWith("https://prices.azure.com"));
        expect(urls.some((u) => u.includes("serviceName eq 'Storage'") && u.includes("skuName eq 'P6 LRS'"))).toBe(true);
        expect(urls.some((u) => /_(LRS|ZRS)'/.test(u))).toBe(false);
    });
});

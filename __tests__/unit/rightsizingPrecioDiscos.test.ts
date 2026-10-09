// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { fetchDeFixture } from "../helpers/retailFixture";

/**
 * Rightsizing: el costo oculto de una VM desasignada es el de los discos que conserva.
 *
 * La ruta le pedía el precio de cada disco a la Retail API con el `sku.name` de ARM
 * (`Premium_LRS`): la API publica los discos por tier y tamaño (`P6 LRS`), así que
 * contesta 200 con `Items: []`, el precio daba 0 y SIEMPRE valía el respaldo de
 * tamaño × 0,15. Un Standard HDD de 128 GB se mostraba a 19,20 cuando cuesta 5,89.
 *
 * Precios del fixture (westus2, USD por mes): P6 LRS 9,2801 · E10 LRS 9,60 ·
 * S10 LRS 5,888 · P10 LRS 17,92.
 */
const { clienteArg } = vi.hoisted(() => ({ clienteArg: { resources: vi.fn() } }));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getResourceGraphClient: vi.fn(async () => clienteArg),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));
vi.mock("@/modules/collectors/azure/metricsService", () => ({ getVmUtilization: vi.fn() }));
vi.mock("@/modules/core/rightsizingEngine", () => ({ analyzeVmEfficiency: vi.fn() }));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantRole: vi.fn(async () => undefined),
    AuthError: class extends Error {
        status = 403;
    },
}));
vi.mock("@/lib/cache", () => ({ getWithStaleWhileRevalidate: async (_clave: string, f: () => unknown) => f() }));
vi.mock("@/lib/argConcurrency", () => ({ withArgLimit: (f: () => unknown) => f() }));
vi.mock("@/modules/storage/recommendationExemptions", () => ({ getExemptionsForTenant: vi.fn(async () => []) }));

const TENANT = "5b2c7c1e-0000-4000-8000-000000000001";
const idDisco = (n: string) => `/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/disks/${n}`;
const disco = (n: string, sku: string, diskSizeGB: number) => ({ id: idDisco(n).toLowerCase(), diskSizeGB, sku, location: "westus2" });
const vmDetenida = (name: string, os: string, datos: string[] = []) => ({
    id: `/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/${name}`,
    name,
    location: "westus2",
    resourceGroup: "rg",
    subscriptionId: "sub-1",
    sku: "Standard_D2s_v3",
    osDiskId: idDisco(os),
    dataDisks: datos.map((d) => ({ managedDisk: { id: idDisco(d) } })),
});

const DISCOS = [
    disco("os-p6", "Premium_LRS", 64),
    disco("datos-e10", "StandardSSD_LRS", 128),
    disco("os-s10", "Standard_LRS", 128),
    disco("datos-p10", "Premium_LRS", 128),
    // Ultra se cobra por GiB/IOPS aprovisionados: no hay tier, sigue en el respaldo.
    disco("datos-ultra", "UltraSSD_LRS", 100),
];
const VMS_DETENIDAS = [
    vmDetenida("vm-a", "os-p6", ["datos-e10"]),
    vmDetenida("vm-b", "os-s10", ["datos-p10"]),
    vmDetenida("vm-c", "os-p6", ["datos-ultra"]),
];

let fetchEspia: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetModules();
    // La ruta espera 1 s entre una consulta de Resource Graph y la siguiente.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    clienteArg.resources.mockImplementation(async ({ query }: { query: string }) => ({
        data: /deallocated/.test(query) ? VMS_DETENIDAS : /microsoft\.compute\/disks/.test(query) ? DISCOS : [],
    }));
    fetchEspia = vi.fn(fetchDeFixture());
    vi.stubGlobal("fetch", fetchEspia);
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function costosOcultos() {
    const { GET } = await import("@/app/api/intelligence/rightsizing/route");
    const pendiente = GET(
        new NextRequest("http://localhost/api/intelligence/rightsizing", {
            headers: { "x-tenant-id": TENANT, "x-subscription-id": "all" },
        })
    );
    await vi.runAllTimersAsync();
    const r = await pendiente;
    expect(r.status).toBe(200);
    const { data } = await r.json();
    return (nombre: string) => data.find((v: any) => v.name === nombre).hiddenCost as number;
}

describe("GET /api/intelligence/rightsizing — costo oculto de una VM desasignada", () => {
    it("suma lo que cuesta cada disco por su tier, no tamaño × 0,15", async () => {
        const de = await costosOcultos();
        expect(de("vm-a")).toBe(18.88); // P6 9,2801 + E10 9,60
        expect(de("vm-b")).toBe(23.81); // S10 5,888 + P10 17,92
        // El comportamiento viejo: 64 × 0,15 + 128 × 0,15 = 28,80 y 38,40.
        expect(de("vm-a")).not.toBe(28.8);
        expect(de("vm-b")).not.toBe(38.4);
    });

    it("un disco sin tier (Ultra) sigue con el respaldo de tamaño × 0,15 y el resto se cotiza", async () => {
        const de = await costosOcultos();
        expect(de("vm-c")).toBe(24.28); // P6 9,2801 + Ultra 100 × 0,15
    });

    it("pide a la API el tier (`skuName eq 'P6 LRS'`) y nunca el nombre de ARM", async () => {
        await costosOcultos();
        const urls = fetchEspia.mock.calls
            .map((c) => decodeURIComponent(String(c[0])))
            .filter((u) => u.startsWith("https://prices.azure.com"));
        expect(urls.some((u) => u.includes("serviceName eq 'Storage'") && u.includes("skuName eq 'P6 LRS'"))).toBe(true);
        expect(urls.some((u) => /_(LRS|ZRS)'/.test(u))).toBe(false);
    });
});

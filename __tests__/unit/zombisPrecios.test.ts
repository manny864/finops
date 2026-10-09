// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { conOrdenInvertido, fetchDeFixture } from "../helpers/retailFixture";

/**
 * Zombis: lo que se ahorraría borrando cada recurso huérfano de /api/cleanup/zombies.
 *
 * La ruta le pedía los precios a la Retail API con el identificador de ARM (`Premium_LRS`,
 * `Standard`, `App Service`...), que la API no conoce: contesta 200 con `Items: []`, el
 * helper lo vuelve 0 y cada recurso cae a su respaldo fijo. Nada falla y nadie se entera.
 *
 * Precios del fixture (westus2, USD por mes salvo que se diga): P6 LRS 9,2801 ·
 * E10 LRS 9,60 · S10 LRS 5,888 · P10 LRS 17,92 · IP Standard 0,005/h · IP Basic estática 0,0036/h.
 */
const { clienteArg, graph } = vi.hoisted(() => ({
    clienteArg: { resources: vi.fn() },
    graph: { resultados: {} as Record<string, unknown[]>, discos: [] as unknown[] },
}));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getResourceGraphClient: vi.fn(async () => clienteArg),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));
vi.mock("@/services/auditService", () => ({ runGraphAudits: vi.fn(async () => graph.resultados) }));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => undefined),
    requireTenantRole: vi.fn(async () => undefined),
    AuthError: class extends Error {
        status = 403;
    },
}));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirSuscripcionDelTenant: vi.fn(async () => undefined) }));
vi.mock("@/lib/cache", () => ({
    getWithStaleWhileRevalidate: async (_clave: string, f: () => unknown) => f(),
    invalidateCache: vi.fn(),
}));
vi.mock("@/lib/azureSubscriptionNames", () => ({
    getSubscriptionNameMap: vi.fn(async () => new Map()),
    resolveSubscriptionName: (id: string) => id,
}));
vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn(async () => [[]]) },
    initializeDatabase: vi.fn(async () => undefined),
}));
// Lo que arma el resumen no importa acá: se devuelven las filas tal como las calculó la ruta.
vi.mock("@/services/azureZombieAudit.service", () => ({
    getMockZombieAuditPayload: vi.fn(),
    assembleLiveZombieAudit: ({ rawItems }: { rawItems: unknown[] }) => ({ metrics: { resources: rawItems }, lastUpdated: "ahora" }),
    getZombieExemptions: vi.fn(async () => []),
    getLocalTagsCache: vi.fn(async () => ({})),
    saveZombieExemption: vi.fn(),
    deleteZombieExemption: vi.fn(),
    saveLocalResourceTags: vi.fn(),
}));

const TENANT = "5b2c7c1e-0000-4000-8000-000000000001";
const rid = (tipo: string, nombre: string) => `/subscriptions/sub-1/resourceGroups/rg/providers/${tipo}/${nombre}`;
const base = (tipo: string, name: string, extra: Record<string, unknown> = {}) => ({
    id: rid(tipo, name),
    name,
    location: "westus2",
    resourceGroup: "rg",
    subscriptionId: "sub-1",
    ...extra,
});

let fetchEspia: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetModules();
    graph.resultados = {};
    graph.discos = [];
    // La consulta de discos de la ruta (para las VMs detenidas) es la única que llega a ARG.
    clienteArg.resources.mockImplementation(async () => ({ data: graph.discos }));
    fetchEspia = vi.fn(fetchDeFixture());
    vi.stubGlobal("fetch", fetchEspia);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

async function costos() {
    const { GET } = await import("@/app/api/cleanup/zombies/route");
    const r = await GET(new NextRequest(`http://localhost/api/cleanup/zombies?tenantId=${TENANT}`));
    expect(r.status).toBe(200);
    const { data } = await r.json();
    return (nombre: string) => data.find((z: any) => z.name === nombre).monthlyCost as number;
}
const urlsDePrecios = () =>
    fetchEspia.mock.calls.map((c) => decodeURIComponent(String(c[0]))).filter((u) => u.startsWith("https://prices.azure.com"));

describe("GET /api/cleanup/zombies — discos sin asociar", () => {
    const disco = (name: string, sku: string, diskSizeGB: number) =>
        base("Microsoft.Compute/disks", name, { sku, diskSizeGB });

    beforeEach(() => {
        graph.resultados = {
            unattachedDisks: [
                disco("p6", "Premium_LRS", 64),
                disco("e10", "StandardSSD_LRS", 128),
                disco("s10", "Standard_LRS", 128),
                // Ultra se cobra por GiB/IOPS aprovisionados: no hay tier, sigue en el respaldo.
                disco("ultra", "UltraSSD_LRS", 100),
            ],
        };
    });

    it("cada disco se cotiza por su tier, no por tamaño × 0,15", async () => {
        const de = await costos();
        expect(de("p6")).toBeCloseTo(9.2801, 4);
        expect(de("e10")).toBeCloseTo(9.6, 4);
        expect(de("s10")).toBeCloseTo(5.888, 4);
        // El comportamiento viejo: 64 × 0,15 = 9,60 y 128 × 0,15 = 19,20 para todo lo de 128 GB.
        expect(de("s10")).not.toBeCloseTo(19.2, 2);
        expect(de("e10")).not.toBeCloseTo(19.2, 2);
    });

    it("un disco sin tier (Ultra) sigue con el respaldo de tamaño × 0,15", async () => {
        const de = await costos();
        expect(de("ultra")).toBeCloseTo(15, 4);
    });

    it("pide a la API el tier (`skuName eq 'P6 LRS'`) y nunca el nombre de ARM", async () => {
        await costos();
        const urls = urlsDePrecios();
        expect(urls.some((u) => u.includes("serviceName eq 'Storage'") && u.includes("skuName eq 'P6 LRS'"))).toBe(true);
        expect(urls.some((u) => /_(LRS|ZRS)'/.test(u))).toBe(false);
    });
});

describe("GET /api/cleanup/zombies — VMs detenidas: el costo de los discos que conservan", () => {
    const idDisco = (n: string) => rid("Microsoft.Compute/disks", n);
    // La ruta los lee de Resource Graph con el id en minúsculas.
    const discoArg = (n: string, sku: string, diskSizeGB: number) => ({ id: idDisco(n).toLowerCase(), diskSizeGB, sku, location: "westus2" });
    const vmDetenida = (name: string, os: string, datos: string[] = []) =>
        base("Microsoft.Compute/virtualMachines", name, {
            sku: "Standard_D2s_v3",
            osDiskId: idDisco(os),
            dataDisks: datos.map((d) => ({ managedDisk: { id: idDisco(d) } })),
        });

    beforeEach(() => {
        graph.discos = [
            discoArg("os-p6", "Premium_LRS", 64),
            discoArg("datos-e10", "StandardSSD_LRS", 128),
            discoArg("os-s10", "Standard_LRS", 128),
            discoArg("datos-p10", "Premium_LRS", 128),
            discoArg("datos-ultra", "UltraSSD_LRS", 100),
        ];
        graph.resultados = {
            longStoppedVMs: [
                vmDetenida("vm-a", "os-p6", ["datos-e10"]),
                vmDetenida("vm-b", "os-s10", ["datos-p10"]),
                vmDetenida("vm-c", "os-p6", ["datos-ultra"]),
            ],
        };
    });

    it("suma lo que cuesta cada disco por su tier, no tamaño × 0,15", async () => {
        const de = await costos();
        expect(de("vm-a")).toBe(18.88); // P6 9,2801 + E10 9,60
        expect(de("vm-b")).toBe(23.81); // S10 5,888 + P10 17,92
        // El comportamiento viejo: 64 × 0,15 + 128 × 0,15 = 28,80 y 38,40.
        expect(de("vm-a")).not.toBe(28.8);
        expect(de("vm-b")).not.toBe(38.4);
    });

    it("un disco sin tier (Ultra) sigue con el respaldo y el resto se cotiza", async () => {
        const de = await costos();
        expect(de("vm-c")).toBe(24.28); // P6 9,2801 + Ultra 100 × 0,15
    });
});

describe("GET /api/cleanup/zombies — IPs públicas sin asociar", () => {
    const ip = (name: string, sku: string) => base("Microsoft.Network/publicIPAddresses", name, { sku });

    beforeEach(() => {
        graph.resultados = {
            unattachedPublicIps: [ip("ip-std", "Standard"), ip("ip-basic", "Basic"), ip("ip-rara", "StandardV2")],
        };
    });

    it("una Standard cuesta lo que la IP (3,65) aunque la API devuelva primero el Public IP Prefix (4,38)", async () => {
        // `skuName eq 'Standard'` trae la IP (0,005/h) y el Public IP Prefix (0,006/h): el helper
        // viejo se quedaba con la primera fila, o sea que el número dependía del orden de la API.
        fetchEspia = vi.fn(conOrdenInvertido(fetchDeFixture()));
        vi.stubGlobal("fetch", fetchEspia);
        const de = await costos();
        expect(de("ip-std")).toBeCloseTo(0.005 * 730, 4);
        expect(de("ip-std")).not.toBeCloseTo(0.006 * 730, 2);
    });

    it("una Basic se cotiza estática (2,63): ARM no dice la asignación y se informa de menos", async () => {
        const de = await costos();
        expect(de("ip-basic")).toBeCloseTo(0.0036 * 730, 4);
        // La primera fila de la API es la dinámica (0,004/h = 2,92): el helper viejo la tomaba.
        expect(de("ip-basic")).not.toBeCloseTo(0.004 * 730, 2);
    });

    it("una SKU que no se tarifa sigue con el respaldo de 3,50", async () => {
        const de = await costos();
        expect(de("ip-rara")).toBe(3.5);
    });

    it("consulta `Virtual Network` por la SKU de la IP", async () => {
        await costos();
        expect(urlsDePrecios().some((u) => u.includes("serviceName eq 'Virtual Network'") && u.includes("skuName eq 'Standard'"))).toBe(true);
    });
});

describe("GET /api/cleanup/zombies — planes de App Service vacíos", () => {
    // `reserved` es el `properties.reserved` que ahora proyecta `emptyAppServicePlans`: "true" es Linux.
    const plan = (name: string, sku: string, reserved: string) => base("Microsoft.Web/serverfarms", name, { sku, reserved });

    beforeEach(() => {
        graph.resultados = {
            emptyAppServicePlans: [
                plan("s1-linux", "S1", "true"),
                plan("s1-windows", "S1", "false"),
                plan("p1v3-linux", "P1v3", "true"),
                // Consumo (Y1): no hay precio fijo, sigue en la tabla de respaldo.
                plan("y1", "Y1", "false"),
            ],
        };
    });

    it("cada plan se cotiza por su SKU y su sistema operativo, no por la tabla fija de 150/75/55", async () => {
        const de = await costos();
        expect(de("s1-linux")).toBeCloseTo(0.08 * 730, 4);
        expect(de("s1-windows")).toBeCloseTo(0.1 * 730, 4);
        expect(de("p1v3-linux")).toBeCloseTo(0.155 * 730, 4);
        // El comportamiento viejo: toda S valía 75 y toda P 150.
        expect(de("s1-linux")).not.toBe(75);
        expect(de("p1v3-linux")).not.toBe(150);
    });

    it("el mismo S1 cuesta distinto en Linux y en Windows", async () => {
        const de = await costos();
        expect(de("s1-windows")).toBeGreaterThan(de("s1-linux"));
    });

    it("un plan sin precio fijo (Y1) sigue con la tabla de respaldo: 45", async () => {
        const de = await costos();
        expect(de("y1")).toBe(45);
    });

    it("el servicio se llama `Azure App Service` en la API: con `App Service` contesta Items: []", async () => {
        await costos();
        const urls = urlsDePrecios();
        expect(urls.some((u) => u.includes("serviceName eq 'Azure App Service'") && u.includes("armRegionName eq 'westus2'"))).toBe(true);
        expect(urls.some((u) => u.includes("serviceName eq 'App Service'"))).toBe(false);
    });
});

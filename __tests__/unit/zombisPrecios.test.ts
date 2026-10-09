// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { fetchDeFixture } from "../helpers/retailFixture";

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

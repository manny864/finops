// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { fetchDeFixture } from "../helpers/retailFixture";

/**
 * Auditoría completa: el costo estimado de cada recurso huérfano de /api/audit/full.
 *
 * La ruta le pedía los precios a la Retail API con el identificador de ARM (`Premium_LRS`,
 * `Standard`, `App Service`...), que la API no conoce: contesta 200 con `Items: []` y el helper
 * lo vuelve 0. A diferencia de /api/cleanup/zombies, acá los discos y las IP NO tienen respaldo:
 * el costo que veía el usuario era 0.
 *
 * Precios del fixture (westus2, USD por mes salvo que se diga): P6 LRS 9,2801 ·
 * E10 LRS 9,60 · S10 LRS 5,888 · P10 LRS 17,92 · IP Standard 0,005/h · IP Basic estática 0,0036/h.
 */
const { clienteArg, graph } = vi.hoisted(() => ({
    clienteArg: { resources: vi.fn() },
    graph: { resultados: {} as Record<string, any[]>, discos: [] as unknown[] },
}));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getResourceGraphClient: vi.fn(async () => clienteArg),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));
vi.mock("@/services/auditService", () => ({ runGraphAudits: vi.fn(async () => graph.resultados) }));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => undefined),
    AuthError: class extends Error {
        status = 403;
    },
}));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirSuscripcionDelTenant: vi.fn(async () => undefined) }));
vi.mock("@/lib/cache", () => ({ getWithStaleWhileRevalidate: async (_clave: string, f: () => unknown) => f() }));
vi.mock("@/lib/argConcurrency", () => ({ withArgLimit: (f: () => unknown) => f() }));
vi.mock("@/modules/storage/recommendationExemptions", () => ({ getExemptionsForTenant: vi.fn(async () => []) }));

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

/** Lo que devuelve la ruta para un chequeo: `(nombre) => estimatedMonthlyCost`. */
async function costos(chequeo: string) {
    const { GET } = await import("@/app/api/audit/full/route");
    const r = await GET(new NextRequest(`http://localhost/api/audit/full?tenantId=${TENANT}`));
    expect(r.status).toBe(200);
    const { auditResults } = await r.json();
    return (nombre: string) => auditResults[chequeo].find((x: any) => x.name === nombre).estimatedMonthlyCost as number;
}
const urlsDePrecios = () =>
    fetchEspia.mock.calls.map((c) => decodeURIComponent(String(c[0]))).filter((u) => u.startsWith("https://prices.azure.com"));

describe("GET /api/audit/full — discos sin asociar", () => {
    const disco = (name: string, sku: string, diskSizeGB: number) => base("Microsoft.Compute/disks", name, { sku, diskSizeGB });

    beforeEach(() => {
        graph.resultados = {
            unattachedDisks: [
                disco("p6", "Premium_LRS", 64),
                disco("e10", "StandardSSD_LRS", 128),
                disco("s10", "Standard_LRS", 128),
                // Ultra se cobra por GiB/IOPS aprovisionados: no hay tier, y acá no hay respaldo.
                disco("ultra", "UltraSSD_LRS", 100),
            ],
        };
    });

    it("cada disco se cotiza por su tier: antes TODOS salían en 0", async () => {
        const de = await costos("unattachedDisks");
        expect(de("p6")).toBeCloseTo(9.2801, 4);
        expect(de("e10")).toBeCloseTo(9.6, 4);
        expect(de("s10")).toBeCloseTo(5.888, 4);
        expect(de("p6")).not.toBe(0);
    });

    it("un disco sin tier (Ultra) sigue en 0: esta ruta no tiene respaldo", async () => {
        const de = await costos("unattachedDisks");
        expect(de("ultra")).toBe(0);
    });

    it("pide a la API el tier (`skuName eq 'P6 LRS'`) y nunca el nombre de ARM", async () => {
        await costos("unattachedDisks");
        const urls = urlsDePrecios();
        expect(urls.some((u) => u.includes("serviceName eq 'Storage'") && u.includes("skuName eq 'P6 LRS'"))).toBe(true);
        expect(urls.some((u) => /_(LRS|ZRS)'/.test(u))).toBe(false);
    });
});

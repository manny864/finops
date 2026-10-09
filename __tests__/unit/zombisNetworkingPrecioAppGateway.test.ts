// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { fetchDeFixture } from "../helpers/retailFixture";

/**
 * Zombis de red: lo que se ahorraría borrando un Application Gateway sin backends.
 *
 * La ruta le pedía el precio a la Retail API con `skuName eq 'Standard_v2'` (el
 * `sku.name` de ARM): no existe, la API contesta 200 con `Items: []`, el precio daba 0 y
 * SIEMPRE valía el respaldo de 125, fuera cual fuera la SKU. Un WAF_v2 se mostraba a
 * 125 cuando cuesta más del doble. Nada fallaba, por eso nadie se enteró.
 *
 * La API publica el costo fijo del gateway bajo el servicio `Application Gateway`, por
 * producto (`Application Gateway Standard v2`, `... WAF v2`) y no por skuName.
 *
 * Precios del fixture (westus2, USD por hora): Standard_v2 0,20 · WAF_v2 0,36 ·
 * Standard_Medium (v1) 0,07.
 */
const { graph } = vi.hoisted(() => ({ graph: { resultados: {} as Record<string, unknown[]> } }));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(async () => undefined),
    requireTenantRole: vi.fn(async () => undefined),
    AuthError: class extends Error {
        status = 403;
    },
}));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirSuscripcionDelTenant: vi.fn(async () => undefined) }));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getResourceGraphClient: vi.fn(async () => ({})),
}));
vi.mock("@/services/auditService", () => ({ runGraphAudits: vi.fn(async () => graph.resultados) }));
vi.mock("@/lib/cache", () => ({
    getWithStaleWhileRevalidate: async (_clave: string, f: () => unknown) => f(),
    invalidateCache: vi.fn(),
}));
vi.mock("@/modules/storage/recommendationExemptions", () => ({
    getExemptionsForTenant: vi.fn(async () => []),
    upsertExemption: vi.fn(),
    deleteExemption: vi.fn(),
}));
vi.mock("@/lib/azureSubscriptionNames", () => ({
    getSubscriptionNameMap: vi.fn(async () => new Map()),
    resolveSubscriptionName: (id: string) => id,
}));

const TENANT = "5b2c7c1e-0000-4000-8000-000000000001";

const gateway = (name: string, sku: string) => ({
    id: `/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Network/applicationGateways/${name}`,
    name,
    location: "westus2",
    resourceGroup: "rg",
    subscriptionId: "sub-1",
    sku,
    tier: sku,
});

let fetchEspia: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetModules();
    graph.resultados = {
        unusedAppGateways: [
            gateway("agw-std", "Standard_v2"),
            gateway("agw-waf", "WAF_v2"),
            gateway("agw-v1", "Standard_Medium"),
            // Una SKU que la API no publica: tiene que seguir cayendo al respaldo.
            gateway("agw-rara", "Algo_v9"),
        ],
    };
    fetchEspia = vi.fn(fetchDeFixture());
    vi.stubGlobal("fetch", fetchEspia);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

async function costos() {
    const { GET } = await import("@/app/api/cleanup/zombies/networking/route");
    const r = await GET(new NextRequest(`http://localhost/api/cleanup/zombies/networking?tenantId=${TENANT}`));
    expect(r.status).toBe(200);
    const { items } = await r.json();
    return (nombre: string) => items.find((i: any) => i.resourceName === nombre).monthlyCost as number;
}

describe("GET /api/cleanup/zombies/networking — Application Gateway sin backends", () => {
    it("cada gateway se cotiza por su SKU: Standard_v2 146,00 y WAF_v2 262,80, no el 125 de respaldo", async () => {
        const de = await costos();
        expect(de("agw-std")).toBeCloseTo(0.2 * 730, 2);
        expect(de("agw-waf")).toBeCloseTo(0.36 * 730, 2);
        expect(de("agw-std")).not.toBe(125);
        expect(de("agw-waf")).toBeGreaterThan(de("agw-std"));
    });

    it("un v1 sale de su propio producto: Standard_Medium 51,10", async () => {
        const de = await costos();
        expect(de("agw-v1")).toBeCloseTo(0.07 * 730, 2);
    });

    it("una SKU que la API no publica sigue cayendo al respaldo de 125", async () => {
        const de = await costos();
        expect(de("agw-rara")).toBe(125);
    });

    it("consulta el servicio `Application Gateway` por región y no filtra por `skuName eq 'Standard_v2'`", async () => {
        await costos();
        const urls = fetchEspia.mock.calls
            .map((c) => decodeURIComponent(String(c[0])))
            .filter((u) => u.startsWith("https://prices.azure.com"));
        expect(urls.some((u) => u.includes("serviceName eq 'Application Gateway'") && u.includes("armRegionName eq 'westus2'"))).toBe(true);
        expect(urls.some((u) => /skuName eq '(Standard_v2|WAF_v2|Standard_Medium)'/.test(u))).toBe(false);
    });
});

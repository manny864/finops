// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kqlCatalog } from "@/modules/core/kqlCatalog";
import { fetchDeFixture } from "../helpers/retailFixture";

/**
 * Optimización de licencias: el ahorro de activar Hybrid Benefit en una VM.
 *
 * El servicio le pedía el precio a la Retail API con un `armSkuName`
 * (`Standard_D2s_v3`, el `vmSize` de ARM) pero sin decir que lo era, así que
 * filtraba por `skuName eq 'Standard_D2s_v3'`: ese nombre no existe, la API
 * contesta 200 con `Items: []` y el precio daba 0. Resultado: TODAS las VMs caían
 * al respaldo de 150 y mostraban el mismo ahorro de 60 USD, fuera cual fuera el
 * tamaño. Nada fallaba, por eso nadie se enteró.
 *
 * Las VMs de esta lista salen de `missingAhubWindowsVMs`: son Windows, y el ahorro
 * es el 40% del cómputo Windows, o sea del medidor con la licencia incluida.
 *
 * Precios del fixture capturado el 2026-10-08 (westus2, USD por hora):
 *   D2s_v3  Linux 0,096 · Windows 0,188      D4s_v3  Linux 0,192 · Windows 0,376
 */
const { clienteArg } = vi.hoisted(() => ({ clienteArg: { resources: vi.fn() } }));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({ getToken: async () => ({ token: "token-de-prueba" }) })),
    getResourceGraphClient: vi.fn(async () => clienteArg),
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
}));

const vm = (name: string, sku: string) => ({
    id: `/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/${name}`,
    name,
    location: "westus2",
    resourceGroup: "rg",
    subscriptionId: "sub-1",
    sku,
});

const VMS = [
    vm("vm-d2", "Standard_D2s_v3"),
    vm("vm-d2-bis", "Standard_D2s_v3"),
    vm("vm-d4", "Standard_D4s_v3"),
    // Un tamaño que la API no publica: tiene que seguir cayendo al respaldo.
    vm("vm-sin-precio", "Standard_Inexistente"),
];

let fetchEspia: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetModules();
    clienteArg.resources.mockImplementation(async ({ query }: { query: string }) => ({
        data: query === kqlCatalog.missingAhubWindowsVMs ? VMS : [],
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

describe("getLicenseOptimizationData — ahorro de Hybrid Benefit en VMs Windows", () => {
    it("cada VM se cotiza por su tamaño: 40% del Windows a demanda, no el respaldo de 150", async () => {
        const { de } = await ahorros();
        expect(de("vm-d2")).toBe(54.9); // 0,188 × 730 × 0,4
        expect(de("vm-d2-bis")).toBe(54.9);
        expect(de("vm-d4")).toBe(109.79); // 0,376 × 730 × 0,4
        // El comportamiento viejo: el mismo 60 para todas.
        expect(de("vm-d2")).not.toBe(60);
        expect(de("vm-d2")).not.toBe(de("vm-d4"));
    });

    it("una VM sin precio en la API sigue cayendo al respaldo de 150", async () => {
        const { de } = await ahorros();
        expect(de("vm-sin-precio")).toBe(60); // 150 × 0,4
    });

    it("el total del resumen suma lo calculado", async () => {
        const { r } = await ahorros();
        expect(r.summary.totalAhubSavingsUSD).toBeCloseTo(54.9 + 54.9 + 109.79 + 60, 2);
        expect(r.summary.ahubResourceCount).toBe(4);
    });

    it("consulta la Retail API por armSkuName y no por skuName", async () => {
        await ahorros();
        const urls = fetchEspia.mock.calls
            .map((c) => decodeURIComponent(String(c[0])))
            .filter((u) => u.startsWith("https://prices.azure.com"));
        expect(urls.some((u) => u.includes("armSkuName eq 'Standard_D2s_v3'"))).toBe(true);
        expect(urls.some((u) => / skuName eq 'Standard_D2s_v3'/.test(u))).toBe(false);
    });
});

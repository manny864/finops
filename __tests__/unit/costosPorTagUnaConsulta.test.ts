// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `getLiveResourcesCostsByTag`: cuando Cost Management devuelve 0 para una clave de tag, cae a sumar
 * desde `CostSnapshots`. Esa consulta (`SELECT Tags, SUM(..) ... GROUP BY Tags`, sobre un JSON de todo
 * el historial del tenant) NO depende de la clave, pero corría una vez por CADA clave: con 10 claves
 * eran 10 GROUP BY idénticos. Ahora corre una vez por request y cada clave filtra en memoria.
 */
const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: poolQuery } }));
vi.mock("@/lib/azure", () => ({
    getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]),
    getAzureCredential: vi.fn(async () => ({})),
    getCostManagementClient: async () => {
        const { CostManagementClient } = await import("@azure/arm-costmanagement");
        return new CostManagementClient({ getToken: async () => null });
    },
    getResourceGraphClient: vi.fn(async () => ({
        resources: vi.fn(async ({ query }: { query: string }) => ({
            data: /bag_keys/.test(query)
                ? [{ key: "CostCenter" }, { key: "Environment" }, { key: "Owner" }]
                : [{ val: "x", c: 2 }],
        })),
    })),
}));
vi.mock("@azure/arm-costmanagement", () => ({
    // Cost Management "no tiene costo" para ninguna clave: dispara el fallback a MySQL.
    CostManagementClient: class { query = { usage: vi.fn(async () => ({ columns: [], rows: [] })) }; },
}));
vi.mock("@/lib/azureCostColumn", () => ({
    resolveCostColumn: async () => "CostUSD",
    isCostUsdUnsupportedError: () => false,
    degradeCostColumn: async () => {},
}));
vi.mock("@/modules/collectors/azure/billing/billingHelpers", () => ({
    withRetry: (fn: () => Promise<unknown>) => fn(),
    mapWithConcurrency: async (items: unknown[], _limite: number, fn: (x: any, i: number) => Promise<unknown>) =>
        Promise.all(items.map((x, i) => fn(x, i))),
}));

import { getLiveResourcesCostsByTag } from "@/services/azureResourcesInventory.service";

const FILAS = [
    { Tags: JSON.stringify({ CostCenter: "x", Environment: "x" }), cost: 10 },
    { Tags: JSON.stringify({ CostCenter: "x" }), cost: 5 },
];
const esFallback = (sql: unknown) => /FROM CostSnapshots/.test(String(sql));

beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => (esFallback(sql) ? [FILAS, []] : [[], []]));
});

describe("getLiveResourcesCostsByTag: el fallback a MySQL corre una vez por request", () => {
    it("con 3 claves de tag la consulta a CostSnapshots se hace UNA vez", async () => {
        await getLiveResourcesCostsByTag("tenant-1");
        expect(poolQuery.mock.calls.filter(([sql]) => esFallback(sql))).toHaveLength(1);
    });

    it("cada clave recibe su costo, igual que antes de compartir la consulta", async () => {
        const { tags } = await getLiveResourcesCostsByTag("tenant-1");
        const costoDe = (clave: string) => tags.find((t) => t.tagKey === clave)!.values.find((v) => v.tagValue === "x")!.costUSD;
        expect(tags.map((t) => t.tagKey).sort()).toEqual(["CostCenter", "Environment", "Owner"]);
        expect(costoDe("CostCenter")).toBe(15); // 10 + 5
        expect(costoDe("Environment")).toBe(10);
        expect(costoDe("Owner")).toBe(0); // ninguna fila lo trae: queda en 0, no se inventa un costo
    });

    it("si la consulta a MySQL falla, la respuesta sale igual (con costo 0) y no se rompe", async () => {
        poolQuery.mockImplementation(async (sql: string) => {
            if (esFallback(sql)) throw new Error("MySQL no responde");
            return [[], []];
        });
        const { tags } = await getLiveResourcesCostsByTag("tenant-1");
        expect(tags).toHaveLength(3);
        expect(tags.every((t) => t.monthlySpendUSD === 0)).toBe(true);
    });
});

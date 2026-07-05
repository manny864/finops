import { describe, it, expect, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/modules/storage/db", () => ({
    default: { query: (...args: unknown[]) => queryMock(...args) },
}));
vi.mock("mysql2/promise", () => ({
    default: {
        createPool: () => ({
            query: (...args: unknown[]) => poolQueryMock(...args),
            getConnection: vi.fn(),
        }),
    },
}));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn().mockResolvedValue({ tenantId: "real-tenant" }),
    AuthError: class AuthError extends Error { status = 401; },
}));
vi.mock("@/lib/mockData", () => ({
    isMockTenant: () => false,
    getMockDataForRoute: () => ({ mock: true }),
}));

import { GET } from "@/app/api/intelligence/cost-by-category/route";

function makeRequest(days = 30) {
    return {
        url: `http://localhost/api/intelligence/cost-by-category?tenantId=real-tenant&days=${days}`,
        headers: new Headers(),
    } as any;
}

describe("cost-by-category route", () => {
    beforeEach(() => queryMock.mockReset());

    it("agrega por categoría, ordena por costo y calcula porcentajes", async () => {
        queryMock.mockResolvedValue([[
            { category: "Compute", cost: "111.29" },
            { category: "Storage", cost: "11.29" },
            { category: "Networking", cost: "15.03" },
        ], []]);

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.mock).toBe(false);
        expect(body.total).toBeCloseTo(137.61, 2);
        // ordenado desc por costo
        expect(body.categories.map((c: any) => c.category)).toEqual(["Compute", "Networking", "Storage"]);
        expect(body.topCategory).toBe("Compute");
        // porcentaje del top ~81%
        expect(body.categories[0].percent).toBe(81);
    });

    it("conserva 'Other' cuando el resource_type no mapea a categoría", async () => {
        queryMock.mockResolvedValue([[
            { category: "Compute", cost: "100" },
            { category: "Other", cost: "20" },
        ], []]);

        const res = await GET(makeRequest());
        const body = await res.json();
        const other = body.categories.find((c: any) => c.category === "Other");
        expect(other).toBeTruthy();
        expect(other.cost).toBe(20);
    });

    it("devuelve empty=true cuando no hay filas en 365 días", async () => {
        queryMock.mockResolvedValue([[], []]);
        const res = await GET(makeRequest());
        const body = await res.json();
        expect(body.empty).toBe(true);
        expect(body.total).toBe(0);
        expect(body.diagnostics.effectiveDays).toBe(365);
    });
});

describe("insertCostCategorySnapshotRow", () => {
    beforeEach(() => { poolQueryMock.mockReset(); poolQueryMock.mockResolvedValue([[], []]); });

    it("inserta en CostCategorySnapshots con la clave (tenant,sub,date,resource_type)", async () => {
        const { insertCostCategorySnapshotRow } =
            await vi.importActual<typeof import("@/modules/storage/db")>("@/modules/storage/db");
        await insertCostCategorySnapshotRow("t1", "2026-07-03", {
            subscriptionId: "sub-1",
            resourceType: "microsoft.compute/virtualmachines",
            cost: 42,
        });
        const [sql, params] = poolQueryMock.mock.calls[0];
        expect(String(sql)).toContain("INSERT INTO CostCategorySnapshots");
        expect(params).toEqual(["t1", "sub-1", "2026-07-03", "microsoft.compute/virtualmachines", 42]);
    });
});

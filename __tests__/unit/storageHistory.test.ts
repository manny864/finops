import { describe, it, expect, vi } from "vitest";

const poolQueryMock = vi.fn();

vi.mock("@/modules/storage/db", () => ({
    default: { query: (...args: unknown[]) => poolQueryMock(...args) },
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn().mockResolvedValue({ tenantId: "test-tenant" }),
    AuthError: class AuthError extends Error {
        status = 401;
    },
}));

vi.mock("@/lib/mockData", () => ({
    isMockTenant: () => false,
    getMockDataForRoute: () => ({ totalGb: 100, totalCost: 10 }),
}));

import { GET } from "@/app/api/intelligence/storage-efficiency/history/route";

describe("storage-efficiency history route", () => {
    it("devuelve 13 meses de histórico agrupados por mes", async () => {
        poolQueryMock.mockResolvedValueOnce([
            [
                { month: "2025-08", totalCost: 12.5, totalGb: 500 },
                { month: "2025-09", totalCost: 15.0, totalGb: 600 },
            ],
        ]);

        const req = {
            url: "http://localhost/api/intelligence/storage-efficiency/history?tenantId=test-tenant",
            headers: new Headers(),
        } as any;

        const res = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.history.length).toBe(13);
        const itemAug = body.history.find((h: any) => h.month === "2025-08");
        const itemSep = body.history.find((h: any) => h.month === "2025-09");
        expect(itemAug?.totalCost).toBe(12.5);
        expect(itemSep?.momChangePercent).toBe(20); // (15 - 12.5)/12.5 * 100 = 20%
    });

    it("requiere tenantId", async () => {
        const req = {
            url: "http://localhost/api/intelligence/storage-efficiency/history",
            headers: new Headers(),
        } as any;

        const res = await GET(req);
        expect(res.status).toBe(400);
    });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getExcludedMock } = vi.hoisted(() => ({ getExcludedMock: vi.fn() }));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn().mockResolvedValue({ tenantId: "test-tenant" }),
    AuthError: class AuthError extends Error {
        status = 401;
    },
}));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({
        getToken: vi.fn(async () => ({ token: "fake" })),
    })),
    getExcludedSubscriptionIds: getExcludedMock,
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn(async () => [[{ tier: "Enterprise" }]]) },
}));

const SUB_VISIBLE = "11111111-1111-1111-1111-111111111111";
const SUB_UNLINKED = "22222222-2222-2222-2222-222222222222"; // "RPA Patrocinio Producción"

beforeEach(() => {
    getExcludedMock.mockReset().mockResolvedValue(new Set());
    vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        json: async () => ({
            value: [
                { subscriptionId: SUB_VISIBLE, displayName: "Producción", state: "Enabled", tenantId: "t1" },
                { subscriptionId: SUB_UNLINKED, displayName: "RPA Patrocinio Producción", state: "Enabled", tenantId: "t1" },
            ],
        }),
    })));
});

describe("GET /api/subscriptions — MEJ-25 (excluye desvinculadas del selector)", () => {
    it("una suscripción desvinculada no aparece en el selector de Alcance", async () => {
        getExcludedMock.mockResolvedValue(new Set([SUB_UNLINKED.toLowerCase()]));

        const { GET } = await import("@/app/api/subscriptions/route");
        const req = new NextRequest("http://localhost/api/subscriptions?tenantId=test-tenant");
        const res = await GET(req);
        const body = await res.json();

        const ids = body.subscriptions.map((s: any) => s.id);
        expect(ids).toContain(SUB_VISIBLE);
        expect(ids).not.toContain(SUB_UNLINKED);
        expect(body.totalAvailable).toBe(1);
    });

    it("sin exclusiones, devuelve todo lo que ve Azure", async () => {
        const { GET } = await import("@/app/api/subscriptions/route");
        const req = new NextRequest("http://localhost/api/subscriptions?tenantId=test-tenant");
        const res = await GET(req);
        const body = await res.json();

        expect(body.subscriptions.map((s: any) => s.id).sort()).toEqual([SUB_UNLINKED, SUB_VISIBLE].sort());
        expect(body.totalAvailable).toBe(2);
    });
});

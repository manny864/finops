// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { guard, query } = vi.hoisted(() => ({ guard: vi.fn(), query: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query } }));
vi.mock("@/lib/requestAuth", async () => ({
    ...await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth"),
    requireTenantAccess: guard,
    requireTenantRole: guard,
}));
import { AuthError } from "@/lib/requestAuth";
import { GET as report } from "@/app/api/admin/audit-trail/route";
import { GET as reportLegacy } from "@/app/api/admin/audit/route";
import { GET as exportTrail } from "@/app/api/admin/audit-trail/export/route";
import { GET as exportLegacy } from "@/app/api/admin/audit/export/route";
import { GET as billing } from "@/app/api/admin/billing/route";

const routes = [
    { path: "/api/admin/audit-trail", handler: report },
    { path: "/api/admin/audit", handler: reportLegacy },
    { path: "/api/admin/audit-trail/export", handler: exportTrail },
    { path: "/api/admin/audit/export", handler: exportLegacy },
    { path: "/api/admin/billing", handler: billing },
];

beforeEach(() => {
    guard.mockReset();
    query.mockReset();
});

describe.each(routes)("$path mock query authorization", ({ path, handler }) => {
    it.each([401, 403])("mock=true cannot bypass a %i denial for a real tenant", async (status) => {
        guard.mockRejectedValue(new AuthError("Access denied", status));
        const response = await handler(new NextRequest(
            `https://example.test${path}?tenantId=real-customer&mock=true&format=json`,
        ));
        expect(response.status).toBe(status);
        expect(guard).toHaveBeenCalledOnce();
        expect(query).not.toHaveBeenCalled();
    });

    it("preserves anonymous synthetic demonstration data", async () => {
        const response = await handler(new NextRequest(
            `https://example.test${path}?tenantId=demo&format=json`,
        ));
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain(handler === billing ? "inv-mock-0842" : "ROTATE_APP_SECRET");
        expect(guard).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });
});

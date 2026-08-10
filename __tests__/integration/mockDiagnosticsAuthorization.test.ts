// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    requireTenantAccess: vi.fn(),
}));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(),
    getSubscriptionsForTenant: vi.fn(),
}));

vi.mock("@/lib/mockData", () => ({
    isMockTenant: vi.fn(() => true),
}));

vi.mock("@/lib/redis", () => ({
    redis: { del: vi.fn() },
}));

vi.mock("@/app/api/intelligence/databases/diagnosticsShared", () => ({
    distributeCostPerResource: vi.fn(),
    getDiagnosticsCacheKey: vi.fn(),
    getMonthlyCostByType: vi.fn(),
    listResourcesByTypes: vi.fn(),
    readDiagnosticsCache: vi.fn(),
    writeDiagnosticsCache: vi.fn(),
}));

vi.mock("@/lib/requestAuth", async () => {
    const actual = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
    return { ...actual, requireTenantAccess: mocks.requireTenantAccess };
});

import { GET as getMysqlDiagnostics } from "@/app/api/intelligence/databases/mysql-diagnostics/route";
import { GET as getRedisDiagnostics } from "@/app/api/intelligence/databases/redis-diagnostics/route";
import { AuthError } from "@/lib/requestAuth";

describe("database diagnostics mock authorization", () => {
    beforeEach(() => {
        mocks.requireTenantAccess.mockReset();
        mocks.requireTenantAccess.mockRejectedValue(new AuthError("Access denied", 403));
    });

    it.each([
        ["MySQL", getMysqlDiagnostics],
        ["Redis", getRedisDiagnostics],
    ])("rejects unauthorized mock tenant access for %s", async (_name, handler) => {
        const request = new NextRequest("http://localhost/api?tenantId=mock-essential");

        const response = await handler(request);

        expect(response.status).toBe(403);
        expect(mocks.requireTenantAccess).toHaveBeenCalledWith(request, "mock-essential");
    });
});
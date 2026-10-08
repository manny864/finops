// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { updateMock, mergeMock } = vi.hoisted(() => ({
    updateMock: vi.fn(),
    mergeMock: vi.fn(async () => {}),
}));

vi.mock("@azure/arm-resources", () => ({
    ResourceManagementClient: class {
        tagsOperations = { beginUpdateAtScope: updateMock };
    },
}));
vi.mock("@/lib/azure", () => ({ getAzureCredential: vi.fn(async () => ({})) }));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantRole: vi.fn(async () => ({ tenantId: "t1" })),
    requireTenantTier: vi.fn(async () => {}),
    AuthError: class AuthError extends Error {},
}));
// Los guards de escritura tienen sus propios tests (scopeDelTenant y lighthouseGuardEscritura).
vi.mock("@/lib/lighthouseAccess", () => ({ bloqueoPorDelegacionDeLectura: vi.fn(async () => null) }));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirScopesDelTenant: vi.fn(async () => {}) }));
vi.mock("@/lib/mockData", () => ({
    isMockTenant: (t: string) => t === "demo_tenant",
    markMockResourcesAsTagged: vi.fn(),
}));
vi.mock("@/services/azureTagGovernance.service", () => ({ mergeLocalCachedTags: mergeMock }));

import { POST } from "@/app/api/tags/apply-bulk/route";

const OK = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Web/sites/ok";
const FALLA = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.Web/sites/falla";

const req = (b: unknown) => new NextRequest("http://localhost/api/tags/apply-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
});

beforeEach(() => {
    updateMock.mockReset().mockImplementation(async (resourceId: string) => {
        if (resourceId === FALLA) throw new Error("AuthorizationFailed");
        return { pollUntilDone: async () => ({}) };
    });
    mergeMock.mockClear();
});

describe("POST /api/tags/apply-bulk y la caché local", () => {
    it("lleva a la caché sólo los recursos que ARM aceptó y responde igual que antes", async () => {
        const res = await POST(req({ tenantId: "t1", resourceIds: [OK, FALLA], tags: { Role: "frontend" } }));
        const json = await res.json();

        expect(mergeMock).toHaveBeenCalledWith("t1", [{ resourceId: OK, tags: { Role: "frontend" } }]);
        expect(json).toEqual({
            success: true,
            summary: { total: 2, succeeded: 1, failed: 1 },
            results: [
                { resourceId: OK, success: true },
                { resourceId: FALLA, success: false, error: "AuthorizationFailed" },
            ],
        });
    });

    it("el tenant demo no toca Azure ni la caché", async () => {
        await POST(req({ tenantId: "demo_tenant", resourceIds: [OK], tags: { Role: "api" } }));

        expect(updateMock).not.toHaveBeenCalled();
        expect(mergeMock).not.toHaveBeenCalled();
    });
});

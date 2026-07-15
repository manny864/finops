// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getPreview } from "@/app/api/governance/tags/inheritance-preview/route";
import { POST as postApply } from "@/app/api/governance/tags/apply-inheritance/route";

const mocks = vi.hoisted(() => {
    return {
        mockRequireTenantAccess: vi.fn(),
        mockRequireTenantRole: vi.fn(),
        mockRequireTenantTier: vi.fn(),
        mockGetAzureCredential: vi.fn(),
        mockAnalyzeMissingTags: vi.fn(),
        mockApplyTagInheritance: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn(), getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/requestAuth", async () => {
    const actual = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
    return {
        ...actual,
        requireTenantAccess: mocks.mockRequireTenantAccess,
        requireTenantRole: mocks.mockRequireTenantRole,
        requireTenantTier: mocks.mockRequireTenantTier,
        AuthError: actual.AuthError,
    };
});

vi.mock("@/lib/azure", () => ({
    getAzureCredential: mocks.mockGetAzureCredential,
}));

vi.mock("@/services/tagInheritanceService", () => ({
    analyzeMissingTags: mocks.mockAnalyzeMissingTags,
    applyTagInheritance: mocks.mockApplyTagInheritance,
}));

function makeReq(url: string, init?: RequestInit) {
    return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

describe("GET /api/governance/tags/inheritance-preview", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockAnalyzeMissingTags.mockResolvedValue([]);
        mocks.mockGetAzureCredential.mockResolvedValue({});
        mocks.mockRequireTenantAccess.mockResolvedValue({
            tenantId: "t-123",
            email: "user@example.com",
            claims: { oid: "oid-123", tid: "t-123" },
            isCorporateDomain: false,
        });
    });

    it("returns 400 without tenantId", async () => {
        const req = makeReq("http://localhost:3000/api/governance/tags/inheritance-preview");
        const res = await getPreview(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("tenantId");
    });

    it("returns 200 with empty rows when tenantId provided", async () => {
        const req = makeReq("http://localhost:3000/api/governance/tags/inheritance-preview?tenantId=t-123");
        const res = await getPreview(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.count).toBe(0);
        expect(Array.isArray(data.rows)).toBe(true);
    });

    it("passes subscriptionId to analyzer", async () => {
        mocks.mockAnalyzeMissingTags.mockResolvedValue([]);

        const req = makeReq(
            "http://localhost:3000/api/governance/tags/inheritance-preview?tenantId=t-123&subscriptionId=sub-456"
        );
        const res = await getPreview(req);
        const data = await res.json();

        expect(data.success).toBe(true);
        expect(mocks.mockAnalyzeMissingTags).toHaveBeenCalledWith(
            {},
            "sub-456",
            expect.any(Object)
        );
    });

    it("returns 400 when no Azure credential configured", async () => {
        mocks.mockGetAzureCredential.mockRejectedValue(new Error("No credentials"));

        const req = makeReq("http://localhost:3000/api/governance/tags/inheritance-preview?tenantId=t-123");
        const res = await getPreview(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("credenciales");
        expect(data.hint).toBeDefined();
    });

    it("returns 401 when auth fails", async () => {
        const { AuthError } = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
        mocks.mockRequireTenantAccess.mockRejectedValue(new AuthError("Access denied", 401));

        const req = makeReq("http://localhost:3000/api/governance/tags/inheritance-preview?tenantId=t-123");
        const res = await getPreview(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.success).toBe(false);
    });

    it("passes tagKeys filter to analyzer", async () => {
        mocks.mockAnalyzeMissingTags.mockResolvedValue([]);

        const req = makeReq(
            "http://localhost:3000/api/governance/tags/inheritance-preview?tenantId=t-123&tagKeys=Environment,Owner"
        );
        const res = await getPreview(req);

        expect(mocks.mockAnalyzeMissingTags).toHaveBeenCalledWith(
            {},
            "All",
            expect.objectContaining({
                tagKeys: expect.arrayContaining(["Environment", "Owner"]),
            })
        );
    });
});

describe("POST /api/governance/tags/apply-inheritance", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockApplyTagInheritance.mockResolvedValue([
            { success: true, resourceId: "res-1", tagsApplied: { key: "value" } },
        ]);
        mocks.mockGetAzureCredential.mockResolvedValue({});
        mocks.mockRequireTenantRole.mockResolvedValue({
            tenantId: "t-123",
            email: "user@example.com",
            claims: { oid: "oid-123", tid: "t-123" },
            isCorporateDomain: false,
        });
        mocks.mockRequireTenantTier.mockResolvedValue(undefined);
    });

    it("returns 400 without tenantId", async () => {
        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({
                ops: [{ resourceId: "res-1", tagsToMerge: { key: "value" } }],
            }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("tenantId");
    });

    it("returns 400 without ops", async () => {
        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123" }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("Faltan operaciones");
    });

    it("returns 400 with empty ops array", async () => {
        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", ops: [] }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("Faltan operaciones");
    });

    it("returns 400 with ops > 200", async () => {
        const ops = Array.from({ length: 201 }, (_, i) => ({
            resourceId: `res-${i}`,
            tagsToMerge: { key: "value" },
        }));

        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", ops }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("Demasiadas");
    });

    it("returns 400 with invalid op (missing resourceId)", async () => {
        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({
                tenantId: "t-123",
                ops: [{ tagsToMerge: { key: "value" } }],
            }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("Op inválida");
    });

    it("returns 400 with invalid op (missing tagsToMerge)", async () => {
        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({
                tenantId: "t-123",
                ops: [{ resourceId: "res-1" }],
            }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("Op inválida");
    });

    it("returns 200 with results for valid ops", async () => {
        const ops = [
            { resourceId: "res-1", tagsToMerge: { env: "prod" } },
            { resourceId: "res-2", tagsToMerge: { env: "dev" } },
        ];

        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", ops }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.applied).toBe(1);
        expect(data.failed).toBe(0);
        expect(Array.isArray(data.results)).toBe(true);
    });

    it("includes dryRun flag in response", async () => {
        const ops = [{ resourceId: "res-1", tagsToMerge: { key: "value" } }];

        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", ops, dryRun: true }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(data.dryRun).toBe(true);
    });

    it("returns 400 when no Azure credential configured", async () => {
        mocks.mockGetAzureCredential.mockRejectedValue(new Error("No credentials"));

        const ops = [{ resourceId: "res-1", tagsToMerge: { key: "value" } }];

        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", ops }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("credenciales");
    });

    it("returns 401 when auth fails", async () => {
        const { AuthError } = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
        mocks.mockRequireTenantRole.mockRejectedValue(new AuthError("Access denied", 401));

        const ops = [{ resourceId: "res-1", tagsToMerge: { key: "value" } }];

        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", ops }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postApply(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.success).toBe(false);
    });

    it("requires Admin or Owner role", async () => {
        const ops = [{ resourceId: "res-1", tagsToMerge: { key: "value" } }];

        const req = makeReq("http://localhost:3000/api/governance/tags/apply-inheritance", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", ops }),
            headers: { "Content-Type": "application/json" },
        });

        await postApply(req);

        expect(mocks.mockRequireTenantRole).toHaveBeenCalledWith(
            expect.any(Object),
            "t-123",
            expect.arrayContaining(["Admin", "Owner"])
        );
    });
});

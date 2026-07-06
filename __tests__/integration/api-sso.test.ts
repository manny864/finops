// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as startGET } from "@/app/api/auth/sso/start/route";
import { GET as callbackGET } from "@/app/api/auth/sso/callback/route";
import { GET as meGET } from "@/app/api/auth/sso/me/route";
import { GET as adminGET, PUT as adminPUT } from "@/app/api/admin/sso/route";

const mocks = vi.hoisted(() => {
    class MockAuthError extends Error {
        status: number = 401;
        constructor(message: string, status = 401) {
            super(message);
            this.status = status;
        }
    }

    return {
        mockPoolQuery: vi.fn(),
        mockWorkOS: vi.fn(),
        mockIsConfigured: vi.fn(),
        mockGetWorkOS: vi.fn(),
        mockSetSsoCookie: vi.fn(),
        mockGetSsoSession: vi.fn(),
        mockRequireTenantRole: vi.fn(),
        MockAuthError,
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/workosClient", () => ({
    isWorkOSConfigured: mocks.mockIsConfigured,
    getWorkOS: mocks.mockGetWorkOS,
}));

vi.mock("@/lib/ssoSession", () => ({
    setSsoCookie: mocks.mockSetSsoCookie,
    getSsoSession: mocks.mockGetSsoSession,
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantRole: mocks.mockRequireTenantRole,
    AuthError: mocks.MockAuthError,
}));

// El rate limiter no es objeto de estas pruebas; se mockea para que siempre
// permita y no acumule estado entre tests (el fallback en memoria compartiría
// la key `sso-start:unknown` entre casos y dispararía 429 falsos).
vi.mock("@/lib/rateLimiter", () => ({
    default: {
        checkByKeyDistributed: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, resetAt: new Date() }),
    },
}));

function makeReq(url: string, init?: RequestInit) {
    return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

describe("SSO API Routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("GET /api/auth/sso/start", () => {
        it("returns 503 when SSO not configured", async () => {
            mocks.mockIsConfigured.mockReturnValue(false);

            const req = makeReq("http://localhost:3000/api/auth/sso/start?domain=acme.com&tenantId=tenant123");
            const res = await startGET(req);

            expect(res.status).toBe(503);
            const data = await res.json();
            expect(data.error).toContain("SSO not configured");
        });

        it("returns 400 when domain or tenantId missing", async () => {
            mocks.mockIsConfigured.mockReturnValue(true);

            const req = makeReq("http://localhost:3000/api/auth/sso/start?domain=acme.com");
            const res = await startGET(req);

            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("Missing domain or tenantId");
        });

        it("returns 403 when SSO not enabled for tenant", async () => {
            mocks.mockIsConfigured.mockReturnValue(true);
            mocks.mockPoolQuery.mockResolvedValue([
                [{ enabled: false }],
                [],
            ]);

            const req = makeReq(
                "http://localhost:3000/api/auth/sso/start?domain=acme.com&tenantId=tenant123"
            );
            const res = await startGET(req);

            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toContain("not enabled");
        });
    });

    describe("GET /api/auth/sso/callback", () => {
        it("returns 400 without code", async () => {
            const req = makeReq("http://localhost:3000/api/auth/sso/callback?state=tenant123");
            const res = await callbackGET(req);

            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("Missing code or state");
        });

        it("returns 503 when SSO not configured", async () => {
            mocks.mockIsConfigured.mockReturnValue(false);

            const req = makeReq(
                "http://localhost:3000/api/auth/sso/callback?code=code123&state=tenant123"
            );
            const res = await callbackGET(req);

            expect(res.status).toBe(503);
            const data = await res.json();
            expect(data.error).toContain("SSO not configured");
        });
    });

    describe("GET /api/auth/sso/me", () => {
        it("returns authenticated false when no session", async () => {
            mocks.mockGetSsoSession.mockResolvedValue(null);

            const req = makeReq("http://localhost:3000/api/auth/sso/me");
            const res = await meGET(req);

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.authenticated).toBe(false);
            expect(data.source).toBeNull();
        });

        it("returns authenticated true with session data", async () => {
            mocks.mockGetSsoSession.mockResolvedValue({
                tenantId: "tenant123",
                email: "user@acme.com",
                workosUserId: "workos_123",
            });

            const req = makeReq("http://localhost:3000/api/auth/sso/me");
            const res = await meGET(req);

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.authenticated).toBe(true);
            expect(data.email).toBe("user@acme.com");
            expect(data.tenantId).toBe("tenant123");
            expect(data.source).toBe("sso");
        });
    });

    describe("GET /api/admin/sso", () => {
        it("returns 401 without proper auth", async () => {
            mocks.mockRequireTenantRole.mockRejectedValue(
                new mocks.MockAuthError("Unauthorized", 401)
            );

            const req = makeReq("http://localhost:3000/api/admin/sso?tenantId=tenant123");
            const res = await adminGET(req);

            expect(res.status).toBe(401);
        });

        it("returns 400 without tenantId", async () => {
            const req = makeReq("http://localhost:3000/api/admin/sso");
            const res = await adminGET(req);

            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("Missing tenantId");
        });
    });

    describe("PUT /api/admin/sso", () => {
        it("returns 400 without tenantId", async () => {
            const req = makeReq("http://localhost:3000/api/admin/sso", {
                method: "PUT",
                body: JSON.stringify({}),
                headers: { "Content-Type": "application/json" },
            });
            const res = await adminPUT(req);

            expect(res.status).toBe(400);
        });
    });
});



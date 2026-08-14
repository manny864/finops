// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as listGET, POST as createPOST } from "@/app/api/support/tickets/route";
import { GET as detailGET, POST as replyPOST, PATCH as ticketPATCH } from "@/app/api/support/tickets/[id]/route";
import { GET as adminGET } from "@/app/api/admin/support/tickets/route";

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
        mockGetConnection: vi.fn(),
        mockRequireTenantAccess: vi.fn(),
        mockRequireSuperAdmin: vi.fn(),
        mockHasSystemRole: vi.fn(),
        MockAuthError,
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: mocks.mockGetConnection },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: mocks.mockRequireTenantAccess,
    requireSuperAdmin: mocks.mockRequireSuperAdmin,
    hasSystemRole: mocks.mockHasSystemRole,
    AuthError: mocks.MockAuthError,
}));

// El rate limiter no es objeto de estas pruebas; siempre permite.
vi.mock("@/lib/rateLimiter", () => ({
    default: {
        checkByKeyDistributed: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, resetAt: new Date() }),
    },
}));

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0001";

const userIdentity = {
    claims: { tid: TENANT, name: "Test User" },
    tenantId: TENANT,
    email: "user@cliente.com",
    isCorporateDomain: false,
};

function makeReq(url: string, init?: RequestInit) {
    return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

function jsonReq(url: string, method: string, body: unknown) {
    return makeReq(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("Support Tickets API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockRequireTenantAccess.mockResolvedValue(userIdentity);
        mocks.mockHasSystemRole.mockResolvedValue(false);
    });

    describe("GET /api/support/tickets", () => {
        it("returns 400 without tenantId", async () => {
            const res = await listGET(makeReq("http://localhost:3000/api/support/tickets"));
            expect(res.status).toBe(400);
        });

        it("returns 403 when tenant access denied", async () => {
            mocks.mockRequireTenantAccess.mockRejectedValue(new mocks.MockAuthError("denegado", 403));
            const res = await listGET(makeReq(`http://localhost:3000/api/support/tickets?tenantId=${TENANT}`));
            expect(res.status).toBe(403);
        });

        it("returns tickets with quota info for the tenant tier", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ tier: "Professional" }], []])
                .mockResolvedValueOnce([[{ id: 1, subject: "Ayuda", status: "open" }], []])
                .mockResolvedValueOnce([[{ c: 2 }], []]);
            const res = await listGET(makeReq(`http://localhost:3000/api/support/tickets?tenantId=${TENANT}`));
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(json.tickets).toHaveLength(1);
            expect(json.quota).toEqual({ monthlyLimit: 20, usedThisMonth: 2, firstResponseSlaHours: 24 });
        });
    });

    describe("POST /api/support/tickets", () => {
        const validBody = {
            tenantId: TENANT,
            subject: "Problema con costos",
            message: "El dashboard muestra un valor raro.",
            category: "technical",
            priority: "high",
        };

        it("returns 400 when subject is too short", async () => {
            const res = await createPOST(jsonReq("http://localhost:3000/api/support/tickets", "POST", { ...validBody, subject: "ab" }));
            expect(res.status).toBe(400);
        });

        it("returns 403 with quotaExceeded when the Professional monthly quota is reached", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ tier: "Professional" }], []])
                .mockResolvedValueOnce([[{ c: 20 }], []]);
            const res = await createPOST(jsonReq("http://localhost:3000/api/support/tickets", "POST", validBody));
            const json = await res.json();
            expect(res.status).toBe(403);
            expect(json.quotaExceeded).toBe(true);
        });

        it("creates ticket + first message in a transaction for unlimited tiers", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ tier: "Enterprise" }], []]);
            const conn = {
                beginTransaction: vi.fn(),
                query: vi.fn()
                    .mockResolvedValueOnce([{ insertId: 42 }, []])
                    .mockResolvedValueOnce([{}, []]),
                commit: vi.fn(),
                rollback: vi.fn(),
                release: vi.fn(),
            };
            mocks.mockGetConnection.mockResolvedValue(conn);
            const res = await createPOST(jsonReq("http://localhost:3000/api/support/tickets", "POST", validBody));
            const json = await res.json();
            expect(res.status).toBe(201);
            expect(json.ticketId).toBe(42);
            expect(conn.commit).toHaveBeenCalled();
            expect(conn.release).toHaveBeenCalled();
        });
    });

    describe("POST /api/support/tickets/[id] (reply)", () => {
        const params = { params: Promise.resolve({ id: "7" }) };

        it("returns 409 when ticket is closed", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, status: "closed" }], []]);
            const res = await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", { tenantId: TENANT, message: "hola" }),
                params
            );
            expect(res.status).toBe(409);
        });

        it("stores reply as 'user' and reopens the ticket for tenant users", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "waiting_customer" }], []])
                .mockResolvedValueOnce([{}, []])
                .mockResolvedValueOnce([{}, []]);
            const res = await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", { tenantId: TENANT, message: "sigue igual" }),
                params
            );
            const json = await res.json();
            expect(res.status).toBe(201);
            expect(json.status).toBe("open");
            const insertArgs = mocks.mockPoolQuery.mock.calls[1][1];
            expect(insertArgs).toContain("user");
        });

        it("stores reply as 'support' and sets waiting_customer for superadmins", async () => {
            mocks.mockRequireTenantAccess.mockResolvedValue({
                ...userIdentity,
                email: "soporte@cscloudsolutions.com.ar",
                isCorporateDomain: true,
            });
            mocks.mockHasSystemRole.mockResolvedValue(true);
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{}, []])
                .mockResolvedValueOnce([{}, []]);
            const res = await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", { tenantId: TENANT, message: "revisado" }),
                params
            );
            const json = await res.json();
            expect(res.status).toBe(201);
            expect(json.status).toBe("waiting_customer");
            const insertArgs = mocks.mockPoolQuery.mock.calls[1][1];
            expect(insertArgs).toContain("support");
        });
    });

    describe("PATCH /api/support/tickets/[id]", () => {
        const params = { params: Promise.resolve({ id: "7" }) };

        it("blocks tenant users from changing priority", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, status: "open" }], []]);
            const res = await ticketPATCH(
                jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", { tenantId: TENANT, priority: "urgent" }),
                params
            );
            expect(res.status).toBe(403);
        });

        it("blocks tenant users from setting intermediate statuses", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, status: "open" }], []]);
            const res = await ticketPATCH(
                jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", { tenantId: TENANT, status: "in_progress" }),
                params
            );
            expect(res.status).toBe(403);
        });

        it("lets tenant users close their ticket", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{}, []]);
            const res = await ticketPATCH(
                jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", { tenantId: TENANT, status: "closed" }),
                params
            );
            expect(res.status).toBe(200);
        });
    });

    describe("GET /api/admin/support/tickets", () => {
        it("returns 403 for non-superadmins", async () => {
            mocks.mockRequireSuperAdmin.mockRejectedValue(new mocks.MockAuthError("denegado", 403));
            const res = await adminGET(makeReq("http://localhost:3000/api/admin/support/tickets"));
            expect(res.status).toBe(403);
        });

        it("returns the global queue with status counts", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({});
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 1, tenant_id: TENANT, subject: "x", status: "open" }], []])
                .mockResolvedValueOnce([[{ status: "open", c: 1 }], []]);
            const res = await adminGET(makeReq("http://localhost:3000/api/admin/support/tickets"));
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(json.tickets).toHaveLength(1);
            expect(json.statusCounts).toEqual({ open: 1 });
        });
    });
});

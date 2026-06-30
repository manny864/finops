// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getAudit } from "@/app/api/admin/audit/route";
import { GET as getExport } from "@/app/api/admin/audit/export/route";

const mocks = vi.hoisted(() => {
  return {
    mockPoolQuery: vi.fn(),
    mockRequireTenantAccess: vi.fn(),
    mockRequireTenantRole: vi.fn(),
  };
});

vi.mock("@/modules/storage/db", () => ({
  default: {
    query: mocks.mockPoolQuery,
    getConnection: vi.fn(),
  },
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/requestAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/requestAuth")>(
    "@/lib/requestAuth"
  );
  return {
    ...actual,
    requireTenantAccess: mocks.mockRequireTenantAccess,
    requireTenantRole: mocks.mockRequireTenantRole,
    AuthError: actual.AuthError,
  };
});

function makeReq(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

describe("GET /api/admin/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 400 without tenantId", async () => {
    const req = makeReq("http://localhost:3000/api/admin/audit");
    const res = await getAudit(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("tenantId");
  });

  it("should return 200 with valid auth and filters", async () => {
    const tenantId = "test-tenant";
    const mockIdentity = { tenantId, email: "test@example.com", isCorporateDomain: false };
    mocks.mockRequireTenantAccess.mockResolvedValue(mockIdentity);

    const mockLogs = [
      {
        id: 1,
        timestamp: "2024-01-01T12:00:00Z",
        user_email: "user1@example.com",
        action_type: "CREATE",
        resource_id: "resource/1",
        status: "SUCCESS",
      },
      {
        id: 2,
        timestamp: "2024-01-02T12:00:00Z",
        user_email: "user2@example.com",
        action_type: "UPDATE",
        resource_id: "resource/2",
        status: "FAILURE",
      },
    ];

    mocks.mockPoolQuery
      .mockResolvedValueOnce([[{ total: 2 }]]) // count query
      .mockResolvedValueOnce([mockLogs]); // select query

    const req = makeReq(`http://localhost:3000/api/admin/audit?tenantId=${tenantId}&user_email=user1&limit=10&offset=0`);
    const res = await getAudit(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toHaveLength(2);
    expect(json.total).toBe(2);
    expect(json.limit).toBe(10);
    expect(json.offset).toBe(0);
    expect(json.hasMore).toBe(false);
  });

  it("should apply user_email filter", async () => {
    const tenantId = "test-tenant";
    const mockIdentity = { tenantId, email: "test@example.com", isCorporateDomain: false };
    mocks.mockRequireTenantAccess.mockResolvedValue(mockIdentity);

    mocks.mockPoolQuery
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[{ id: 1, user_email: "user1@example.com" }]]);

    const req = makeReq(
      `http://localhost:3000/api/admin/audit?tenantId=${tenantId}&user_email=user1&limit=10&offset=0`
    );
    await getAudit(req);

    const countCall = mocks.mockPoolQuery.mock.calls[0];
    expect(countCall[0]).toContain("user_email LIKE");
  });

  it("should return CSV format with correct headers", async () => {
    const tenantId = "test-tenant";
    const mockIdentity = { tenantId, email: "test@example.com", isCorporateDomain: false };
    mocks.mockRequireTenantAccess.mockResolvedValue(mockIdentity);

    const mockLogs = [
      {
        id: 1,
        timestamp: "2024-01-01T12:00:00Z",
        user_email: "test@example.com",
        action_type: "CREATE",
        resource_id: "resource/1",
        status: "SUCCESS",
      },
    ];

    mocks.mockPoolQuery
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([mockLogs]);

    const req = makeReq(
      `http://localhost:3000/api/admin/audit?tenantId=${tenantId}&format=csv&limit=10&offset=0`
    );
    const res = await getAudit(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("audit-");
    expect(res.headers.get("Content-Disposition")).toContain(".csv");

    const text = await res.text();
    expect(text).toContain("id,timestamp,user_email,action_type,resource_id,status");
    expect(text).toContain("test@example.com");
  });

  it("should return NDJSON format", async () => {
    const tenantId = "test-tenant";
    const mockIdentity = { tenantId, email: "test@example.com", isCorporateDomain: false };
    mocks.mockRequireTenantAccess.mockResolvedValue(mockIdentity);

    const mockLogs = [
      {
        id: 1,
        timestamp: "2024-01-01T12:00:00Z",
        user_email: "test@example.com",
        action_type: "CREATE",
        resource_id: "resource/1",
        status: "SUCCESS",
      },
    ];

    mocks.mockPoolQuery
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([mockLogs]);

    const req = makeReq(
      `http://localhost:3000/api/admin/audit?tenantId=${tenantId}&format=ndjson&limit=10&offset=0`
    );
    const res = await getAudit(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");

    const text = await res.text();
    const lines = text.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(1);
    expect(parsed.user_email).toBe("test@example.com");
  });
});

describe("GET /api/admin/audit/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 400 without tenantId", async () => {
    const req = makeReq("http://localhost:3000/api/admin/audit/export");
    const res = await getExport(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("tenantId");
  });

  it("should return 401 without proper auth", async () => {
    const tenantId = "test-tenant";
    const { AuthError } = await import("@/lib/requestAuth");
    const authError = new AuthError("Acceso denegado", 403);
    mocks.mockRequireTenantRole.mockRejectedValue(authError);

    const req = makeReq(
      `http://localhost:3000/api/admin/audit/export?tenantId=${tenantId}`
    );
    const res = await getExport(req);

    expect(res.status).toBe(403);
  });

  it("should stream CSV response", async () => {
    const tenantId = "test-tenant";
    const mockIdentity = { tenantId, email: "admin@example.com", isCorporateDomain: true };
    mocks.mockRequireTenantRole.mockResolvedValue(mockIdentity);

    const mockLogs = [
      {
        id: 1,
        timestamp: "2024-01-01T12:00:00Z",
        user_email: "user@example.com",
        action_type: "CREATE",
        resource_id: "resource/1",
        status: "SUCCESS",
      },
    ];

    mocks.mockPoolQuery
      .mockResolvedValueOnce([mockLogs]); // first batch

    const req = makeReq(
      `http://localhost:3000/api/admin/audit/export?tenantId=${tenantId}`
    );
    const res = await getExport(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("full");
  });

  it("should apply filters in export", async () => {
    const tenantId = "test-tenant";
    const mockIdentity = { tenantId, email: "admin@example.com", isCorporateDomain: true };
    mocks.mockRequireTenantRole.mockResolvedValue(mockIdentity);

    mocks.mockPoolQuery.mockResolvedValueOnce([[]]);

    const req = makeReq(
      `http://localhost:3000/api/admin/audit/export?tenantId=${tenantId}&action_type=DELETE&status=SUCCESS`
    );
    await getExport(req);

    const firstCall = mocks.mockPoolQuery.mock.calls[0];
    expect(firstCall[0]).toContain("action_type = ?");
    expect(firstCall[0]).toContain("status = ?");
  });
});

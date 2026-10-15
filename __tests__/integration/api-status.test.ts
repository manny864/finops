// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as statusGET } from "@/app/api/status/route";
import { GET as incidentsGET, POST as incidentsPOST } from "@/app/api/status/incidents/route";
import { GET as snapshotGET } from "@/app/api/cron/status-snapshot/route";
import { __resetPublicStatusCacheForTests } from "@/lib/publicStatus";

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
    mockInitDb: vi.fn().mockResolvedValue(undefined),
    mockRequireSuperAdmin: vi.fn(),
    MockAuthError,
  };
});

vi.mock("@/modules/storage/db", () => ({
  default: { query: mocks.mockPoolQuery },
  initializeDatabase: mocks.mockInitDb,
}));

vi.mock("@/lib/requestAuth", () => ({
  requireSuperAdmin: mocks.mockRequireSuperAdmin,
  AuthError: mocks.MockAuthError,
}));

function makeReq(url: string, init?: any) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

describe("Status API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret-123";
    process.env.GEMINI_API_KEY = "valid-key";
    process.env.PADDLE_API_KEY = "valid-key";
  });

  describe("GET /api/status", () => {
    // PERIM-02: la ruta publica el último snapshot del cron; no mide nada.
    const freshSnapshot = (overall = "operational") => [[{
      overall_status: overall,
      captured_at: new Date(Date.now() - 60_000),
      components_json: JSON.stringify([
        { name: "API", status: "operational" },
        { name: "Database", status: "operational", latency_ms: 12 },
      ]),
    }]];

    beforeEach(() => __resetPublicStatusCacheForTests());

    it("should return 200 with status and components from the latest snapshot", async () => {
      mocks.mockPoolQuery
        .mockResolvedValueOnce(freshSnapshot())
        .mockResolvedValueOnce([[{ total: 1000, down_count: 0, degraded_count: 0, incidents: 0 }]]);

      const res = await statusGET();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("operational");
      expect(json.components).toEqual([
        { name: "API", status: "operational" },
        { name: "Database", status: "operational" },
      ]);
      expect(json).not.toHaveProperty("version");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Cache-Control")).toContain("max-age=30");
      expect(mocks.mockPoolQuery).not.toHaveBeenCalledWith("SELECT 1");
    });

    // Los números son los 7 días reales medidos el 2026-09-22: 2.017 snapshots,
    // 1.932 operational, 82 degraded, 3 down. Con el criterio viejo
    // (operational/total) esto daba 95,79%; lo que estuvo caído es 0,15%.
    it("should count only `down` as downtime, and report `degraded` apart", async () => {
      mocks.mockPoolQuery
        .mockResolvedValueOnce(freshSnapshot())
        .mockResolvedValueOnce([[{ total: 2017, down_count: 3, degraded_count: 82, incidents: 2 }]]);

      const json = await (await statusGET()).json();

      expect(json.uptime_30d_pct).toBe(99.85);
      expect(json.degraded_30d_pct).toBe(4.07);
      expect(json.incidents_last_30d).toBe(2);
    });

    it("should answer 503 unknown, never 100%, when the database fails", async () => {
      mocks.mockPoolQuery.mockRejectedValueOnce(new Error("DB error"));

      const res = await statusGET();

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "unknown" });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });
  });

  describe("GET /api/status/incidents", () => {
    it("should return incidents list", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([
        [
          {
            id: 1,
            title: "Database migration",
            severity: "major",
            status: "resolved",
            startedAt: "2025-01-15T10:00:00Z",
            resolvedAt: "2025-01-15T12:00:00Z",
          },
        ],
      ]);

      const req = makeReq("http://localhost:3000/api/status/incidents");
      const res = await incidentsGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.incidents).toBeInstanceOf(Array);
      expect(json.incidents[0].id).toBe(1);
    });

    it("should have public cache headers", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);

      const req = makeReq("http://localhost:3000/api/status/incidents");
      const res = await incidentsGET(req);

      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Cache-Control")).toContain("max-age=60");
    });
  });

  describe("POST /api/status/incidents", () => {
    it("should create incident with superadmin auth", async () => {
      mocks.mockRequireSuperAdmin.mockResolvedValueOnce({
        claims: { tid: "test-tenant" },
        tenantId: "test-tenant",
        email: "admin@cscloudsolutions.com.ar",
        isCorporateDomain: true,
      });

      mocks.mockPoolQuery.mockResolvedValueOnce([{ insertId: 99 }]);

      const req = makeReq("http://localhost:3000/api/status/incidents", {
        method: "POST",
        body: JSON.stringify({
          title: "Service degradation",
          severity: "critical",
          description: "API slow",
        }),
      });

      const res = await incidentsPOST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.id).toBe(99);
      expect(json.status).toBe("investigating");
    });

    it("should reject without superadmin", async () => {
      mocks.mockRequireSuperAdmin.mockRejectedValueOnce(new mocks.MockAuthError("Unauthorized", 403));

      const req = makeReq("http://localhost:3000/api/status/incidents", {
        method: "POST",
        body: JSON.stringify({
          title: "Test",
          severity: "minor",
        }),
      });

      const res = await incidentsPOST(req);
      expect(res.status).toBe(403);
    });

    it("should reject missing title or severity", async () => {
      mocks.mockRequireSuperAdmin.mockResolvedValueOnce({
        claims: {},
        tenantId: "test",
        email: "admin@cscloudsolutions.com.ar",
        isCorporateDomain: true,
      });

      const req = makeReq("http://localhost:3000/api/status/incidents", {
        method: "POST",
        body: JSON.stringify({ title: "Test" }),
      });

      const res = await incidentsPOST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/cron/status-snapshot", () => {
    it("should capture snapshot with valid secret", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 5, ok_count: 5 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total_count: 100, down_count: 0, degraded_count: 0 }]]);

      const req = makeReq("http://localhost:3000/api/cron/status-snapshot", { headers: { authorization: "Bearer test-secret-123" } });
      const res = await snapshotGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.overall_status).toBeDefined();
      expect(json.uptime_30d_pct).toBeDefined();
    });

    it("should reject invalid secret", async () => {
      const req = makeReq("http://localhost:3000/api/cron/status-snapshot", { headers: { authorization: "Bearer wrong" } });
      const res = await snapshotGET(req);

      expect(res.status).toBe(401);
    });

    it("should measure Azure sync over the same tenants the sync cron processes", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total_count: 1, down_count: 0, degraded_count: 0 }]]);

      const req = makeReq("http://localhost:3000/api/cron/status-snapshot", { headers: { authorization: "Bearer test-secret-123" } });
      await snapshotGET(req);

      const tenantsSql = mocks.mockPoolQuery.mock.calls.map((c) => String(c[0])).find((q) => q.includes("FROM Tenants"));
      expect(tenantsSql).toContain("status = 'active'");
      expect(tenantsSql).toContain("provider_archived");
    });

    it("should insert snapshot into database", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total_count: 100, down_count: 0, degraded_count: 50 }]]);

      const req = makeReq("http://localhost:3000/api/cron/status-snapshot", { headers: { authorization: "Bearer test-secret-123" } });
      const res = await snapshotGET(req);

      expect(res.status).toBe(200);
      expect(mocks.mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO PlatformStatusSnapshots"), expect.any(Array));
    });
  });
});

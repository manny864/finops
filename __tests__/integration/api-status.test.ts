// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as statusGET } from "@/app/api/status/route";
import { GET as incidentsGET, POST as incidentsPOST } from "@/app/api/status/incidents/route";
import { GET as snapshotGET } from "@/app/api/cron/status-snapshot/route";

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
    it("should return 200 with status and components", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 5, ok_count: 5 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([
        [
          {
            operational_count: 1000,
            total_count: 1000,
          },
        ],
      ]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ incident_count: 0 }]]);

      const req = makeReq("http://localhost:3000/api/status");
      const res = await statusGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toHaveProperty("status");
      expect(json).toHaveProperty("timestamp");
      expect(json).toHaveProperty("components");
      expect(json).toHaveProperty("uptime_30d_pct");
      expect(json).toHaveProperty("incidents_last_30d");
      expect(json).toHaveProperty("version");
      expect(json.components).toBeInstanceOf(Array);
      expect(json.components.length).toBeGreaterThan(0);
    });

    it("should have CORS headers", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ operational_count: 0, total_count: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ incident_count: 0 }]]);

      const req = makeReq("http://localhost:3000/api/status");
      const res = await statusGET(req);

      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Cache-Control")).toContain("max-age=30");
    });

    it("should mark database as down on query error", async () => {
      mocks.mockPoolQuery.mockRejectedValueOnce(new Error("DB error"));
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ operational_count: 0, total_count: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ incident_count: 0 }]]);

      const req = makeReq("http://localhost:3000/api/status");
      const res = await statusGET(req);
      const json = await res.json();

      expect(json.components.find((c: any) => c.name === "Database").status).toBe("down");
    });

    it("should mark Azure sync as degraded when ratio < 0.5", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 10, ok_count: 3 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ operational_count: 0, total_count: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ incident_count: 0 }]]);

      const req = makeReq("http://localhost:3000/api/status");
      const res = await statusGET(req);
      const json = await res.json();

      expect(json.components.find((c: any) => c.name === "Azure Sync").status).toBe("degraded");
    });

    it("should mark AI provider as degraded when GEMINI_API_KEY is empty", async () => {
      process.env.GEMINI_API_KEY = "";
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ operational_count: 0, total_count: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ incident_count: 0 }]]);

      const req = makeReq("http://localhost:3000/api/status");
      const res = await statusGET(req);
      const json = await res.json();

      expect(json.components.find((c: any) => c.name === "AI Provider").status).toBe("degraded");
    });

    it("should calculate uptime from snapshots", async () => {
      mocks.mockPoolQuery
        .mockResolvedValueOnce([[]]) // checkDatabaseHealth - SELECT 1
        .mockResolvedValueOnce([[{ total: 0 }]]) // checkAzureSyncHealth
        .mockResolvedValueOnce([
          [
            {
              operational_count: 95,
              total_count: 100,
            },
          ],
        ]) // calculateUptime30d
        .mockResolvedValueOnce([[{ incident_count: 2 }]]); // getIncidentsCount30d

      const req = makeReq("http://localhost:3000/api/status");
      const res = await statusGET(req);
      const json = await res.json();

      expect(json.uptime_30d_pct).toBe(95.0);
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
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ operational_count: 100, total_count: 100 }]]);

      const req = makeReq("http://localhost:3000/api/cron/status-snapshot?secret=test-secret-123");
      const res = await snapshotGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.overall_status).toBeDefined();
      expect(json.uptime_30d_pct).toBeDefined();
    });

    it("should reject invalid secret", async () => {
      const req = makeReq("http://localhost:3000/api/cron/status-snapshot?secret=wrong");
      const res = await snapshotGET(req);

      expect(res.status).toBe(401);
    });

    it("should insert snapshot into database", async () => {
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ total: 0 }]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[]]);
      mocks.mockPoolQuery.mockResolvedValueOnce([[{ operational_count: 50, total_count: 100 }]]);

      const req = makeReq("http://localhost:3000/api/cron/status-snapshot?secret=test-secret-123");
      const res = await snapshotGET(req);

      expect(res.status).toBe(200);
      expect(mocks.mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO PlatformStatusSnapshots"), expect.any(Array));
    });
  });
});

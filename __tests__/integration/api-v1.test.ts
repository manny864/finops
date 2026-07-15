import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { GET as getMeHandler } from "@/app/api/v1/me/route";
import { GET as getCostSummaryHandler } from "@/app/api/v1/cost/summary/route";
import { GET as getOpenApiHandler } from "@/app/api/v1/openapi.json/route";
import { NextRequest } from "next/server";

// Mock the database and auth
vi.mock("@/modules/storage/db", () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock("@/lib/publicApiAuth", () => ({
  verifyApiKey: vi.fn(),
  requireScope: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/rateLimiter", () => ({
  default: {
    check: vi.fn(() => ({
      allowed: true,
      remaining: 59,
      resetAt: new Date(),
    })),
    checkByKeyDistributed: vi.fn(async () => ({
      allowed: true,
      remaining: 59,
      resetAt: new Date(),
    })),
  },
}));

describe("API v1 endpoints", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/me", () => {
    it("should return 401 when no auth is provided", async () => {
      const { verifyApiKey } = await import("@/lib/publicApiAuth");
      vi.mocked(verifyApiKey).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/v1/me", {
        method: "GET",
      });

      const response = await getMeHandler(request);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json.error.code).toBe("unauthorized");
    });

    it("should return 200 with valid auth", async () => {
      const { verifyApiKey } = await import("@/lib/publicApiAuth");
      vi.mocked(verifyApiKey).mockResolvedValue({
        tenantId: "tenant-123",
        keyId: 1,
        name: "Test Key",
        scopes: ["read:cost"],
        rateLimitPerMin: 60,
      });

      const request = new NextRequest("http://localhost:3000/api/v1/me", {
        method: "GET",
      });

      const response = await getMeHandler(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.data.tenant_id).toBe("tenant-123");
      expect(json.data.key_name).toBe("Test Key");
      expect(json.meta.rate_limit.limit).toBe(60);
    });

    it("should have rate limit headers", async () => {
      const { verifyApiKey } = await import("@/lib/publicApiAuth");
      vi.mocked(verifyApiKey).mockResolvedValue({
        tenantId: "tenant-123",
        keyId: 1,
        name: "Test Key",
        scopes: ["read:cost"],
        rateLimitPerMin: 60,
      });

      const request = new NextRequest("http://localhost:3000/api/v1/me", {
        method: "GET",
      });

      const response = await getMeHandler(request);

      expect(response.headers.get("X-RateLimit-Limit")).toBe("60");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("59");
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
    });
  });

  describe("GET /api/v1/cost/summary", () => {
    it("should return 403 when scope is insufficient", async () => {
      const { verifyApiKey, requireScope } = await import("@/lib/publicApiAuth");
      vi.mocked(verifyApiKey).mockResolvedValue({
        tenantId: "tenant-123",
        keyId: 1,
        name: "Test Key",
        scopes: ["read:resources"],
        rateLimitPerMin: 60,
      });

      const error = new Error("Insufficient scope. Required: read:cost");
      (error as any).status = 403;
      vi.mocked(requireScope).mockImplementation(() => {
        throw error;
      });

      const request = new NextRequest(
        "http://localhost:3000/api/v1/cost/summary?from=2024-01-01&to=2024-01-31",
        { method: "GET" }
      );

      const response = await getCostSummaryHandler(request);
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error.code).toBe("insufficient_scope");
    });

    it("should return 400 for missing date parameters", async () => {
      const { verifyApiKey, requireScope } = await import("@/lib/publicApiAuth");
      vi.mocked(verifyApiKey).mockResolvedValue({
        tenantId: "tenant-123",
        keyId: 1,
        name: "Test Key",
        scopes: ["read:cost"],
        rateLimitPerMin: 60,
      });

      vi.mocked(requireScope).mockImplementation(() => {}); // Do nothing (no error)

      const request = new NextRequest("http://localhost:3000/api/v1/cost/summary", {
        method: "GET",
      });

      const response = await getCostSummaryHandler(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error.code).toBe("invalid_request");
    });

    it("should return 400 for invalid date format", async () => {
      const { verifyApiKey, requireScope } = await import("@/lib/publicApiAuth");
      vi.mocked(verifyApiKey).mockResolvedValue({
        tenantId: "tenant-123",
        keyId: 1,
        name: "Test Key",
        scopes: ["read:cost"],
        rateLimitPerMin: 60,
      });

      vi.mocked(requireScope).mockImplementation(() => {});

      const request = new NextRequest(
        "http://localhost:3000/api/v1/cost/summary?from=invalid&to=2024-01-31",
        { method: "GET" }
      );

      const response = await getCostSummaryHandler(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error.code).toBe("invalid_request");
    });

    it("should return 400 when from > to", async () => {
      const { verifyApiKey, requireScope } = await import("@/lib/publicApiAuth");
      vi.mocked(verifyApiKey).mockResolvedValue({
        tenantId: "tenant-123",
        keyId: 1,
        name: "Test Key",
        scopes: ["read:cost"],
        rateLimitPerMin: 60,
      });

      vi.mocked(requireScope).mockImplementation(() => {});

      const request = new NextRequest(
        "http://localhost:3000/api/v1/cost/summary?from=2024-02-01&to=2024-01-01",
        { method: "GET" }
      );

      const response = await getCostSummaryHandler(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error.code).toBe("invalid_request");
      expect(json.error.message).toContain("from date must be before to date");
    });
  });

  describe("GET /api/v1/openapi.json", () => {
    it("should return OpenAPI 3.1.0 spec", async () => {
      const response = await getOpenApiHandler();
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.openapi).toBe("3.1.0");
      expect(json.info.title).toBe("FinOps SaaS API");
      expect(json.info.version).toBe("1.0.0");
    });

    it("should have security schemes defined", async () => {
      const response = await getOpenApiHandler();
      const json = await response.json();

      expect(json.components.securitySchemes.ApiKeyAuth).toBeDefined();
      expect(json.components.securitySchemes.BearerAuth).toBeDefined();
    });

    it("should have all required paths documented", async () => {
      const response = await getOpenApiHandler();
      const json = await response.json();

      const requiredPaths = [
        "/me",
        "/cost/summary",
        "/cost/timeseries",
        "/resources",
        "/budgets",
        "/recommendations",
        "/anomalies",
      ];

      for (const path of requiredPaths) {
        expect(json.paths[path]).toBeDefined();
      }
    });
  });

  describe("Rate limiting", () => {
    it("should return 429 when rate limit is exceeded", async () => {
      const { verifyApiKey } = await import("@/lib/publicApiAuth");
      const rateLimiter = await import("@/lib/rateLimiter");

      vi.mocked(verifyApiKey).mockResolvedValue({
        tenantId: "tenant-123",
        keyId: 1,
        name: "Test Key",
        scopes: ["read:cost"],
        rateLimitPerMin: 60,
      });

      vi.mocked(rateLimiter.default.checkByKeyDistributed).mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: new Date(),
      });

      const request = new NextRequest("http://localhost:3000/api/v1/me", {
        method: "GET",
      });

      const response = await getMeHandler(request);
      const json = await response.json();

      expect(response.status).toBe(429);
      expect(json.error.code).toBe("rate_limit_exceeded");
    });
  });
});

// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/admin/notifications/channels/route";
import pool from "@/modules/storage/db";

// Mock auth
vi.mock("@/lib/requestAuth", () => ({
  requireTenantRole: vi.fn(async (req, tenantId, roles) => ({
    email: "test@example.com",
    tenantId,
    role: "Admin",
  })),
  requireTenantAccess: vi.fn(async (req, tenantId) => ({
    email: "test@example.com",
    tenantId,
  })),
  AuthError: class AuthError extends Error {
    status = 401;
  },
}));

// Mock pool
vi.mock("@/modules/storage/db", () => ({
  default: {
    query: vi.fn(),
  },
}));

describe("GET /api/admin/notifications/channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 400 if tenantId is missing", async () => {
    const request = new NextRequest("http://localhost/api/admin/notifications/channels");
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("tenantId");
  });

  it("should list channels for a tenant", async () => {
    const channels = [
      {
        id: 1,
        type: "slack",
        name: "Slack",
        severity_filter: "info,warning,error",
        enabled: true,
        created_at: "2024-01-15T10:30:00Z",
      },
    ];

    (pool.query as any).mockResolvedValueOnce([channels, []]);

    const request = new NextRequest("http://localhost/api/admin/notifications/channels?tenantId=tenant123");
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.channels).toHaveLength(1);
    expect(json.channels[0].type).toBe("slack");
  });
});

describe("POST /api/admin/notifications/channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 400 if type is missing", async () => {
    const body = { tenantId: "tenant123", name: "Test" };
    const request = new NextRequest("http://localhost/api/admin/notifications/channels", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("slack");
  });

  it("should return 400 for invalid type", async () => {
    const body = {
      tenantId: "tenant123",
      name: "Test",
      type: "sms",
      config_json: {},
    };
    const request = new NextRequest("http://localhost/api/admin/notifications/channels", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("slack");
  });

  it("should return 400 for slack without webhook_url", async () => {
    const body = {
      tenantId: "tenant123",
      name: "Test",
      type: "slack",
      config_json: {},
    };
    const request = new NextRequest("http://localhost/api/admin/notifications/channels", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("webhook_url");
  });

  it("should return 400 for invalid webhook URL", async () => {
    const body = {
      tenantId: "tenant123",
      name: "Test",
      type: "slack",
      config_json: { webhook_url: "not-a-url" },
    };
    const request = new NextRequest("http://localhost/api/admin/notifications/channels", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("URL");
  });

  it("should create slack channel with valid webhook_url", async () => {
    const body = {
      tenantId: "tenant123",
      name: "Slack Channel",
      type: "slack",
      config_json: { webhook_url: "https://hooks.slack.com/services/test" },
      severity_filter: "warning,error",
    };
    const request = new NextRequest("http://localhost/api/admin/notifications/channels", {
      method: "POST",
      body: JSON.stringify(body),
    });

    (pool.query as any).mockResolvedValueOnce([{ insertId: 1 }, []]);

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.channel.type).toBe("slack");
    expect(json.channel.id).toBe(1);
  });

  it("should return 400 for email without recipients", async () => {
    const body = {
      tenantId: "tenant123",
      name: "Email Channel",
      type: "email",
      config_json: { recipients: [] },
    };
    const request = new NextRequest("http://localhost/api/admin/notifications/channels", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("recipients");
  });

  it("should create email channel with recipients", async () => {
    const body = {
      tenantId: "tenant123",
      name: "Email Channel",
      type: "email",
      config_json: { recipients: ["user@example.com", "user2@example.com"] },
    };
    const request = new NextRequest("http://localhost/api/admin/notifications/channels", {
      method: "POST",
      body: JSON.stringify(body),
    });

    (pool.query as any).mockResolvedValueOnce([{ insertId: 2 }, []]);

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.channel.type).toBe("email");
  });
});

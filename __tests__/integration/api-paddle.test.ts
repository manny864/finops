import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

// Mock database pool
vi.mock("@/modules/storage/db", () => ({
  default: {
    getConnection: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue([]),
      query: vi.fn().mockResolvedValue([[]]),
      release: vi.fn(),
      // El ciclo de vida del tenant (MEJ-12) corre en transacción, igual que
      // una conexión real de mysql2.
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    })),
    query: vi.fn().mockResolvedValue([[]]),
  },
}));

// Mock requestAuth
vi.mock("@/lib/requestAuth", () => ({
  requireTenantRole: vi.fn(async () => ({
    tenantId: "test-tenant",
    claims: { tid: "test-tenant" },
    email: "test@example.com",
    isCorporateDomain: false,
  })),
  requireTenantAccess: vi.fn(async () => ({
    tenantId: "test-tenant",
    claims: { tid: "test-tenant" },
    email: "test@example.com",
    isCorporateDomain: false,
  })),
}));

// Mock paddleTierMap
vi.mock("@/lib/paddleTierMap", () => ({
  priceIdToTier: vi.fn((priceId: string) => {
    if (priceId.includes("essential")) return "Essential";
    if (priceId.includes("pro")) return "Professional";
    if (priceId.includes("business")) return "Business";
    return null;
  }),
  tierToPriceId: vi.fn(() => "pri_test_123"),
  getPaddleBaseUrl: vi.fn(() => "https://sandbox-api.paddle.com"),
}));

describe("Paddle Webhooks API", () => {
  const secret = "test-secret-key";
  let POST: any;

  beforeEach(() => {
    process.env.PADDLE_WEBHOOK_SECRET = secret;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
  });

  const createSignature = (timestamp: number, body: string) => {
    const payloadToSign = `${timestamp}:${body}`;
    const hmac = crypto.createHmac("sha256", secret);
    return hmac.update(payloadToSign).digest("hex");
  };

  const createWebhookRequest = async (eventType: string, data: any, includeSignature = true) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      event_type: eventType,
      data: {
        id: "sub_123",
        status: "active",
        custom_data: { tenant_id: "test-tenant" },
        ...data,
      },
    });

    const init: RequestInit = {
      method: "POST",
      body,
    };

    if (includeSignature) {
      const h1 = createSignature(timestamp, body);
      init.headers = {
        "paddle-signature": `ts=${timestamp};h1=${h1}`,
        "content-type": "application/json",
      };
    }

    return new NextRequest("http://localhost/api/webhooks/paddle", init);
  };

  describe("Webhook signature verification", () => {
    it("returns 401 for request without paddle-signature header", async () => {
      // Dynamically import to avoid module loading issues
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const request = await createWebhookRequest("subscription.created", {}, false);
      // Remove signature header manually if it exists
      const init: RequestInit = {
        method: "POST",
        body: JSON.stringify({ event_type: "subscription.created", data: {} }),
      };
      const noSigRequest = new NextRequest("http://localhost/api/webhooks/paddle", init);
      
      const response = await POST(noSigRequest);
      expect(response.status).toBe(401);
    });

    it("returns 401 for stale timestamps (> 5 min)", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const oldTimestamp = Math.floor(Date.now() / 1000) - 6 * 60; // 6 minutes ago
      const body = JSON.stringify({
        event_type: "subscription.created",
        data: { custom_data: { tenant_id: "test-tenant" } },
      });
      const h1 = createSignature(oldTimestamp, body);

      const request = new NextRequest("http://localhost/api/webhooks/paddle", {
        method: "POST",
        body,
        headers: {
          "paddle-signature": `ts=${oldTimestamp};h1=${h1}`,
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(401);
    });

    it("returns 401 for invalid HMAC signature", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        event_type: "subscription.created",
        data: { custom_data: { tenant_id: "test-tenant" } },
      });

      const request = new NextRequest("http://localhost/api/webhooks/paddle", {
        method: "POST",
        body,
        headers: {
          "paddle-signature": `ts=${timestamp};h1=invalid_signature`,
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(401);
    });

    it("returns 400 for invalid JSON payload", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const timestamp = Math.floor(Date.now() / 1000);
      const body = "invalid json{";
      const h1 = createSignature(timestamp, body);

      const request = new NextRequest("http://localhost/api/webhooks/paddle", {
        method: "POST",
        body,
        headers: {
          "paddle-signature": `ts=${timestamp};h1=${h1}`,
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });
  });

  describe("subscription.created event", () => {
    it("processes event with valid signature and custom_data", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const request = await createWebhookRequest("subscription.created", {
        status: "active",
        items: [{ price: { id: "pri_pro_monthly" } }],
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it("returns 200 when no tenant_id in custom_data", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        event_type: "subscription.created",
        data: { status: "active" },
      });
      const h1 = createSignature(timestamp, body);

      const request = new NextRequest("http://localhost/api/webhooks/paddle", {
        method: "POST",
        body,
        headers: {
          "paddle-signature": `ts=${timestamp};h1=${h1}`,
        },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toContain("Ignored");
    });
  });

  describe("transaction.completed event", () => {
    it("logs transaction with tenant association", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const request = await createWebhookRequest("transaction.completed", {
        subscription_id: "sub_123",
        currency_code: "USD",
        billed_at: "2024-01-01T00:00:00Z",
        details: { totals: { subtotal: "9999" } },
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe("transaction.payment_failed event", () => {
    it("logs failed payment", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const request = await createWebhookRequest("transaction.payment_failed", {
        subscription_id: "sub_123",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe("subscription.canceled event", () => {
    it("marks subscription as canceled", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const request = await createWebhookRequest("subscription.canceled", {});
      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });

  describe("subscription.past_due event", () => {
    it("marks subscription as PAST_DUE", async () => {
      const { POST } = await import("@/app/api/webhooks/paddle/route");

      const request = await createWebhookRequest("subscription.past_due", {});
      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });
});

describe("Billing API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PADDLE_API_KEY = "pdl_sdbx_test123";
  });

  describe("POST /api/billing/subscription - PATCH", () => {
    it("returns 400 without tenantId", async () => {
      const { PATCH } = await import("@/app/api/billing/subscription/route");
      const request = new NextRequest("http://localhost/api/billing/subscription", {
        method: "PATCH",
        body: JSON.stringify({ newTier: "Professional", billing: "monthly" }),
        headers: { authorization: "Bearer token" },
      });
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 with invalid tier", async () => {
      const { PATCH } = await import("@/app/api/billing/subscription/route");
      const request = new NextRequest("http://localhost/api/billing/subscription?tenantId=test", {
        method: "PATCH",
        body: JSON.stringify({ newTier: "InvalidTier", billing: "monthly" }),
        headers: { authorization: "Bearer token" },
      });
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });
  });

  describe("DELETE /api/billing/subscription", () => {
    it("returns 400 without tenantId", async () => {
      const { DELETE: deleteHandler } = await import("@/app/api/billing/subscription/route");
      const request = new NextRequest("http://localhost/api/billing/subscription", {
        method: "DELETE",
        body: JSON.stringify({ effective: "immediately" }),
        headers: { authorization: "Bearer token" },
      });
      const response = await deleteHandler(request);
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/billing/invoices", () => {
    it("returns 400 without tenantId", async () => {
      const { GET } = await import("@/app/api/billing/invoices/route");
      const request = new NextRequest("http://localhost/api/billing/invoices", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      });
      const response = await GET(request);
      expect(response.status).toBe(400);
    });
  });
});

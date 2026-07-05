import { describe, it, expect, beforeEach, vi } from "vitest";
import { notifyTenant, sendWebhookAlert, NotificationPayload } from "@/lib/notifications";
import pool from "@/modules/storage/db";

// Mock pool
vi.mock("@/modules/storage/db", () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock fetch
global.fetch = vi.fn();

// El canal de email de Alertas Self-Service envía vía Microsoft Graph
// (emailHelper.ts), no SMTP/nodemailer.
vi.mock("@/lib/emailHelper", () => ({
  sendEmailAsync: vi.fn().mockResolvedValue(undefined),
}));

describe("notifyTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty results when no channels are configured", async () => {
    (pool.query as any).mockResolvedValueOnce([[], []]);
    (pool.query as any).mockResolvedValueOnce([[], []]);

    const result = await notifyTenant("tenant123", {
      title: "Test",
      message: "Test message",
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it("should filter by severity correctly", async () => {
    const channels = [
      {
        id: 1,
        type: "slack",
        name: "Slack",
        config_json: '{"webhook_url":"https://hooks.slack.com/..."}',
        severity_filter: "error",
      },
    ];

    (pool.query as any).mockResolvedValueOnce([channels, []]);

    const result = await notifyTenant("tenant123", {
      title: "Warning",
      message: "This is a warning",
      severity: "warning",
    });

    // Should not send because channel filters for "error" only
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain("Severity not in filter");
  });

  it("should send to multiple channels with Promise.allSettled", async () => {
    const channels = [
      {
        id: 1,
        type: "slack",
        name: "Slack",
        config_json: '{"webhook_url":"https://hooks.slack.com/services/test"}',
        severity_filter: "info,warning,error",
      },
      {
        id: 2,
        type: "teams",
        name: "Teams",
        config_json: '{"webhook_url":"https://outlook.webhook.office.com/..."}',
        severity_filter: "info,warning,error",
      },
    ];

    (pool.query as any).mockResolvedValueOnce([channels, []]);
    (pool.query as any).mockResolvedValueOnce(undefined);
    (pool.query as any).mockResolvedValueOnce(undefined);
    (global.fetch as any).mockResolvedValue(new Response("OK", { status: 200 }));

    const result = await notifyTenant("tenant123", {
      title: "Test",
      message: "Test message",
      severity: "info",
    });

    expect(result.sent).toBeGreaterThan(0);
  });

  it("should handle channel send errors without aborting others", async () => {
    const channels = [
      {
        id: 1,
        type: "slack",
        name: "Slack",
        config_json: '{"webhook_url":"https://hooks.slack.com/..."}',
        severity_filter: "info,warning,error",
      },
      {
        id: 2,
        type: "teams",
        name: "Teams",
        config_json: '{"webhook_url":"https://outlook.webhook.office.com/..."}',
        severity_filter: "info,warning,error",
      },
    ];

    (pool.query as any).mockResolvedValueOnce([channels, []]);
    (pool.query as any).mockResolvedValueOnce(undefined);
    (pool.query as any).mockResolvedValueOnce(undefined);

    // First fetch fails, second succeeds
    (global.fetch as any)
      .mockResolvedValueOnce(new Response("Error", { status: 500 }))
      .mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const result = await notifyTenant("tenant123", {
      title: "Test",
      message: "Test message",
    });

    // Should have 1 success and 1 failure
    expect(result.sent + result.failed).toBe(2);
  });
});

describe("sendWebhookAlert (backward compatibility)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should still work via legacy signature", async () => {
    (pool.query as any).mockResolvedValueOnce([[], []]);
    (pool.query as any).mockResolvedValueOnce([[], []]);

    // Should not throw
    await sendWebhookAlert("tenant123", "Title", "Message", "warning");

    // Should call notifyTenant internally (verified by pool being called)
    expect(pool.query).toHaveBeenCalled();
  });

  it("should send to webhook_url if no channels configured", async () => {
    const tenants = [{ webhook_url: "https://hooks.slack.com/services/..." }];

    (pool.query as any)
      .mockResolvedValueOnce([[], []]) // No channels
      .mockResolvedValueOnce([tenants, []]) // Webhook URL fallback
      .mockResolvedValueOnce(undefined); // Log insert

    (global.fetch as any).mockResolvedValue(new Response("OK", { status: 200 }));

    await sendWebhookAlert("tenant123", "Title", "Message");

    // fetch should be called with webhook URL
    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/...",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });
});

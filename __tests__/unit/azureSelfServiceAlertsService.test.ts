import { describe, it, expect } from "vitest";
import {
  formatAlertThreshold,
  computeAlertsSummaryMetrics,
  generateAlertTestPayloadPreview,
  testAlertRuleDelivery,
  getMockSelfServiceAlertsPayload,
  assembleLiveSelfServiceAlerts,
} from "@/services/azureSelfServiceAlerts.service";
import { SelfServiceAlertRule } from "@/types/azureSelfServiceAlerts.types";

describe("azureSelfServiceAlerts.service", () => {
  describe("formatAlertThreshold", () => {
    it("formats BUDGET threshold with % and suffix", () => {
      expect(formatAlertThreshold("BUDGET", 80, "PERCENT")).toBe("80.0% del Presupuesto");
      expect(formatAlertThreshold("BUDGET", 95.5, "PERCENT")).toBe("95.5% del Presupuesto");
    });

    it("formats FIXED_THRESHOLD with USD currency", () => {
      expect(formatAlertThreshold("FIXED_THRESHOLD", 500, "USD")).toBe("$500.00 USD");
      expect(formatAlertThreshold("FIXED_THRESHOLD", 250000, "USD")).toBe("$250,000.00 USD");
    });

    it("formats ANOMALY_PERCENT with + and daily deviation suffix", () => {
      expect(formatAlertThreshold("ANOMALY_PERCENT", 25, "PERCENT")).toBe("+25.0% Desvío Diario");
    });

    it("formats FORECAST_OVERRUN with % and Forecast EOM suffix", () => {
      expect(formatAlertThreshold("FORECAST_OVERRUN", 110, "PERCENT")).toBe("110.0% Forecast EOM");
    });
  });

  describe("computeAlertsSummaryMetrics", () => {
    const sampleRules: SelfServiceAlertRule[] = [
      {
        id: "r1",
        name: "Presupuesto 80%",
        alertType: "BUDGET",
        scopeType: "TENANT",
        scopeValue: "Tenant",
        thresholdValue: 80,
        thresholdUnit: "PERCENT",
        formattedThreshold: "80.0% del Presupuesto",
        notificationChannel: "TEAMS",
        channelConfig: { webhookUrl: "https://teams" },
        isEnabled: true,
        fireCount: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "r2",
        name: "Umbral $500",
        alertType: "FIXED_THRESHOLD",
        scopeType: "SUBSCRIPTION",
        scopeValue: "Sub-1",
        thresholdValue: 500,
        thresholdUnit: "USD",
        formattedThreshold: "$500.00 USD",
        notificationChannel: "SLACK",
        channelConfig: { webhookUrl: "https://slack" },
        isEnabled: false,
        fireCount: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "r3",
        name: "Anomalía 20%",
        alertType: "ANOMALY_PERCENT",
        scopeType: "RESOURCE_GROUP",
        scopeValue: "rg-1",
        thresholdValue: 20,
        thresholdUnit: "PERCENT",
        formattedThreshold: "+20.0% Desvío Diario",
        notificationChannel: "EMAIL",
        channelConfig: { recipients: ["admin@test.com"] },
        isEnabled: true,
        fireCount: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    it("accurately calculates total, active, and paused rules count", () => {
      const metrics = computeAlertsSummaryMetrics(sampleRules);
      expect(metrics.totalRulesCount).toBe(3);
      expect(metrics.activeRulesCount).toBe(2);
      expect(metrics.pausedRulesCount).toBe(1);
    });

    it("calculates total fired events and unique channels", () => {
      const metrics = computeAlertsSummaryMetrics(sampleRules);
      expect(metrics.totalFiredEventsLast30Days).toBe(10);
      expect(metrics.uniqueChannelsCount).toBe(3);
    });
  });

  describe("generateAlertTestPayloadPreview and testAlertRuleDelivery", () => {
    const testRule: SelfServiceAlertRule = {
      id: "r-test",
      name: "Test Teams Alert",
      alertType: "BUDGET",
      scopeType: "TENANT",
      scopeValue: "Tenant Completo",
      thresholdValue: 85,
      thresholdUnit: "PERCENT",
      formattedThreshold: "85.0% del Presupuesto",
      notificationChannel: "TEAMS",
      channelConfig: { channelTarget: "https://outlook.office.com/webhook" },
      isEnabled: true,
      fireCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it("generates structured Adaptive Card payload for Teams", () => {
      const payload = generateAlertTestPayloadPreview(testRule);
      expect(payload.type).toBe("message");
      expect(payload.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    });

    it("simulates successful delivery in mock mode", async () => {
      const result = await testAlertRuleDelivery(testRule, true);
      expect(result.success).toBe(true);
      expect(result.httpStatusCode).toBe(200);
      expect(result.responseMessage).toContain("SIMULACIÓN DEMO");
    });
  });

  describe("getMockSelfServiceAlertsPayload & assembleLiveSelfServiceAlerts", () => {
    it("generates deterministic mock payload for enterprise tenant", () => {
      const payload = getMockSelfServiceAlertsPayload("demo-4444");
      expect(payload.source).toBe("mock");
      expect(payload.metrics.totalRulesCount).toBe(5);
      expect(payload.metrics.rules.length).toBe(5);
    });

    it("assembles live alerts payload with live source flag", () => {
      const livePayload = assembleLiveSelfServiceAlerts([]);
      expect(livePayload.source).toBe("live");
      expect(livePayload.metrics.totalRulesCount).toBe(0);
    });
  });
});

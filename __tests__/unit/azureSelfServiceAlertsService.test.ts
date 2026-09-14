import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
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

    /*
     * `responseMessage` sale del servicio en castellano — es lo que se loguea —
     * y la pantalla muestra `messageKey`. Sin este test, una rama que devuelva
     * solo `responseMessage` (o una clave mal tipeada) no falla en ningun lado:
     * next-intl no rompe el build, tira MISSING_MESSAGE en runtime y el usuario
     * lee "SelfServiceAlerts.testXxx" en el modal.
     */
    describe("messageKey de cada rama", () => {
      const catalogos = (["es", "en", "pt-BR"] as const).map(
        (l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, "utf8")).SelfServiceAlerts] as const
      );

      const esperarClaveUsable = (result: { messageKey?: string }) => {
        expect(result.messageKey, "la rama no devolvio messageKey").toBeTruthy();
        for (const [locale, ns] of catalogos) {
          expect(typeof ns?.[result.messageKey!], `${result.messageKey} falta en ${locale}`).toBe("string");
        }
      };

      afterEach(() => vi.restoreAllMocks());

      it("demo", async () => esperarClaveUsable(await testAlertRuleDelivery(testRule, true)));

      it("canal sin URL HTTP", async () =>
        esperarClaveUsable(
          await testAlertRuleDelivery(
            { ...testRule, notificationChannel: "EMAIL", channelConfig: { channelTarget: "ops@empresa.com" } },
            false
          )
        ));

      it("endpoint OK y endpoint con error", async () => {
        for (const [ok, status] of [[true, 200], [false, 500]] as const) {
          vi.spyOn(global, "fetch").mockResolvedValue({ ok, status, statusText: "X" } as Response);
          esperarClaveUsable(await testAlertRuleDelivery(testRule, false));
          vi.restoreAllMocks();
        }
      });

      it("fallo de conexion", async () => {
        vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
        esperarClaveUsable(await testAlertRuleDelivery(testRule, false));
      });
    });

    describe("canal EMAIL: despacho real, remitente y validación", () => {
      const emailRule: SelfServiceAlertRule = {
        id: "r-email",
        name: "Alerta Presupuesto FinOps",
        alertType: "BUDGET",
        scopeType: "RESOURCE_GROUP",
        scopeValue: "rg-produccion",
        thresholdValue: 90,
        thresholdUnit: "PERCENT",
        formattedThreshold: "90.0% del Presupuesto",
        notificationChannel: "EMAIL",
        channelConfig: { channelTarget: "admin@empresa.com, devops@empresa.com" },
        isEnabled: true,
        fireCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      it("genera preview con remitente alerts@cscloudsolutions.com.ar y disclaimer no-reply", () => {
        const preview = generateAlertTestPayloadPreview(emailRule, "es");
        expect(preview.from).toBe("alerts@cscloudsolutions.com.ar");
        expect(preview.to).toEqual(["admin@empresa.com, devops@empresa.com"]);
        expect(preview.subject).toContain("Alerta Presupuesto FinOps");
        expect(preview.disclaimer).toContain("alerts@cscloudsolutions.com.ar");
        expect(preview.disclaimer).toContain("soporte@cscloudsolutions.com.ar");
      });

      it("prioriza AZURE_SENDER_EMAIL_ALERTS sobre AZURE_SENDER_EMAIL si ambas están definidas", () => {
        const originalAlerts = process.env.AZURE_SENDER_EMAIL_ALERTS;
        const originalGeneral = process.env.AZURE_SENDER_EMAIL;
        try {
          process.env.AZURE_SENDER_EMAIL_ALERTS = "custom-alerts@cscloudsolutions.com.ar";
          process.env.AZURE_SENDER_EMAIL = "sales@cscloudsolutions.com.ar";

          const preview = generateAlertTestPayloadPreview(emailRule, "es");
          expect(preview.from).toBe("custom-alerts@cscloudsolutions.com.ar");
        } finally {
          if (originalAlerts !== undefined) {
            process.env.AZURE_SENDER_EMAIL_ALERTS = originalAlerts;
          } else {
            delete process.env.AZURE_SENDER_EMAIL_ALERTS;
          }
          if (originalGeneral !== undefined) {
            process.env.AZURE_SENDER_EMAIL = originalGeneral;
          } else {
            delete process.env.AZURE_SENDER_EMAIL;
          }
        }
      });

      it("despacha correo a todos los destinatarios válidos vía sendEmailStrict con remitente alerts@ y disclaimer", async () => {
        const emailHelper = await import("@/lib/emailHelper");
        const spySend = vi.spyOn(emailHelper, "sendEmailStrict").mockResolvedValue();

        const res = await testAlertRuleDelivery(emailRule, false, "es");

        expect(res.success).toBe(true);
        expect(res.httpStatusCode).toBe(200);
        expect(res.responseMessage).toContain("admin@empresa.com");
        expect(res.responseMessage).toContain("devops@empresa.com");
        expect(res.responseMessage).toContain("alerts@cscloudsolutions.com.ar");
        expect(spySend).toHaveBeenCalledTimes(2);
        expect(spySend).toHaveBeenCalledWith(
          expect.stringContaining("Alerta Presupuesto FinOps"),
          expect.stringContaining("alerts@cscloudsolutions.com.ar"),
          "admin@empresa.com"
        );
        expect(spySend).toHaveBeenCalledWith(
          expect.stringContaining("Alerta Presupuesto FinOps"),
          expect.stringContaining("soporte@cscloudsolutions.com.ar"),
          "admin@empresa.com"
        );
      });

      it("genera templates e inspección en idioma inglés (en)", async () => {
        const emailHelper = await import("@/lib/emailHelper");
        const spySend = vi.spyOn(emailHelper, "sendEmailStrict").mockResolvedValue();
        spySend.mockClear();

        const res = await testAlertRuleDelivery(emailRule, false, "en");
        expect(res.success).toBe(true);
        expect(res.responseMessage).toContain("Test email successfully sent to");
        expect(res.responseMessage).toContain("alerts@cscloudsolutions.com.ar");

        expect(spySend).toHaveBeenCalledWith(
          expect.stringContaining("[FinOps Alert Test]"),
          expect.stringContaining("The alerts@cscloudsolutions.com.ar account is a send-only mailbox"),
          "admin@empresa.com"
        );
      });

      it("genera templates e inspección en idioma portugués (pt-BR)", async () => {
        const emailHelper = await import("@/lib/emailHelper");
        const spySend = vi.spyOn(emailHelper, "sendEmailStrict").mockResolvedValue();
        spySend.mockClear();

        const res = await testAlertRuleDelivery(emailRule, false, "pt-BR");
        expect(res.success).toBe(true);
        expect(res.responseMessage).toContain("E-mail de teste enviado com sucesso para");
        expect(res.responseMessage).toContain("alerts@cscloudsolutions.com.ar");

        expect(spySend).toHaveBeenCalledWith(
          expect.stringContaining("[Teste de Alerta FinOps]"),
          expect.stringContaining("A conta alerts@cscloudsolutions.com.ar é uma caixa postal exclusiva para envio"),
          "admin@empresa.com"
        );
      });

      it("incluye el disclaimer en todos los canales (Teams, Slack, ServiceNow, Webhook)", () => {
        const channels = ["TEAMS", "SLACK", "SERVICENOW", "WEBHOOK"] as const;
        for (const ch of channels) {
          const preview = generateAlertTestPayloadPreview(
            { ...emailRule, notificationChannel: ch },
            "es"
          );
          const previewStr = JSON.stringify(preview);
          expect(previewStr).toContain("alerts@cscloudsolutions.com.ar");
          expect(previewStr).toContain("soporte@cscloudsolutions.com.ar");
        }
      });

      it("rechaza destinos vacíos o sin correo válido con HTTP 400", async () => {
        const res = await testAlertRuleDelivery(
          { ...emailRule, channelConfig: { channelTarget: "   " } },
          false,
          "es"
        );
        expect(res.success).toBe(false);
        expect(res.httpStatusCode).toBe(400);
        expect(res.responseMessage).toContain("No se especificó ninguna dirección de correo válida");
      });

      it("propaga el error de Microsoft Graph con HTTP 500 cuando el envío falla", async () => {
        const emailHelper = await import("@/lib/emailHelper");
        vi.spyOn(emailHelper, "sendEmailStrict").mockRejectedValue(new Error("Graph API: Mail.Send permission required"));

        const res = await testAlertRuleDelivery(emailRule, false, "es");
        expect(res.success).toBe(false);
        expect(res.httpStatusCode).toBe(500);
        expect(res.responseMessage).toContain("Mail.Send permission required");
      });
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

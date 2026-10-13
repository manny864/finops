// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ recordar: vi.fn(), consulta: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({
  default: { getConnection: async () => ({ query: m.consulta, release: vi.fn() }) },
  initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("@/services/tenantLifecycle.service", () => ({ recordTenantLifecycleTransition: vi.fn() }));
vi.mock("@/lib/emailHelper", () => ({ sendEmailAsync: vi.fn(), getSubscriptionEndedEmailHtml: vi.fn(() => "") }));
vi.mock("@/services/cancellationRequests.service", () => ({ recordarSolicitudesPendientes: m.recordar }));

import { GET } from "@/app/api/cron/subscription-expiry/route";

const llamar = () => GET(new NextRequest("http://localhost/api/cron/subscription-expiry", { headers: { authorization: "Bearer un-secreto-de-prueba-largo" } }));

beforeEach(() => {
  process.env.CRON_SECRET = "un-secreto-de-prueba-largo";
  m.recordar.mockReset().mockResolvedValue({ recordadas: 2 });
  m.consulta.mockReset().mockResolvedValue([[]]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("el cron diario de vencimientos también recuerda las cancelaciones pendientes", () => {
  it("las recuerda y lo informa", async () => {
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(m.recordar).toHaveBeenCalledTimes(1);
    expect(await r.json()).toMatchObject({ success: true, cancellationRemindersSent: 2 });
  });

  it("si el recordatorio falla, el vencimiento de accesos igual termina bien", async () => {
    m.recordar.mockRejectedValue(new Error("Graph caído"));
    const r = await llamar();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ success: true, cancellationRemindersSent: 0 });
  });

  it("sin el secreto del cron no recuerda nada", async () => {
    const r = await GET(new NextRequest("http://localhost/api/cron/subscription-expiry"));
    expect(r.status).toBe(401);
    expect(m.recordar).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vitest";
import { getTenantNotifications, markNotificationAsRead } from "@/services/tenantNotifications.service";

describe("MEJ-11 (Fase 2): Canal 3 de Comunicaciones (SYSTEM_BROADCAST en notificaciones)", () => {
  it("getTenantNotifications en modo demo incluye un aviso global de tipo SYSTEM_BROADCAST", async () => {
    const res = await getTenantNotifications("demo-tenant-1", 10, false, "demo@cscloud.com");

    expect(res.success).toBe(true);
    expect(res.notifications.length).toBeGreaterThan(0);

    const broadcast = res.notifications.find((n) => n.type === "SYSTEM_BROADCAST");
    expect(broadcast).toBeDefined();
    expect(broadcast?.title).toContain("Aviso Global");
    expect(broadcast?.severity).toBe("info");
    expect(broadcast?.isRead).toBe(false);
  });

  it("markNotificationAsRead marca como leída la notificación en modo demo", async () => {
    const res = await markNotificationAsRead({
      tenantId: "demo-tenant-1",
      notificationId: "mock-notif-00",
    });

    expect(res.success).toBe(true);
    expect(res.updatedCount).toBeGreaterThanOrEqual(1);

    const after = await getTenantNotifications("demo-tenant-1", 10, false, "demo@cscloud.com");
    const item = after.notifications.find((n) => String(n.id) === "mock-notif-00");
    expect(item?.isRead).toBe(true);
  });
});

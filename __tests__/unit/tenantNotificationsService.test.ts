import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTenantNotifications,
  markNotificationAsRead,
  deleteNotification,
  formatTimeAgo,
} from "@/services/tenantNotifications.service";
import pool from "@/modules/storage/db";

vi.mock("@/modules/storage/db", () => ({
  default: {
    query: vi.fn(),
  },
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("Tenant Notifications Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("formatTimeAgo", () => {
    it("should format recent dates correctly", () => {
      const now = new Date();
      expect(formatTimeAgo(now.toISOString())).toBe("Ahora");

      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(formatTimeAgo(fiveMinsAgo.toISOString())).toBe("Hace 5 min");

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatTimeAgo(twoHoursAgo.toISOString())).toBe("Hace 2 h");
    });
  });

  describe("getTenantNotifications", () => {
    it("should return demo notifications for mock/demo tenant", async () => {
      const result = await getTenantNotifications("demo-tenant-123");
      expect(result.success).toBe(true);
      expect(result.notifications.length).toBeGreaterThanOrEqual(3);
      expect(result.unreadCount).toBeGreaterThan(0);
      expect(result.notifications[0].type).toBe("REPORT_READY");
      expect(result.notifications[1].type).toBe("ANOMALY_DETECTED");
    });

    it("should query MySQL and map rows for real tenant", async () => {
      vi.mocked(pool.query).mockImplementation(async (sql: string) => {
        if (sql.includes("COUNT(*)")) {
          return [[{ unread: 2 }]] as any;
        }
        return [
          [
            {
              id: 101,
              tenant_id: "real-tenant-01",
              title: "Reporte de Costos Listo",
              message: "Tu reporte mensual FOCUS está disponible",
              action_url: "/reports/executive",
              severity: "info",
              source: "REPORT_JOB",
              created_at: new Date().toISOString(),
              is_read: 0,
              type: "REPORT_READY",
            },
            {
              id: 102,
              tenant_id: "real-tenant-01",
              title: "Anomalía en VMs",
              message: "Gasto +35% en 24h",
              action_url: "/analytics/anomalies",
              severity: "warning",
              source: "ANOMALY_ENGINE",
              created_at: new Date().toISOString(),
              is_read: 1,
              type: "ANOMALY_DETECTED",
            },
          ],
        ] as any;
      });

      const result = await getTenantNotifications("real-tenant-01");
      expect(result.success).toBe(true);
      expect(result.unreadCount).toBe(2);
      expect(result.notifications).toHaveLength(2);
      expect(result.notifications[0].type).toBe("REPORT_READY");
      expect(result.notifications[0].isRead).toBe(false);
      expect(result.notifications[1].isRead).toBe(true);
    });
  });

  describe("markNotificationAsRead", () => {
    it("should update demo in-memory state for mock tenant", async () => {
      const initial = await getTenantNotifications("demo-tenant-mark");
      const targetId = initial.notifications[0].id;

      const res = await markNotificationAsRead({
        tenantId: "demo-tenant-mark",
        notificationId: targetId,
      });
      expect(res.success).toBe(true);

      const after = await getTenantNotifications("demo-tenant-mark");
      const target = after.notifications.find((n) => n.id === targetId);
      expect(target?.isRead).toBe(true);
    });

    it("should execute UPDATE query for real tenant", async () => {
      vi.mocked(pool.query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);

      const res = await markNotificationAsRead({
        tenantId: "real-tenant-01",
        notificationId: 101,
      });
      expect(res.success).toBe(true);
      expect(res.updatedCount).toBe(1);
    });
  });

  describe("deleteNotification", () => {
    it("should delete notification from demo state for mock tenant", async () => {
      const initial = await getTenantNotifications("demo-tenant-del");
      const targetId = initial.notifications[0].id;
      const initialCount = initial.notifications.length;

      const res = await deleteNotification("demo-tenant-del", targetId);
      expect(res.success).toBe(true);

      const after = await getTenantNotifications("demo-tenant-del");
      expect(after.notifications.length).toBe(initialCount - 1);
    });

    it("should execute DELETE query for real tenant", async () => {
      vi.mocked(pool.query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);

      const res = await deleteNotification("real-tenant-01", 101);
      expect(res.success).toBe(true);
    });
  });
});

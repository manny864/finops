/**
 * Servicio de Notificaciones In-App Multi-Tenant (TenantNotificationsService).
 *
 * Soporta:
 *  - Aislamiento Mock vs Real (Tenants Demo sirven 3 notificaciones reactivas de ejemplo).
 *  - Lectura paginada con conteo de no leídas.
 *  - Marcado individual o masivo como leída.
 *  - Eliminación de notificaciones del historial.
 */

import pool, { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import type {
  TenantNotificationItem,
  NotificationSummaryResponse,
  NotificationEventType,
} from "@/types/tenantNotifications.types";

export function formatTimeAgo(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "Hace un momento";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Ahora";
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours === 1) return "Hace 1 hora";
  if (diffHours < 24) return `Hace ${diffHours} h`;
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays} días`;
  return date.toLocaleDateString("es-AR", { month: "short", day: "numeric" });
}

// Almacén en memoria para estado de lectura en tenants Demo
const demoMockState: Record<string, TenantNotificationItem[]> = {};

function getDemoNotifications(tenantId: string): TenantNotificationItem[] {
  if (!demoMockState[tenantId]) {
    demoMockState[tenantId] = [
      {
        id: "mock-notif-01",
        tenantId,
        type: "REPORT_READY",
        title: "Reporte Ejecutivo FinOps Q3 Generado",
        message: "El análisis mensual con desglose FOCUS 1.1 y recomendaciones IA ya está disponible para descarga.",
        actionUrl: "/reports/executive",
        isRead: false,
        readAtIso: null,
        createdAtIso: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        formattedTimeAgo: "Hace 5 min",
        severity: "info",
      },
      {
        id: "mock-notif-02",
        tenantId,
        type: "ANOMALY_DETECTED",
        title: "Desvío inusual en Virtual Machines (East US)",
        message: "Se detectó un incremento de gasto del +48% en las últimas 24 h.",
        actionUrl: "/analytics/anomalies",
        isRead: false,
        readAtIso: null,
        createdAtIso: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        formattedTimeAgo: "Hace 45 min",
        severity: "warning",
      },
      {
        id: "mock-notif-03",
        tenantId,
        type: "SYSTEM_ALERT",
        title: "Recursos Zombis Detectados",
        message: "Identificados $124/mes de gasto ocioso en discos y snapshots huérfanos.",
        actionUrl: "/cleanup/zombies",
        isRead: false,
        readAtIso: null,
        createdAtIso: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        formattedTimeAgo: "Hace 3 h",
        severity: "critical",
      },
    ];
  }
  return demoMockState[tenantId];
}

/**
 * Obtiene el resumen de notificaciones in-app y el conteo de no leídas para un tenant.
 */
export async function getTenantNotifications(
  tenantId: string,
  limit = 20,
  unreadOnly = false
): Promise<NotificationSummaryResponse> {
  if (isMockTenant(tenantId)) {
    const items = getDemoNotifications(tenantId);
    const filtered = unreadOnly ? items.filter((n) => !n.isRead) : items;
    const unreadCount = items.filter((n) => !n.isRead).length;
    return {
      success: true,
      unreadCount,
      totalCount: items.length,
      notifications: filtered.slice(0, limit),
    };
  }

  await initializeDatabase();

  try {
    // 1. Obtener conteo de no leídas
    let unreadCount = 0;
    try {
      const [countRows]: any = await pool.query(
        "SELECT COUNT(*) as unread FROM Notifications WHERE tenant_id = ? AND (is_read = FALSE OR is_read = 0 OR is_read IS NULL)",
        [tenantId]
      );
      unreadCount = Number(countRows?.[0]?.unread || 0);
    } catch {
      unreadCount = 0;
    }

    // 2. Obtener lista de notificaciones
    const whereClause = unreadOnly
      ? "WHERE tenant_id = ? AND (is_read = FALSE OR is_read = 0 OR is_read IS NULL)"
      : "WHERE tenant_id = ?";

    const [rows]: any = await pool.query(
      `SELECT id, tenant_id, title, message, 
              COALESCE(href, action_url) as actionUrl,
              severity, source, created_at,
              COALESCE(is_read, 0) as isRead,
              read_at as readAt,
              COALESCE(type, 'SYSTEM_ALERT') as type
       FROM Notifications
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [tenantId, limit]
    );

    const notifications: TenantNotificationItem[] = (rows || []).map((r: any) => {
      let eventType: NotificationEventType = "SYSTEM_ALERT";
      const rawType = String(r.type || r.source || "").toUpperCase();
      if (rawType.includes("REPORT")) eventType = "REPORT_READY";
      else if (rawType.includes("ANOMALY")) eventType = "ANOMALY_DETECTED";
      else if (rawType.includes("CREDENTIAL")) eventType = "CREDENTIAL_EXPIRING";
      else if (rawType.includes("BUDGET")) eventType = "BUDGET_EXCEEDED";

      return {
        id: String(r.id),
        tenantId: String(r.tenant_id),
        type: eventType,
        title: String(r.title || "Notificación de Sistema"),
        message: String(r.message || ""),
        actionUrl: r.actionUrl || undefined,
        isRead: Boolean(r.isRead == 1 || r.isRead === true || r.is_read == 1 || r.is_read === true),
        readAtIso: r.readAt ? new Date(r.readAt).toISOString() : null,
        createdAtIso: new Date(r.created_at || Date.now()).toISOString(),
        formattedTimeAgo: formatTimeAgo(r.created_at),
        severity: r.severity || "info",
      };
    });

    return {
      success: true,
      unreadCount,
      totalCount: notifications.length,
      notifications,
    };
  } catch (err: any) {
    console.error("[tenantNotifications.service] Error obteniendo notificaciones:", err);
    return {
      success: false,
      unreadCount: 0,
      totalCount: 0,
      notifications: [],
    };
  }
}

/**
 * Marca una notificación específica o todas las notificaciones de un tenant como leídas.
 */
export async function markNotificationAsRead(params: {
  tenantId: string;
  notificationId?: string | number;
  markAllAsRead?: boolean;
}): Promise<{ success: boolean; updatedCount: number }> {
  const { tenantId, notificationId, markAllAsRead } = params;

  if (isMockTenant(tenantId)) {
    const items = getDemoNotifications(tenantId);
    let count = 0;
    items.forEach((item) => {
      if (markAllAsRead || String(item.id) === String(notificationId)) {
        if (!item.isRead) count++;
        item.isRead = true;
        item.readAtIso = new Date().toISOString();
      }
    });
    return { success: true, updatedCount: count };
  }

  await initializeDatabase();

  try {
    if (markAllAsRead) {
      const [res]: any = await pool.query(
        "UPDATE Notifications SET is_read = TRUE, read_at = NOW() WHERE tenant_id = ? AND (is_read = FALSE OR is_read = 0 OR is_read IS NULL)",
        [tenantId]
      );
      return { success: true, updatedCount: Number(res?.affectedRows || 0) };
    }

    if (notificationId) {
      const [res]: any = await pool.query(
        "UPDATE Notifications SET is_read = TRUE, read_at = NOW() WHERE tenant_id = ? AND id = ?",
        [tenantId, notificationId]
      );
      return { success: true, updatedCount: Number(res?.affectedRows || 0) };
    }

    return { success: false, updatedCount: 0 };
  } catch (err: any) {
    console.error("[tenantNotifications.service] Error marcando como leída:", err);
    return { success: false, updatedCount: 0 };
  }
}

/**
 * Elimina una notificación del historial.
 */
export async function deleteNotification(
  tenantId: string,
  notificationId: string | number
): Promise<{ success: boolean }> {
  if (isMockTenant(tenantId)) {
    const items = getDemoNotifications(tenantId);
    demoMockState[tenantId] = items.filter((n) => String(n.id) !== String(notificationId));
    return { success: true };
  }

  await initializeDatabase();

  try {
    await pool.query("DELETE FROM Notifications WHERE tenant_id = ? AND id = ?", [
      tenantId,
      notificationId,
    ]);
    return { success: true };
  } catch (err: any) {
    console.error("[tenantNotifications.service] Error eliminando notificación:", err);
    return { success: false };
  }
}

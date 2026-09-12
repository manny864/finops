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
        titleKey: "notif_demo_report_title",
        messageKey: "notif_demo_report_msg",
        actionUrl: "/reports/executive",
        isRead: false,
        readAtIso: null,
        createdAtIso: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        severity: "info",
      },
      {
        id: "mock-notif-02",
        tenantId,
        type: "ANOMALY_DETECTED",
        title: "Desvío inusual en Virtual Machines (East US)",
        message: "Se detectó un incremento de gasto del +48% en las últimas 24 h.",
        titleKey: "notif_demo_anomaly_title",
        messageKey: "notif_demo_anomaly_msg",
        params: { service: "Virtual Machines", region: "East US", pct: 48 },
        actionUrl: "/analytics/anomalies",
        isRead: false,
        readAtIso: null,
        createdAtIso: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        severity: "warning",
      },
      {
        id: "mock-notif-00",
        tenantId,
        type: "SYSTEM_BROADCAST",
        title: "Aviso Global: Ventana de Actualización de Infraestructura",
        message: "Mantenimiento preventivo en la región East US programado para el próximo domingo de 02:00 a 04:00 UTC.",
        actionUrl: "/status",
        isRead: false,
        readAtIso: null,
        createdAtIso: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
        severity: "info",
      },
      {
        id: "mock-notif-03",
        tenantId,
        type: "SYSTEM_ALERT",
        title: "Recursos Zombis Detectados",
        message: "Identificados $124/mes de gasto ocioso en discos y snapshots huérfanos.",
        titleKey: "notif_demo_zombies_title",
        messageKey: "notif_demo_zombies_msg",
        params: { amount: 124 },
        actionUrl: "/cleanup/zombies",
        isRead: false,
        readAtIso: null,
        createdAtIso: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
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
  unreadOnly = false,
  /**
   * MEJ-33 paso 3: email de quien pregunta. Se le muestran los avisos de
   * difusión (`user_email IS NULL`) más los dirigidos A ÉL.
   *
   * Sin este parámetro el filtro cae a "sólo difusión": es la opción segura
   * cuando el caller no sabe quién pregunta — preferimos ocultarle un aviso
   * dirigido antes que mostrarle el de otra persona.
   */
  userEmail?: string | null
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

  // Un solo predicado para el conteo Y el listado: si divergieran, el badge
  // mostraría un número que no se corresponde con la lista.
  const destinatario = userEmail
    ? "(user_email IS NULL OR user_email = ?)"
    : "user_email IS NULL";
  const paramsDestinatario: string[] = userEmail ? [userEmail] : [];

  try {
    // 1. Obtener conteo de no leídas
    let unreadCount = 0;
    try {
      const [countRows]: any = await pool.query(
        `SELECT COUNT(*) as unread FROM Notifications WHERE tenant_id = ? AND ${destinatario} AND (is_read = FALSE OR is_read = 0 OR is_read IS NULL)`,
        [tenantId, ...paramsDestinatario]
      );
      unreadCount = Number(countRows?.[0]?.unread || 0);
    } catch {
      try {
        const [fallbackCount]: any = await pool.query(
          `SELECT COUNT(*) as unread FROM Notifications WHERE tenant_id = ? AND ${destinatario}`,
          [tenantId, ...paramsDestinatario]
        );
        unreadCount = Number(fallbackCount?.[0]?.unread || 0);
      } catch {
        unreadCount = 0;
      }
    }

    // 2. Obtener lista de notificaciones de forma resiliente a cualquier versión del esquema
    let rows: any[] = [];
    try {
      const whereClause = unreadOnly
        ? `WHERE tenant_id = ? AND ${destinatario} AND (is_read = FALSE OR is_read = 0 OR is_read IS NULL)`
        : `WHERE tenant_id = ? AND ${destinatario}`;
      const [res]: any = await pool.query(
        `SELECT * FROM Notifications ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ?`,
        [tenantId, ...paramsDestinatario, limit]
      );
      rows = res || [];
    } catch {
      // Fallback si la columna is_read no existe todavía en el motor
      const [res]: any = await pool.query(
        `SELECT * FROM Notifications WHERE tenant_id = ? AND ${destinatario} ORDER BY created_at DESC, id DESC LIMIT ?`,
        [tenantId, ...paramsDestinatario, limit]
      );
      rows = res || [];
    }

    const notifications: TenantNotificationItem[] = rows.map((r: any) => {
      let eventType: NotificationEventType = "SYSTEM_ALERT";
      const rawType = String(r.type || r.source || "").toUpperCase();
      if (rawType.includes("REPORT")) eventType = "REPORT_READY";
      else if (rawType.includes("ANOMALY")) eventType = "ANOMALY_DETECTED";
      else if (rawType.includes("CREDENTIAL")) eventType = "CREDENTIAL_EXPIRING";
      else if (rawType.includes("BUDGET")) eventType = "BUDGET_EXCEEDED";

      const actionUrl = r.action_url || r.actionUrl || r.href || undefined;
      const isRead = Boolean(r.isRead == 1 || r.isRead === true || r.is_read == 1 || r.is_read === true);

      return {
        id: String(r.id),
        tenantId: String(r.tenant_id),
        type: eventType,
        title: String(r.title || "Notificación de Sistema"),
        message: String(r.message || ""),
        titleKey: r.title_key || null,
        messageKey: r.message_key || null,
        params: r.params_json ?? null,
        actionUrl,
        isRead,
        readAtIso: r.read_at || r.readAt ? new Date(r.read_at || r.readAt).toISOString() : null,
        createdAtIso: new Date(r.created_at || Date.now()).toISOString(),
        severity: r.severity || "info",
      };
    });

    // MEJ-11 Canal 3: Avisos globales de SuperAdmin (SYSTEM_BROADCAST)
    let broadcastNotifications: TenantNotificationItem[] = [];
    try {
      const { getActiveAnnouncementsForTenant } = await import("@/services/systemAnnouncements.service");
      const activeAnnouncements = await getActiveAnnouncementsForTenant(tenantId, userEmail || "anonymous");
      const notifAnnouncements = activeAnnouncements.filter((a) => a.channels.includes("notification"));

      broadcastNotifications = notifAnnouncements.map((a) => {
        const severity: "info" | "warning" | "critical" =
          a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info";
        return {
          id: `broadcast-${a.id}`,
          tenantId,
          type: "SYSTEM_BROADCAST" as NotificationEventType,
          title: a.resolvedTitle || a.title,
          message: a.resolvedMessage || a.message,
          actionUrl: a.actionUrl || undefined,
          isRead: Boolean(a.dismissedByUser),
          readAtIso: a.dismissedByUser ? a.updatedAt : null,
          createdAtIso: a.startsAt || a.createdAt,
          severity,
        };
      });
    } catch {
      // Ignorar fallo de anuncios globales para no romper el centro de notificaciones
    }

    const combined = [...broadcastNotifications, ...notifications];
    const filtered = unreadOnly ? combined.filter((n) => !n.isRead) : combined;
    const totalUnread = unreadCount + broadcastNotifications.filter((n) => !n.isRead).length;

    return {
      success: true,
      unreadCount: totalUnread,
      totalCount: combined.length,
      notifications: filtered.slice(0, limit),
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
  userEmail?: string;
}): Promise<{ success: boolean; updatedCount: number }> {
  const { tenantId, notificationId, markAllAsRead, userEmail } = params;

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

  // Si es un anuncio global broadcast, registrar el descarte para este usuario
  if (notificationId && String(notificationId).startsWith("broadcast-")) {
    try {
      const { recordDismissal } = await import("@/services/systemAnnouncements.service");
      const aId = Number(String(notificationId).replace("broadcast-", ""));
      if (!Number.isNaN(aId)) {
        await recordDismissal(aId, userEmail || "anonymous");
        return { success: true, updatedCount: 1 };
      }
    } catch (e) {
      console.warn("[tenantNotifications.service] Error registrando descarte de broadcast:", e);
    }
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

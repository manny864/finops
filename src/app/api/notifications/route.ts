import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  getTenantNotifications,
  markNotificationAsRead,
  deleteNotification,
} from "@/services/tenantNotifications.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const limit = Number(searchParams.get("limit")) || 20;
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const sinceIdParam = searchParams.get("sinceId");

    if (!tenantId) {
      return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
    }

    // Compatibilidad hacia atrás con el hook legacy useBrowserNotifications si envía sinceId
    if (sinceIdParam !== null) {
      const sinceId = Number(sinceIdParam) || 0;
      if (isMockTenant(tenantId)) {
        return NextResponse.json({ success: true, notifications: [] });
      }

      await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
      await initializeDatabase();

      const [rows] = await pool.query(
        `SELECT id, title, message, href, severity, source, created_at
         FROM Notifications
         WHERE tenant_id = ? AND id > ?
         ORDER BY id DESC LIMIT 20`,
        [tenantId, sinceId]
      );

      return NextResponse.json({ success: true, notifications: rows });
    }

    // Nuevo formato estándar para el Centro Global de Notificaciones
    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    }

    const summary = await getTenantNotifications(tenantId, limit, unreadOnly);
    return NextResponse.json(summary);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[api/notifications] GET error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenantId, notificationId, markAllAsRead } = body;

    if (!tenantId) {
      return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    }

    const result = await markNotificationAsRead({
      tenantId,
      notificationId,
      markAllAsRead: Boolean(markAllAsRead),
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[api/notifications] PATCH error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const notificationId = searchParams.get("id") || searchParams.get("notificationId");

    if (!tenantId || !notificationId) {
      return NextResponse.json(
        { success: false, error: "Faltan parámetros tenantId o id" },
        { status: 400 }
      );
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
    }

    const result = await deleteNotification(tenantId, notificationId);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[api/notifications] DELETE error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

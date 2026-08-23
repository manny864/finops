import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { markNotificationAsRead } from "@/services/tenantNotifications.service";

export const dynamic = "force-dynamic";

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
    console.error("[api/notifications/mark-read] PATCH error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

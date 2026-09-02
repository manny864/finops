import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { recordDismissal } from "@/services/systemAnnouncements.service";

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (isMockTenant(tenantId)) return NextResponse.json({ success: true });

    const identity = await requireTenantAccess(request, tenantId);
    const body = await request.json();
    const announcementId = Number(body?.announcementId);
    if (!Number.isInteger(announcementId)) {
      return NextResponse.json({ error: "announcementId inválido" }, { status: 400 });
    }

    await recordDismissal(announcementId, identity.email);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[api/announcements/dismiss] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

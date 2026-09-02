import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { updateAnnouncement, deleteAnnouncement } from "@/services/systemAnnouncements.service";
import type { UpdateAnnouncementInput } from "@/types/systemAnnouncements.types";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin(request);
    const { id } = await params;
    const announcementId = Number(id);
    if (!Number.isInteger(announcementId)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const body = (await request.json()) as UpdateAnnouncementInput;
    const announcement = await updateAnnouncement(announcementId, body);
    return NextResponse.json({ success: true, announcement });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[api/super-admin/announcements/[id]:PATCH] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin(request);
    const { id } = await params;
    const announcementId = Number(id);
    if (!Number.isInteger(announcementId)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    await deleteAnnouncement(announcementId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[api/super-admin/announcements/[id]:DELETE] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

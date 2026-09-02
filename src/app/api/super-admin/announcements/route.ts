import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { listAnnouncements, createAnnouncement } from "@/services/systemAnnouncements.service";
import type { CreateAnnouncementInput } from "@/types/systemAnnouncements.types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    const announcements = await listAnnouncements();
    return NextResponse.json({ success: true, announcements });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[api/super-admin/announcements:GET] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = await requireSuperAdmin(request);
    const body = (await request.json()) as CreateAnnouncementInput;

    if (!body?.title?.trim() || !body?.message?.trim() || !body?.startsAt || !body?.endsAt) {
      return NextResponse.json({ error: "Faltan campos obligatorios (título, mensaje, ventana de vigencia)." }, { status: 400 });
    }

    const announcement = await createAnnouncement(body, identity.email);
    return NextResponse.json({ success: true, announcement });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[api/super-admin/announcements:POST] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { getActiveAnnouncementsForTenant } from "@/services/systemAnnouncements.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    // Idioma activo de la página. Sin parámetro cae al base dentro del
    // servicio, así que un caller que no lo mande sigue funcionando.
    const locale = searchParams.get("locale") || undefined;

    // Demo/mock: sin anuncios simulados (fuera de alcance, ver MEJ-11 en el
    // backlog) -- se devuelve vacío en vez de tocar la tabla real.
    if (isMockTenant(tenantId)) {
      return NextResponse.json({ success: true, announcements: [] });
    }

    const identity = await requireTenantAccess(request, tenantId);
    const announcements = await getActiveAnnouncementsForTenant(tenantId, identity.email, locale);
    return NextResponse.json({ success: true, announcements });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[api/announcements/active] Error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

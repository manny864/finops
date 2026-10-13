import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { listarSolicitudes, type EstadoSolicitud } from "@/services/cancellationRequests.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/cancellation-requests?status=PENDING|APPROVED|REJECTED
 * Solicitudes de cancelación que no se pudieron ejecutar solas y esperan la decisión de un SuperAdmin (sin `status`, todas; las
 * pendientes primero).
 */
export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    const status = request.nextUrl.searchParams.get("status");
    if (status && !["PENDING", "APPROVED", "REJECTED"].includes(status)) {
      return NextResponse.json({ error: "status debe ser PENDING, APPROVED o REJECTED" }, { status: 400 });
    }
    return NextResponse.json({ success: true, solicitudes: await listarSolicitudes((status as EstadoSolicitud) || undefined) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[CancellationRequests] GET error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

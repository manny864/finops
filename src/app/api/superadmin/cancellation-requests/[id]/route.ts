import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { resolverSolicitud } from "@/services/cancellationRequests.service";

/**
 * POST /api/superadmin/cancellation-requests/{id}   { decision: "approve" | "reject", note?, effectiveDate?, skipPaddle? }
 * Aprueba (ejecuta la baja) o rechaza (con motivo, que se le informa al cliente) una solicitud pendiente. Ver `resolverSolicitud`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireSuperAdmin(request);
    const { id: idTexto } = await params;
    const id = Number(idTexto);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id inválido" }, { status: 400 });

    const cuerpo = await request.json().catch(() => ({}));
    const resultado = await resolverSolicitud({
      id,
      decision: cuerpo?.decision,
      actor: identity.email,
      nota: typeof cuerpo?.note === "string" ? cuerpo.note : null,
      fechaEfectiva: typeof cuerpo?.effectiveDate === "string" ? cuerpo.effectiveDate : null,
      omitirPaddle: cuerpo?.skipPaddle === true,
    });
    return NextResponse.json({ success: true, ...resultado });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    const status = (err as { status?: number })?.status;
    if (status) return NextResponse.json({ error: errorMessage(err) }, { status });
    console.error("[CancellationRequests] POST error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

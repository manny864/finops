import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import {
  getImpersonationStatus,
  IMPERSONATION_COOKIE_NAME,
} from "@/services/sessionImpersonation.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Sin el guard esto es un eco: devuelve el cookie sin firmar que mando el
    // propio cliente. No filtraba nada, pero deja de ser cierto en cuanto
    // alguien agregue un dato del tenant a la respuesta.
    await requireSuperAdmin(request);

    const cookieValue = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value;
    const status = getImpersonationStatus(cookieValue);
    return NextResponse.json(status);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { success: false, isImpersonating: false, error: err.message },
        { status: err.status }
      );
    }
    console.error("[api/superadmin/impersonate/status] Error:", err);
    return NextResponse.json(
      { success: false, isImpersonating: false, error: err?.message },
      { status: 500 }
    );
  }
}

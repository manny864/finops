import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import {
  getImpersonationStatus,
  IMPERSONATION_COOKIE_NAME,
} from "@/services/sessionImpersonation.service";

export const dynamic = "force-dynamic";

/**
 * El guard SE QUEDA, pero una denegacion no es un error: es una respuesta.
 *
 * `ImpersonationBanner` esta montado para TODOS los usuarios y consulta esta
 * ruta en cada cambio de pathname. Con el guard devolviendo 401, cualquier
 * usuario que no sea SuperAdmin generaba un 401 por navegacion. El banner lo
 * tolera --solo actua si `res.ok`-- pero la consola se llenaba de errores, y eso
 * tapa los que importan.
 *
 * Sacar el guard hubiera silenciado el ruido a costa de volver a exponer el eco
 * del cookie a cualquiera. Esto es mejor en las dos dimensiones: quien no es
 * SuperAdmin recibe 200 con la respuesta correcta --no esta impersonando-- y NO
 * recibe el eco del cookie. O sea que ademas de callar el ruido, expone menos
 * que antes del guard.
 *
 * La vulnerabilidad de SEC-01 estaba en `stop`, que escribia en AuditTrailLogs
 * con los valores del cookie. Ese guard sigue rechazando con 403, y tiene que
 * seguir asi: ahi una denegacion SI es un error, porque el llamador pidio
 * escribir.
 */
const NO_IMPERSONANDO = { success: true, isImpersonating: false, session: null } as const;

export async function GET(request: NextRequest) {
  try {
    try {
      await requireSuperAdmin(request);
    } catch (authErr) {
      if (authErr instanceof AuthError) {
        return NextResponse.json(NO_IMPERSONANDO);
      }
      throw authErr;
    }

    const cookieValue = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value;
    const status = getImpersonationStatus(cookieValue);
    return NextResponse.json(status);
  } catch (err: any) {
    console.error("[api/superadmin/impersonate/status] Error:", err);
    return NextResponse.json(
      { success: false, isImpersonating: false, error: err?.message },
      { status: 500 }
    );
  }
}

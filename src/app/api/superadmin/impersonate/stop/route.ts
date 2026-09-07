import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import {
  stopImpersonation,
  decodeSessionData,
  IMPERSONATION_COOKIE_NAME,
} from "@/services/sessionImpersonation.service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // El guard va antes de tocar el cookie: la cookie de impersonacion es
    // base64 sin firmar, asi que quien la manda decide su contenido. Sin
    // requireSuperAdmin, un POST anonimo con un cookie armado a mano escribia
    // una fila en AuditTrailLogs con el mail y el tenant que quisiera.
    // Simetrico con start/route.ts, que ya exigia SuperAdmin.
    const identity = await requireSuperAdmin(request);

    const cookieValue = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value;
    const currentSession = decodeSessionData(cookieValue);

    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "SuperAdmin Client";

    const { response: result, clearCookieOptions } = await stopImpersonation({
      currentSession,
      actorEmail: identity.email,
      ipAddress,
      userAgent,
    });

    const response = NextResponse.json(result);

    response.cookies.set({
      name: clearCookieOptions.name,
      value: "",
      httpOnly: clearCookieOptions.httpOnly,
      secure: clearCookieOptions.secure,
      sameSite: clearCookieOptions.sameSite,
      path: clearCookieOptions.path,
      maxAge: 0,
    });

    return response;
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("[api/superadmin/impersonate/stop] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Error al detener sesión de impersonación" },
      { status: 500 }
    );
  }
}

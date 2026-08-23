import { NextRequest, NextResponse } from "next/server";
import {
  stopImpersonation,
  decodeSessionData,
  IMPERSONATION_COOKIE_NAME,
} from "@/services/sessionImpersonation.service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value;
    const currentSession = decodeSessionData(cookieValue);

    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "SuperAdmin Client";

    const { response: result, clearCookieOptions } = await stopImpersonation({
      currentSession,
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
    console.error("[api/superadmin/impersonate/stop] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Error al detener sesión de impersonación" },
      { status: 500 }
    );
  }
}

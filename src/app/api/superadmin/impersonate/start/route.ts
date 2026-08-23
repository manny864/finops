import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { startImpersonation } from "@/services/sessionImpersonation.service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const identity = await requireSuperAdmin(request);
    const body = await request.json().catch(() => ({}));
    const { targetTenantId } = body;

    if (!targetTenantId) {
      return NextResponse.json(
        { success: false, error: "Falta el identificador targetTenantId" },
        { status: 400 }
      );
    }

    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "SuperAdmin Client";

    const { response: result, cookieOptions } = await startImpersonation({
      originalAdminUserId: identity.email || "superadmin",
      originalAdminEmail: identity.email || "superadmin@cscloudsolutions.com",
      targetTenantId,
      ipAddress,
      userAgent,
    });

    const response = NextResponse.json(result);

    response.cookies.set({
      name: cookieOptions.name,
      value: cookieOptions.value,
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      path: cookieOptions.path,
      maxAge: cookieOptions.maxAge,
    });

    return response;
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error("[api/superadmin/impersonate/start] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Error al iniciar sesión de impersonación" },
      { status: 500 }
    );
  }
}

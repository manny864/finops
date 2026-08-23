import { NextRequest, NextResponse } from "next/server";
import {
  getImpersonationStatus,
  IMPERSONATION_COOKIE_NAME,
} from "@/services/sessionImpersonation.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
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

import { NextRequest, NextResponse } from "next/server";
import { clearSsoCookie } from "@/lib/ssoSession";

/**
 * POST /api/auth/sso/logout
 * Clear SSO session cookie and DB session
 */
export async function POST(request: NextRequest) {
    try {
        const response = NextResponse.json(
            { success: true, message: "Logged out" },
            { status: 200 }
        );

        await clearSsoCookie(response, request);

        return response;
    } catch (err: any) {
        console.error("SSO logout error:", err);
        return NextResponse.json(
            { error: err?.message || "Logout failed" },
            { status: 500 }
        );
    }
}

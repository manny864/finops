import { NextRequest, NextResponse } from "next/server";
import { clearSsoCookie } from "@/lib/ssoSession";
import { errorMessage } from '@/lib/apiErrors';

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
    } catch (err) {
        console.error("SSO logout error:", err);
        return NextResponse.json(
            { error: errorMessage(err) || "Logout failed" },
            { status: 500 }
        );
    }
}

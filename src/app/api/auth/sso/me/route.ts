import { NextRequest, NextResponse } from "next/server";
import { getSsoSession } from "@/lib/ssoSession";

/**
 * GET /api/auth/sso/me
 * Returns current SSO session info or { authenticated: false }
 */
export async function GET(request: NextRequest) {
    try {
        const session = await getSsoSession(request);

        if (!session) {
            return NextResponse.json({
                authenticated: false,
                source: null,
            });
        }

        return NextResponse.json({
            authenticated: true,
            email: session.email,
            tenantId: session.tenantId,
            workosUserId: session.workosUserId,
            source: "sso",
        });
    } catch (err: any) {
        console.error("SSO me error:", err);
        return NextResponse.json({
            authenticated: false,
            error: err?.message,
            source: null,
        });
    }
}
